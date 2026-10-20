"""
app/services/instagram_service.py
Publicação no Instagram (Fase 3, 16/10): Instagram API com login do
Instagram, só imagem única e carrossel (Reels e Facebook ficam fora).

Fluxo (a API do Instagram não agenda; quem agenda é o scheduler do app):
  1. confere a conta (/me) e pega o ID que publica;
  2. baixa cada imagem do bucket, converte para JPEG (o Instagram só aceita
     JPEG) no mesmo tamanho, sobe uma cópia temporária e gera um link
     assinado na hora;
  3. imagem única: um contêiner com a legenda. Carrossel (2 a 10): um
     contêiner por imagem, depois o contêiner do carrossel com a legenda;
  4. espera cada contêiner ficar pronto (FINISHED);
  5. só então publica (media_publish). No ensaio, para antes deste passo;
  6. apaga as cópias temporárias.

O token vai no cabeçalho Authorization, nunca no endereço, e nenhuma
mensagem de erro carrega URL, token ou link assinado.
"""
import asyncio
import io
import logging
import time

import httpx
from PIL import Image

from app.core.config import settings
from app.services import storage_service

logger = logging.getLogger("instagram")

MAX_ITENS = 10
ESPERA_MAX_SEGUNDOS = 180
INTERVALO_SEGUNDOS = 3
LINK_TEMPORARIO_SEGUNDOS = 3600
JPEG_QUALIDADE = 95
PASTA_TEMPORARIA = "instagram-temp"
EXTENSOES_IMAGEM = (".jpg", ".jpeg", ".png")

# Limites do Instagram para imagem do feed: largura de 320 a 1440 px e
# proporção de 4:5 (0,8) a 1,91:1.
LARGURA_MIN, LARGURA_MAX = 320, 1440
PROPORCAO_MIN, PROPORCAO_MAX = 0.8, 1.91


def graph_url() -> str:
    return f"https://graph.instagram.com/{settings.INSTAGRAM_API_VERSION}"


class InstagramError(Exception):
    """Falha ao publicar no Instagram, com o motivo em linguagem simples.

    pode_tentar_de_novo=False quando a falha aconteceu no passo de publicar
    (ou depois): o post pode ter saído, então ninguém tenta de novo sem antes
    conferir no Instagram.
    """

    def __init__(self, mensagem: str, pode_tentar_de_novo: bool = True):
        super().__init__(mensagem)
        self.pode_tentar_de_novo = pode_tentar_de_novo


# ── Validação ──────────────────────────────────────────────────────────────────

def eh_imagem(ref: str) -> bool:
    return ref.lower().split("?")[0].endswith(EXTENSOES_IMAGEM)


def valida_midias(media_urls: list[str] | None) -> str | None:
    """Motivo (em linguagem simples) se a lista não serve para o Instagram; None se serve."""
    midias = media_urls or []
    if not midias:
        return ("O Instagram não aceita publicação só com texto. "
                "Escolha pelo menos uma imagem (JPG ou PNG).")
    if len(midias) > MAX_ITENS:
        return f"O carrossel do Instagram aceita no máximo {MAX_ITENS} imagens; este post tem {len(midias)}."
    if not all(eh_imagem(u) for u in midias):
        return ("Por enquanto o app publica no Instagram só imagens (JPG ou PNG), "
                "uma sozinha ou em carrossel. PDF e vídeo ficam de fora.")
    return None


# ── Imagem ─────────────────────────────────────────────────────────────────────

def para_jpeg(dados: bytes) -> tuple[bytes, tuple[int, int]]:
    """Converte a imagem para JPEG no mesmo tamanho (qualidade 95, cor sem
    subamostragem, para o texto do card não borrar). JPEG que já chega pronto
    passa sem recompressão."""
    try:
        img = Image.open(io.BytesIO(dados))
        img.load()
    except Exception as e:
        raise InstagramError(f"Não foi possível ler uma das imagens ({type(e).__name__}).")
    largura, altura = img.size
    proporcao = largura / altura
    if not (LARGURA_MIN <= largura <= LARGURA_MAX) or not (PROPORCAO_MIN - 0.005 <= proporcao <= PROPORCAO_MAX + 0.005):
        raise InstagramError(
            f"Uma das imagens tem {largura}x{altura} px, fora do que o Instagram aceita "
            "(largura de 320 a 1440 px, proporção de 4:5 a 1,91:1). Use 1080x1350 ou 1080x1080."
        )
    if img.format == "JPEG" and img.mode == "RGB":
        return dados, img.size
    if img.mode in ("RGBA", "LA", "P"):
        rgba = img.convert("RGBA")
        fundo = Image.new("RGB", rgba.size, (255, 255, 255))
        fundo.paste(rgba, mask=rgba.split()[3])
        img = fundo
    else:
        img = img.convert("RGB")
    saida = io.BytesIO()
    img.save(saida, format="JPEG", quality=JPEG_QUALIDADE, subsampling=0, optimize=True)
    return saida.getvalue(), img.size


