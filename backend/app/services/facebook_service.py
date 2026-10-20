"""
app/services/facebook_service.py
Publicação na página do Facebook (Fase 4, 16/10): só a página
"Capital Humano Intelligence", de 1 a 10 imagens com legenda.

Fluxo (referência de POST /{page-id}/photos e /{page-id}/feed, Graph API):
  - uma imagem: POST /{page-id}/photos com a imagem e a legenda (caption),
    publicada na hora;
  - várias imagens: cada uma sobe sem publicar (published=false), na ordem
    recebida (a ordem dos nomes dos arquivos); depois um único post em
    POST /{page-id}/feed com a legenda (message) e attached_media;
  - ensaio: sobe as imagens sem publicar, confere cada uma e apaga, sem nada
    aparecer na página (foto não publicada não vai para a linha do tempo, e
    a Meta apaga sozinha em 24 horas o que sobrar).

Trava de página: toda chamada passa por confere_pagina(); só o id gravado na
conexão, e ele precisa ser o FACEBOOK_PAGE_ID.

Tokens: só no cabeçalho Authorization (nunca no endereço), e nenhuma mensagem
de erro carrega token, chave ou link assinado.
"""
import asyncio
import io
import json
import logging

import httpx
from PIL import Image

from app.core.config import settings
from app.services import storage_service

logger = logging.getLogger("facebook")

MAX_ITENS = 10
TAMANHO_MAX = 4 * 1024 * 1024        # limite da Meta por foto
PNG_RECOMENDADO = 1 * 1024 * 1024    # acima disso a Meta recomenda não mandar PNG (pixeliza)
EXTENSOES_IMAGEM = (".jpg", ".jpeg", ".png")


def graph_url() -> str:
    return f"https://graph.facebook.com/{settings.FACEBOOK_API_VERSION}"


class FacebookError(Exception):
    """Falha ao publicar no Facebook, com o motivo em linguagem simples.
    pode_tentar_de_novo=False quando a falha foi no passo de publicar."""

    def __init__(self, mensagem: str, pode_tentar_de_novo: bool = True):
        super().__init__(mensagem)
        self.pode_tentar_de_novo = pode_tentar_de_novo


class PaginaErradaError(FacebookError):
    """Pedido para publicar numa página que não é a da empresa."""


# ── Trava de página ────────────────────────────────────────────────────────────

def _nome(n: str) -> str:
    return " ".join((n or "").split()).casefold()


def eh_a_pagina(p: dict) -> bool:
    """A trava: pelo FACEBOOK_PAGE_ID; só sem ele, pelo nome."""
    if settings.FACEBOOK_PAGE_ID:
        return str(p.get("id")) == settings.FACEBOOK_PAGE_ID
    return _nome(p.get("name", "")) == _nome(settings.FACEBOOK_PAGE_NAME)


def escolhe_pagina(paginas: list[dict]) -> dict:
    """Na conexão: entre as páginas que a conta administra, só a da empresa
    (pelo FACEBOOK_PAGE_ID). As outras nunca são oferecidas nem guardadas."""
    nome = settings.FACEBOOK_PAGE_NAME
    candidatas = [p for p in paginas if eh_a_pagina(p)]
    if not candidatas:
        if not paginas:
            raise FacebookError(
                f'A Meta não liberou nenhuma Página para o app. Clique em Conectar de novo e, na tela da Meta, '
                f'marque a Página "{nome}" (se aparecer o botão "Editar acesso", use ele para escolher a Página).')
        nomes = [f'"{p.get("name", "sem nome")}"' for p in paginas[:5]]
        lista = nomes[0] if len(nomes) == 1 else ", ".join(nomes[:-1]) + " e " + nomes[-1]
        raise FacebookError(
            f'A Meta liberou {"a Página" if len(nomes) == 1 else "as Páginas"} {lista}, mas não a "{nome}". '
            f'Clique em Conectar de novo e marque a Página "{nome}" na tela da Meta.')
    if len(candidatas) > 1:
        raise FacebookError(f'Este perfil administra mais de uma Página com o nome "{nome}". '
                            "O app não sabe qual escolher; avise o suporte do Personal Brand.")
    pagina = candidatas[0]
    tarefas = pagina.get("tasks")
    if tarefas is not None and "CREATE_CONTENT" not in tarefas:
        raise FacebookError(f'O seu perfil não pode criar publicações na Página "{nome}". '
                            "Peça a quem administra a Página acesso total (ou permissão de criar conteúdo).")
    if not pagina.get("access_token"):
        raise FacebookError("A Meta não entregou o acesso à Página. Clique em Conectar de novo e marque a Página na tela da Meta.")
    return pagina


# Permissões mínimas, com o nome que aparece para a Dani.
PERMISSOES_MINIMAS = {
    "pages_show_list": "ver as suas Páginas",
    "pages_read_engagement": "ler o conteúdo da Página",
    "pages_manage_posts": "publicar na Página",
}


