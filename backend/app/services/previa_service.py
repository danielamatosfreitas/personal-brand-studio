"""
app/services/previa_service.py
Painel "Ver" dos Agendados (19/10): mostra o post exatamente como vai sair,
antes da publicação. Só leitura: nada aqui chama LinkedIn, Instagram ou
Facebook, e nada muda o post.

O que aparece segue a mesma escolha da publicação:
  - LinkedIn: com PDF, sai só o PDF (documento, com o título gravado no
    campo "Título do documento"); sem PDF, o vídeo; sem os dois, as imagens;
    sem mídia, só o texto;
  - Instagram e Facebook: as imagens, na ordem gravada.
"""
import asyncio
import base64
import io

import httpx
from PIL import Image

from app.db.models import Post, PostExtra, PlatformEnum
from app.services import storage_service

TTL_PREVIA = 3600            # link temporário das miniaturas: 1 hora
LARGURA_PAGINA_PDF = 540     # primeira página do PDF, em pixels de largura
PDF_MAX = 100 * 1024 * 1024  # mesmo teto do LinkedIn para documento

REDES = {"linkedin": "LinkedIn", "instagram": "Instagram", "facebook": "Facebook"}


class PreviaError(Exception):
    """Falha ao montar a prévia, com o motivo em linguagem simples."""


def _ext(ref: str) -> str:
    return ref.lower().split("?")[0].rsplit(".", 1)[-1] if "." in ref else ""


def tipo_midia(ref: str) -> str:
    e = _ext(ref)
    return "pdf" if e == "pdf" else "video" if e in ("mp4", "mov") else "imagem" if e in ("jpg", "jpeg", "png") else "outro"


def midias_que_saem(post: Post) -> list[str]:
    """As mídias que a publicação usa, na ordem (mesma regra de publish_to_linkedin)."""
    refs = list(post.media_urls or [])
    if post.platform == PlatformEnum.linkedin:
        pdf = next((r for r in refs if tipo_midia(r) == "pdf"), None)
        if pdf:
            return [pdf]
        video = next((r for r in refs if tipo_midia(r) == "video"), None)
        if video:
            return [video]
        return [r for r in refs if tipo_midia(r) == "imagem"]
    return [r for r in refs if tipo_midia(r) == "imagem"]


def link_temporario(ref: str) -> str:
    return storage_service.presigned_url(ref, TTL_PREVIA) if ref.startswith(storage_service.REF_PREFIX) else ref


def primeira_pagina_pdf(dados: bytes) -> tuple[int, str]:
    """(número de páginas, primeira página em JPEG como data URL)."""
    import pypdfium2 as pdfium
    try:
        pdf = pdfium.PdfDocument(dados)
    except Exception as e:
        raise PreviaError(f"Não foi possível abrir o PDF ({type(e).__name__}).")
    try:
        paginas = len(pdf)
        if paginas == 0:
            raise PreviaError("O PDF não tem nenhuma página.")
        pagina = pdf[0]
        largura = pagina.get_width() or LARGURA_PAGINA_PDF
        imagem = pagina.render(scale=LARGURA_PAGINA_PDF / largura).to_pil().convert("RGB")
    finally:
        pdf.close()
    saida = io.BytesIO()
    imagem.save(saida, format="JPEG", quality=85)
    return paginas, "data:image/jpeg;base64," + base64.b64encode(saida.getvalue()).decode()


async def _baixa_pdf(ref: str) -> bytes:
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.get(storage_service.resolve_media_url(ref))
    except httpx.HTTPError as e:
        raise PreviaError(f"Não foi possível baixar o PDF do armazenamento ({type(e).__name__}).")
    if r.status_code != 200:
        raise PreviaError(f"Não foi possível baixar o PDF do armazenamento (HTTP {r.status_code}).")
    if len(r.content) > PDF_MAX:
        raise PreviaError("O PDF passa de 100 MB.")
    return r.content


async def midias_da_previa(post: Post) -> list[dict]:
    itens = []
    for n, ref in enumerate(midias_que_saem(post), start=1):
        tipo = tipo_midia(ref)
        item = {"n": n, "tipo": tipo, "arquivo": storage_service.chave_de(ref).rsplit("/", 1)[-1]}
        if tipo == "imagem":
            item["url"] = link_temporario(ref)
        elif tipo == "pdf":
            try:
                paginas, imagem = await asyncio.to_thread(primeira_pagina_pdf, await _baixa_pdf(ref))
                item.update({"paginas": paginas, "primeira_pagina": imagem})
            except PreviaError as e:
                item["motivo"] = str(e)
        elif tipo == "video":
            item["url"] = link_temporario(ref)
        itens.append(item)
    return itens


def usa_titulo(post: Post) -> bool:
    """Post que sai como documento no LinkedIn (precisa do título do documento)."""
    return post.platform == PlatformEnum.linkedin and any(tipo_midia(r) == "pdf" for r in (post.media_urls or []))


async def monta_previa(post: Post, extra: PostExtra | None, extras_ativos: bool) -> dict:
    midias = await midias_da_previa(post)
    titulo = ((extra.titulo_documento if extra else None) or "").strip() or None
    return {
        "id": str(post.id),
        "platform": post.platform.value,
        "rede": REDES.get(post.platform.value, post.platform.value),
        "destino": ("Página de empresa" if post.linkedin_organization_urn else "perfil pessoal")
                   if post.platform == PlatformEnum.linkedin else
                   ("Página Capital Humano Intelligence" if post.platform == PlatformEnum.facebook else "conta do Instagram"),
        "status": post.status.value,
        "scheduled_at": post.scheduled_at.isoformat() if post.scheduled_at else None,
        "content": post.content,
        "caracteres": len(post.content),
        # Título do documento: só o gravado no campo, nunca tirado da legenda.
        "usa_titulo": usa_titulo(post),
        "titulo_documento": titulo if usa_titulo(post) else None,
        "midias": midias,
        "codigo_peca": extra.codigo_peca if extra else None,
        "primeiro_comentario": extra.primeiro_comentario if extra else None,
        "extras_ativos": extras_ativos,
    }