async def _prepara_imagens(media_urls: list[str], prefixo: str, chaves: list[str]) -> list[str]:
    """Baixa, converte e sobe as cópias JPEG; devolve os links assinados. Cada
    chave temporária entra em `chaves` assim que sobe (para ser apagada mesmo
    se uma imagem seguinte falhar)."""
    links = []
    async with httpx.AsyncClient(timeout=60.0) as client:
        for i, ref in enumerate(media_urls, start=1):
            try:
                r = await client.get(storage_service.resolve_media_url(ref))
            except httpx.HTTPError as e:
                raise InstagramError(f"Não foi possível baixar a imagem {i} do armazenamento ({type(e).__name__}).")
            if r.status_code != 200:
                raise InstagramError(f"Não foi possível baixar a imagem {i} do armazenamento (HTTP {r.status_code}).")
            jpeg, _ = await asyncio.to_thread(para_jpeg, r.content)
            chave = f"{PASTA_TEMPORARIA}/{prefixo}/{i:02d}.jpg"
            try:
                await asyncio.to_thread(storage_service._sobe, jpeg, chave, "image/jpeg")
            except Exception as e:
                raise InstagramError(f"Não foi possível preparar a imagem {i} no armazenamento ({type(e).__name__}).")
            chaves.append(chave)
            links.append(storage_service.presigned_url(chave, LINK_TEMPORARIO_SEGUNDOS))
    return links


def _apaga_temporarios(chaves: list[str]) -> None:
    if not chaves:
        return
    try:
        c = storage_service.client()
        for chave in chaves:
            c.delete_object(Bucket=settings.S3_BUCKET, Key=chave)
    except Exception as e:  # sobra no bucket não impede nada; só registra
        logger.warning(f"[instagram] cópias temporárias não apagadas: {type(e).__name__}")


# ── API do Instagram ───────────────────────────────────────────────────────────

def mensagem_simples(erro: dict) -> str:
    """Motivo em linguagem simples a partir do erro devolvido pela API."""
    codigo = erro.get("code")
    sub = erro.get("error_subcode")
    texto = (erro.get("error_user_msg") or erro.get("message") or "").strip()
    if codigo == 190:
        base = "A conexão com o Instagram venceu ou foi desfeita. Reconecte o Instagram em Conexões e tente de novo."
    elif codigo in (10, 200, 3) or (isinstance(codigo, int) and 200 <= codigo < 300):
        base = ("O Instagram não deu permissão para publicar por este app. "
                "Reconecte o Instagram e aceite a permissão de publicar conteúdo.")
    elif codigo in (4, 9, 17, 32, 613) or sub == 2207042:
        base = "O Instagram atingiu o limite de publicações por enquanto. Tente de novo mais tarde."
    elif codigo == 9004 or sub in (2207052, 2207003, 2207020):
        base = "O Instagram não conseguiu baixar uma das imagens. Tente de novo; se repetir, suba as imagens outra vez."
    elif codigo == 36003 or sub in (2207009, 2207004):
        base = "Uma das imagens tem tamanho ou proporção que o Instagram não aceita. Use 1080x1350 ou 1080x1080."
    elif codigo == 24 or sub == 2207032:
        base = "O Instagram não terminou de preparar a mídia a tempo."
    else:
        base = f"O Instagram recusou o pedido: {texto[:200] or 'sem detalhe'}."
    return f"{base} (código {codigo}{f'/{sub}' if sub else ''})"