def confere_permissoes(concedidas: list[str]) -> None:
    """Recusa a conexão se alguma permissão mínima ficou desmarcada na tela da Meta."""
    faltam = [d for p, d in PERMISSOES_MINIMAS.items() if p not in concedidas]
    if faltam:
        lista = faltam[0] if len(faltam) == 1 else ", ".join(faltam[:-1]) + " e " + faltam[-1]
        raise FacebookError(f"Na tela da Meta, ficou desmarcada a permissão de {lista}. "
                            "Clique em Conectar de novo e deixe todas as permissões marcadas.")


def confere_pagina(page_id_destino: str, page_id_conectada: str) -> None:
    """Recusa qualquer página que não seja a gravada na conexão."""
    destino, conectada = str(page_id_destino or ""), str(page_id_conectada or "")
    if not conectada:
        raise PaginaErradaError("O Facebook não está conectado à página da empresa. Conecte o Facebook em Conexões.")
    if destino != conectada or (settings.FACEBOOK_PAGE_ID and conectada != settings.FACEBOOK_PAGE_ID):
        raise PaginaErradaError(f'Publicação recusada: o app só publica na página "{settings.FACEBOOK_PAGE_NAME}".')


# ── Validação e imagens ────────────────────────────────────────────────────────

def eh_imagem(ref: str) -> bool:
    return ref.lower().split("?")[0].endswith(EXTENSOES_IMAGEM)


def valida_midias(media_urls: list[str] | None) -> str | None:
    midias = media_urls or []
    if not midias:
        return "Escolha pelo menos uma imagem (JPG ou PNG) para publicar no Facebook."
    if len(midias) > MAX_ITENS:
        return f"O post do Facebook aceita no máximo {MAX_ITENS} imagens; este tem {len(midias)}."
    if not all(eh_imagem(u) for u in midias):
        return "Por enquanto o app publica no Facebook só imagens (JPG ou PNG). PDF e vídeo ficam de fora."
    return None


def prepara_imagem(dados: bytes) -> tuple[bytes, str, str]:
    """(bytes, extensão, tipo). PNG acima de 1 MB vira JPEG de qualidade 95
    (recomendação da Meta); nada passa de 4 MB."""
    try:
        img = Image.open(io.BytesIO(dados))
        img.load()
    except Exception as e:
        raise FacebookError(f"Não foi possível ler uma das imagens ({type(e).__name__}).")
    if img.format == "PNG" and len(dados) > PNG_RECOMENDADO:
        if img.mode in ("RGBA", "LA", "P"):
            rgba = img.convert("RGBA")
            fundo = Image.new("RGB", rgba.size, (255, 255, 255))
            fundo.paste(rgba, mask=rgba.split()[3])
            img = fundo
        saida = io.BytesIO()
        img.convert("RGB").save(saida, format="JPEG", quality=95, subsampling=0, optimize=True)
        dados = saida.getvalue()
        fmt = "JPEG"
    else:
        fmt = img.format
    if len(dados) > TAMANHO_MAX:
        raise FacebookError("Uma das imagens passa de 4 MB, o limite do Facebook.")
    return (dados, "png", "image/png") if fmt == "PNG" else (dados, "jpg", "image/jpeg")


async def _baixa(media_urls: list[str]) -> list[tuple[bytes, str, str]]:
    imagens = []
    async with httpx.AsyncClient(timeout=60.0) as client:
        for i, ref in enumerate(media_urls, start=1):
            try:
                r = await client.get(storage_service.resolve_media_url(ref))
            except httpx.HTTPError as e:
                raise FacebookError(f"Não foi possível baixar a imagem {i} do armazenamento ({type(e).__name__}).")
            if r.status_code != 200:
                raise FacebookError(f"Não foi possível baixar a imagem {i} do armazenamento (HTTP {r.status_code}).")
            imagens.append(await asyncio.to_thread(prepara_imagem, r.content))
    return imagens


# ── API do Facebook ────────────────────────────────────────────────────────────

def mensagem_simples(erro: dict) -> str:
    codigo = erro.get("code")
    sub = erro.get("error_subcode")
    texto = (erro.get("error_user_msg") or erro.get("message") or "").strip()
    if codigo == 190:
        base = "A conexão com o Facebook venceu ou foi desfeita. Reconecte o Facebook em Conexões e tente de novo."
    elif codigo in (10, 200, 283, 3) or (isinstance(codigo, int) and 200 <= codigo < 300):
        base = ("O Facebook não deu permissão para publicar na página por este app. "
                "Reconecte o Facebook e aceite as permissões da página.")
    elif codigo in (4, 17, 32, 613):
        base = "O Facebook atingiu o limite de publicações por enquanto. Tente de novo mais tarde."
    elif codigo == 324:
        base = "O Facebook não aceitou uma das imagens (arquivo ausente ou inválido)."
    elif codigo == 368:
        base = "O Facebook bloqueou esta ação por enquanto. Tente de novo mais tarde."
    else:
        base = f"O Facebook recusou o pedido: {texto[:200] or 'sem detalhe'}."
    return f"{base} (código {codigo}{f'/{sub}' if sub else ''})"