async def _chama(client: httpx.AsyncClient, metodo: str, caminho: str, token: str,
                 dados: dict | None = None, params: dict | None = None,
                 pode_tentar_de_novo: bool = True) -> dict:
    try:
        r = await client.request(metodo, f"{graph_url()}/{caminho}", data=dados, params=params,
                                 headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError as e:
        raise InstagramError(f"Sem resposta do Instagram ({type(e).__name__}). Tente de novo mais tarde.",
                             pode_tentar_de_novo)
    try:
        corpo = r.json()
    except ValueError:
        corpo = {}
    if r.status_code != 200 or "error" in corpo:
        raise InstagramError(mensagem_simples(corpo.get("error") or {"message": f"HTTP {r.status_code}"}),
                             pode_tentar_de_novo)
    return corpo


async def conta(token: str) -> dict:
    """Conta conectada: {"ig_id", "username", "account_type"}."""
    async with httpx.AsyncClient(timeout=20.0) as client:
        me = await _chama(client, "GET", "me", token, params={"fields": "user_id,username,account_type"})
    return {"ig_id": str(me.get("user_id") or me.get("id") or ""), "username": me.get("username", ""),
            "account_type": me.get("account_type", "")}


async def limite_de_publicacao(token: str, ig_id: str) -> dict:
    """Uso da cota de publicações em 24 h (só responde com a permissão de publicar)."""
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await _chama(client, "GET", f"{ig_id}/content_publishing_limit", token, params={"fields": "quota_usage,config"})
    dado = (r.get("data") or [{}])[0]
    return {"usadas": dado.get("quota_usage"), "total": (dado.get("config") or {}).get("quota_total")}


async def _espera_pronto(client: httpx.AsyncClient, token: str, conteiner: str, rotulo: str,
                         dormir=None, relogio=time.monotonic) -> str:
    dormir = dormir or asyncio.sleep
    inicio = relogio()
    while True:
        r = await _chama(client, "GET", conteiner, token, params={"fields": "status_code,status"})
        estado = r.get("status_code", "")
        if estado in ("FINISHED", "PUBLISHED"):
            return estado
        if estado in ("ERROR", "EXPIRED"):
            raise InstagramError(f"O Instagram não conseguiu preparar {rotulo} ({estado}: {str(r.get('status', ''))[:120]}).")
        if relogio() - inicio > ESPERA_MAX_SEGUNDOS:
            raise InstagramError(f"O Instagram não terminou de preparar {rotulo} em {ESPERA_MAX_SEGUNDOS // 60} minutos.")
        await dormir(INTERVALO_SEGUNDOS)


async def publicar(token: str, media_urls: list[str], legenda: str, prefixo: str,
                   ensaio: bool = False, dormir=None) -> dict:
    """Publica imagem única ou carrossel. Com ensaio=True, cria os contêineres,
    confere se ficaram prontos e para sem publicar nada."""
    motivo = valida_midias(media_urls)
    if motivo:
        raise InstagramError(motivo)

    me = await conta(token)
    if not me["ig_id"]:
        raise InstagramError("O Instagram não informou qual conta publica. Reconecte o Instagram.")
    ig = me["ig_id"]
    carrossel = len(media_urls) > 1
    chaves: list[str] = []
    try:
        links = await _prepara_imagens(media_urls, prefixo, chaves)
        async with httpx.AsyncClient(timeout=60.0) as client:
            itens: list[dict] = []
            if carrossel:
                for i, link in enumerate(links, start=1):
                    c = await _chama(client, "POST", f"{ig}/media", token,
                                     dados={"image_url": link, "is_carousel_item": "true"})
                    itens.append({"n": i, "id": c["id"]})
                for item in itens:
                    item["status"] = await _espera_pronto(client, token, item["id"], f"a imagem {item['n']}", dormir)
                principal = await _chama(client, "POST", f"{ig}/media", token, dados={
                    "media_type": "CAROUSEL", "children": ",".join(i["id"] for i in itens), "caption": legenda})
            else:
                principal = await _chama(client, "POST", f"{ig}/media", token,
                                         dados={"image_url": links[0], "caption": legenda})
            estado = await _espera_pronto(client, token, principal["id"], "o carrossel" if carrossel else "a imagem", dormir)
            resumo = {"conta": me["username"], "tipo": "carrossel" if carrossel else "imagem única",
                      "itens": itens, "conteiner": principal["id"], "status": estado}
            if ensaio:
                return {**resumo, "ensaio": True, "publicado": False}

            # Daqui em diante, uma falha pode esconder um post que saiu: nada
            # de tentar de novo sem conferir no Instagram.
            pub = await _chama(client, "POST", f"{ig}/media_publish", token,
                               dados={"creation_id": principal["id"]}, pode_tentar_de_novo=False)
            media_id = str(pub.get("id") or "")
            if not media_id:
                raise InstagramError("O Instagram não confirmou a publicação. Confira no Instagram antes de tentar de novo.",
                                     pode_tentar_de_novo=False)
            link = ""
            try:
                link = (await _chama(client, "GET", media_id, token, params={"fields": "permalink"})).get("permalink", "")
            except InstagramError:
                pass
            return {**resumo, "ensaio": False, "publicado": True, "media_id": media_id, "permalink": link}
    finally:
        await asyncio.to_thread(_apaga_temporarios, chaves)