async def _chama(client: httpx.AsyncClient, metodo: str, caminho: str, token: str, dados: dict | None = None,
                 params: dict | None = None, arquivos: dict | None = None, pode_tentar_de_novo: bool = True) -> dict:
    try:
        r = await client.request(metodo, f"{graph_url()}/{caminho}", data=dados, params=params, files=arquivos,
                                 headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError as e:
        raise FacebookError(f"Sem resposta do Facebook ({type(e).__name__}). Tente de novo mais tarde.", pode_tentar_de_novo)
    try:
        corpo = r.json()
    except ValueError:
        corpo = {}
    if r.status_code != 200 or (isinstance(corpo, dict) and "error" in corpo):
        raise FacebookError(mensagem_simples((corpo or {}).get("error") or {"message": f"HTTP {r.status_code}"}),
                            pode_tentar_de_novo)
    return corpo if isinstance(corpo, dict) else {"resultado": corpo}


async def pagina(token: str, page_id: str) -> dict:
    """Confere com o Facebook a página conectada: {"id", "name"}."""
    async with httpx.AsyncClient(timeout=20.0) as client:
        return await _chama(client, "GET", page_id, token, params={"fields": "id,name"})


async def _apaga(client: httpx.AsyncClient, token: str, ids: list[str]) -> int:
    apagadas = 0
    for fid in ids:
        try:
            await _chama(client, "DELETE", fid, token)
            apagadas += 1
        except FacebookError:
            logger.warning("[facebook] foto não publicada não apagada (a Meta apaga sozinha em 24 horas)")
    return apagadas


async def publicar(token: str, page_id_conectada: str, media_urls: list[str], legenda: str,
                   ensaio: bool = False, page_id_destino: str | None = None) -> dict:
    """Publica de 1 a 10 imagens na página da empresa. Com ensaio=True, sobe as
    imagens sem publicar, confere e apaga."""
    destino = str(page_id_destino or page_id_conectada or "")
    confere_pagina(destino, page_id_conectada)
    motivo = valida_midias(media_urls)
    if motivo:
        raise FacebookError(motivo)

    imagens = await _baixa(media_urls)
    async with httpx.AsyncClient(timeout=120.0) as client:
        info = await _chama(client, "GET", destino, token, params={"fields": "id,name"})
        if str(info.get("id")) != destino or not eh_a_pagina(info):
            raise PaginaErradaError(f'Publicação recusada: o app só publica na página "{settings.FACEBOOK_PAGE_NAME}".')
        resumo = {"pagina": info.get("name"), "tipo": "várias imagens" if len(imagens) > 1 else "imagem única"}

        if len(imagens) == 1 and not ensaio:
            dados, ext, tipo = imagens[0]
            r = await _chama(client, "POST", f"{destino}/photos", token,
                             dados={"caption": legenda, "published": "true"},
                             arquivos={"source": (f"imagem-01.{ext}", dados, tipo)}, pode_tentar_de_novo=False)
            post_id = str(r.get("post_id") or r.get("id") or "")
        else:
            fotos: list[str] = []
            try:
                for i, (dados, ext, tipo) in enumerate(imagens, start=1):
                    r = await _chama(client, "POST", f"{destino}/photos", token, dados={"published": "false"},
                                     arquivos={"source": (f"imagem-{i:02d}.{ext}", dados, tipo)})
                    fotos.append(str(r["id"]))
                if ensaio:
                    conferidas = []
                    for i, fid in enumerate(fotos, start=1):
                        f = await _chama(client, "GET", fid, token, params={"fields": "id,width,height"})
                        conferidas.append({"n": i, "largura": f.get("width"), "altura": f.get("height")})
                    apagadas = await _apaga(client, token, fotos)
                    fotos = []
                    return {**resumo, "ensaio": True, "publicado": False, "fotos": conferidas, "apagadas": apagadas}
            except FacebookError:
                await _apaga(client, token, fotos)
                raise
            campos = {"message": legenda}
            for i, fid in enumerate(fotos):
                campos[f"attached_media[{i}]"] = json.dumps({"media_fbid": fid})
            r = await _chama(client, "POST", f"{destino}/feed", token, dados=campos, pode_tentar_de_novo=False)
            post_id = str(r.get("id") or "")

        if not post_id:
            raise FacebookError("O Facebook não confirmou a publicação. Confira na página antes de tentar de novo.",
                                pode_tentar_de_novo=False)
        link = ""
        try:
            link = (await _chama(client, "GET", post_id, token, params={"fields": "permalink_url"})).get("permalink_url", "")
        except FacebookError:
            pass
        return {**resumo, "ensaio": False, "publicado": True, "post_id": post_id, "permalink": link}
