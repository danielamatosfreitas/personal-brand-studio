"""
app/services/publishing_service.py
Serviço de publicação de posts no LinkedIn e Instagram.
Responsabilidades:
  - Publicar texto no LinkedIn via UGC Posts API
  - Publicar imagem/vídeo/texto no Instagram via Content Publishing API
  - Tratar erros de token expirado, rate limit e permissão negada
"""
import uuid
from datetime import datetime, timezone, timedelta

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, or_, and_

from app.db.models import Post, PostStatusEnum, PlatformEnum
from app.services.oauth_service import (
    get_valid_token, get_instagram_token, get_facebook_token, TokenExpiredError, OAuthError,
)
from app.services.storage_service import resolve_media_url
from app.services import instagram_service, facebook_service
from app.services.instagram_service import InstagramError
from app.services.facebook_service import FacebookError
from app.services.linkedin_documents_service import (
    publish_linkedin_document_post,
    publish_linkedin_image_post,
    publish_linkedin_multi_image_post,
    publish_linkedin_video_post,
    LinkedInDocumentError,
)
from app.services.extras_service import titulo_do_documento


# ── URLs das APIs de Publicação ────────────────────────────────────────────────

LINKEDIN_UGC_POST_URL = "https://api.linkedin.com/v2/ugcPosts"
# Instagram: endereços em app/services/instagram_service.py (graph.instagram.com).


# ── Exceções ───────────────────────────────────────────────────────────────────

class PublishError(Exception):
    """Erro durante a publicação em uma plataforma."""
    pass


INSTAGRAM_SEM_MIDIA = (
    "O Instagram não aceita publicação só com texto. "
    "Escolha pelo menos uma imagem (JPG ou PNG) para publicar ou agendar no Instagram. "
    "No LinkedIn, o post pode sair só com o texto."
)

SEM_TITULO = (
    "Não publicado: falta o título do documento (PDF), e o app não usa a legenda como título. "
    "Agende de novo com o título do documento preenchido."
)


# ── LinkedIn ───────────────────────────────────────────────────────────────────

async def publish_to_linkedin(
    db: AsyncSession,
    post: Post,
    user_id: uuid.UUID,
    linkedin_person_urn: str,
) -> str:
    """
    Publica no LinkedIn -- no perfil pessoal ou numa Página de empresa que a
    usuária administra, dependendo de post.linkedin_organization_urn (null =
    perfil pessoal). Se o post tiver um PDF em media_urls (carrossel
    exportado do Personal Brand Studio), publica como documento via Documents
    API + Posts API. Se tiver um vídeo (MP4/MOV), publica via Videos API
    (upload em partes + espera processar). Se tiver uma imagem (JPG/PNG --
    ex: upload feito em "Publicar mídia pronta"), publica com a imagem
    anexada via Images API (uma ou várias, como galeria). Caso contrário,
    publica como texto puro (UGC Posts API).
    Retorna o URN do post publicado.
    """
    # PDF: o título do documento vem só do campo "Título do documento"
    # (19/10). Sem ele, o post não sai: nada é inventado a partir da legenda.
    titulo = None
    if any(u.lower().split("?")[0].endswith(".pdf") for u in (post.media_urls or [])):
        titulo = await titulo_do_documento(db, post.id)
        if not titulo:
            raise PublishError(SEM_TITULO)

    try:
        access_token = await get_valid_token(db, user_id, PlatformEnum.linkedin)
    except TokenExpiredError as e:
        raise PublishError(str(e))
    except OAuthError as e:
        raise PublishError(str(e))

    # Perfil pessoal por padrão; se a usuária escolheu uma Página de empresa
    # ao criar o post, publica como a organização em vez do perfil dela.
    owner_urn = post.linkedin_organization_urn or f"urn:li:person:{linkedin_person_urn}"

    # Referências do bucket ("midia://...") viram URLs assinadas na hora.
    media_urls = [resolve_media_url(u) for u in (post.media_urls or [])]

    pdf_url = next(
        (u for u in media_urls if u.lower().split("?")[0].endswith(".pdf")),
        None,
    )
    if pdf_url:
        return await _publish_linkedin_document(post, access_token, owner_urn, pdf_url, titulo)

    video_url = next(
        (u for u in media_urls if u.lower().split("?")[0].endswith((".mp4", ".mov"))),
        None,
    )
    if video_url:
        return await _publish_linkedin_video(post, access_token, owner_urn, video_url)

    image_urls = [
        u for u in media_urls if u.lower().split("?")[0].endswith((".jpg", ".jpeg", ".png"))
    ]
    if len(image_urls) == 1:
        return await _publish_linkedin_image(post, access_token, owner_urn, image_urls[0])
    if len(image_urls) > 1:
        return await _publish_linkedin_multi_image(post, access_token, owner_urn, image_urls)

    # Payload conforme especificação da LinkedIn UGC Posts API
    payload = {
        "author": owner_urn,
        "lifecycleState": "PUBLISHED",
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {
                    "text": post.content
                },
                "shareMediaCategory": "NONE",
            }
        },
        "visibility": {
            "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
        },
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            LINKEDIN_UGC_POST_URL,
            json=payload,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                "X-Restli-Protocol-Version": "2.0.0",
            },
        )

    if response.status_code == 401:
        raise PublishError(
            "Token LinkedIn inválido ou expirado. Reconecte a conta."
        )
    if response.status_code == 403:
        raise PublishError(
            "Permissão negada pelo LinkedIn. Verifique se o scope 'w_member_social' "
            "foi concedido e o app está aprovado."
        )
    if response.status_code not in (200, 201):
        raise PublishError(
            f"LinkedIn retornou status {response.status_code}: {response.text}"
        )

    # O LinkedIn retorna o ID do post no header 'x-restli-id'
    post_urn = response.headers.get("x-restli-id") or response.json().get("id", "")
    return post_urn


async def _publish_linkedin_document(
    post: Post,
    access_token: str,
    owner_urn: str,
    pdf_url: str,
    title: str,
) -> str:
    """Baixa o PDF (bucket de mídia, URL assinada) e publica como documento/carrossel no LinkedIn."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        pdf_response = await client.get(pdf_url)
    if pdf_response.status_code != 200:
        raise PublishError(
            f"Não foi possível baixar o PDF do carrossel para publicar: {pdf_response.status_code}"
        )

    try:
        return await publish_linkedin_document_post(
            access_token=access_token,
            owner_urn=owner_urn,
            commentary=post.content,
            pdf_bytes=pdf_response.content,
            title=title,
        )
    except LinkedInDocumentError as e:
        raise PublishError(str(e))


async def _publish_linkedin_image(
    post: Post,
    access_token: str,
    owner_urn: str,
    image_url: str,
) -> str:
    """Baixa a imagem (bucket de mídia, URL assinada) e publica anexada ao post no LinkedIn."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        image_response = await client.get(image_url)
    if image_response.status_code != 200:
        raise PublishError(
            f"Não foi possível baixar a imagem para publicar: {image_response.status_code}"
        )

    try:
        return await publish_linkedin_image_post(
            access_token=access_token,
            owner_urn=owner_urn,
            commentary=post.content,
            image_bytes=image_response.content,
        )
    except LinkedInDocumentError as e:
        raise PublishError(str(e))


async def _publish_linkedin_multi_image(
    post: Post,
    access_token: str,
    owner_urn: str,
    image_urls: list[str],
) -> str:
    """Baixa cada imagem (bucket de mídia, URL assinada) e publica como galeria (multiImage) no LinkedIn."""
    images_bytes: list[bytes] = []
    async with httpx.AsyncClient(timeout=30.0) as client:
        for url in image_urls:
            response = await client.get(url)
            if response.status_code != 200:
                raise PublishError(
                    f"Não foi possível baixar uma das imagens para publicar: {response.status_code}"
                )
            images_bytes.append(response.content)

    try:
        return await publish_linkedin_multi_image_post(
            access_token=access_token,
            owner_urn=owner_urn,
            commentary=post.content,
            images_bytes=images_bytes,
        )
    except LinkedInDocumentError as e:
        raise PublishError(str(e))


async def _publish_linkedin_video(
    post: Post,
    access_token: str,
    owner_urn: str,
    video_url: str,
) -> str:
    """Baixa o vídeo (bucket de mídia, URL assinada) e publica no LinkedIn via Videos API."""
    async with httpx.AsyncClient(timeout=120.0) as client:
        video_response = await client.get(video_url)
    if video_response.status_code != 200:
        raise PublishError(
            f"Não foi possível baixar o vídeo para publicar: {video_response.status_code}"
        )

    try:
        return await publish_linkedin_video_post(
            access_token=access_token,
            owner_urn=owner_urn,
            commentary=post.content,
            video_bytes=video_response.content,
        )
    except LinkedInDocumentError as e:
        raise PublishError(str(e))


# ── Instagram ──────────────────────────────────────────────────────────────────

async def publish_to_instagram(
    db: AsyncSession,
    post: Post,
    user_id: uuid.UUID,
    instagram_user_id: str = "",
) -> str:
    """
    Publica no Instagram (imagem única ou carrossel de 2 a 10) pelo
    app/services/instagram_service.py. Retorna o ID da publicação.
    `instagram_user_id` fica só por compatibilidade: a conta vem do /me.
    """
    try:
        access_token = await get_instagram_token(db, user_id)
    except (TokenExpiredError, OAuthError) as e:
        raise PublishError(str(e))
    try:
        resultado = await instagram_service.publicar(access_token, post.media_urls or [], post.content, prefixo=str(post.id))
    except InstagramError as e:
        raise PublishError(str(e))
    return resultado["media_id"]


# Marcas no error_log de um post do Instagram (Fase 3). Só um post com
# PODE_TENTAR pode ser publicado de novo; os outros dois exigem conferir no
# Instagram antes, porque o post pode ter saído.
IG_PUBLICANDO = "[Instagram] Publicação em andamento"
IG_PODE_TENTAR = "[Instagram] Não publicado"
IG_CONFERIR = "[Instagram] Não confirmado"
FUSO_BRASILIA = timezone(timedelta(hours=-3))


async def _publica_so_instagram(db: AsyncSession, post: Post, user_id: uuid.UUID) -> dict:
    """
    Post só do Instagram, com trava contra publicar duas vezes: antes de
    qualquer chamada ao Instagram, o post é marcado, numa única instrução no
    banco, como "em andamento" (status failed com a marca IG_PUBLICANDO).
    Só passa quem estava em rascunho, agendado ou falhou antes de publicar;
    o agendador só pega posts "scheduled", então nunca tenta de novo sozinho.
    """
    agora = datetime.now(timezone.utc)
    trava = await db.execute(
        update(Post)
        .where(
            Post.id == post.id,
            or_(
                Post.status.in_([PostStatusEnum.draft, PostStatusEnum.scheduled]),
                and_(Post.status == PostStatusEnum.failed, Post.error_log.like(IG_PODE_TENTAR + "%")),
            ),
        )
        .values(
            status=PostStatusEnum.failed,
            error_log=(f"{IG_PUBLICANDO} desde {agora.astimezone(FUSO_BRASILIA):%d/%m %H:%M}. "
                       "Se esta mensagem não sumir em alguns minutos, confira no Instagram se o post saiu "
                       "antes de tentar de novo."),
        )
        .returning(Post.id)
        .execution_options(synchronize_session=False)
    )
    if trava.scalar_one_or_none() is None:
        await db.rollback()
        raise PublishError(
            "Este post já está sendo publicado ou já foi enviado ao Instagram. "
            "Confira no Instagram antes de tentar de novo; se não saiu, crie o post outra vez."
        )
    await db.commit()

    try:
        access_token = await get_instagram_token(db, user_id)
        resultado = await instagram_service.publicar(access_token, post.media_urls or [], post.content, prefixo=str(post.id))
    except (TokenExpiredError, OAuthError) as e:
        post.status = PostStatusEnum.failed
        post.error_log = f"{IG_PODE_TENTAR}: {e}"
        await db.commit()
        return {"post": post, "results": {"instagram": {"success": False, "error": str(e)}}}
    except InstagramError as e:
        post.status = PostStatusEnum.failed
        post.error_log = f"{IG_PODE_TENTAR if e.pode_tentar_de_novo else IG_CONFERIR}: {e}"
        await db.commit()
        return {"post": post, "results": {"instagram": {"success": False, "error": str(e)}}}
    except Exception as e:  # inesperado: não dá para saber se saiu
        post.status = PostStatusEnum.failed
        post.error_log = (f"{IG_CONFERIR}: erro inesperado ({type(e).__name__}). "
                          "Confira no Instagram se o post saiu antes de tentar de novo.")
        await db.commit()
        return {"post": post, "results": {"instagram": {"success": False, "error": post.error_log}}}

    post.status = PostStatusEnum.published
    post.published_at = datetime.now(timezone.utc)
    post.platform_post_id = resultado["media_id"]
    post.error_log = None
    await db.commit()
    await db.refresh(post)
    return {"post": post, "results": {"instagram": {"success": True, "media_id": resultado["media_id"],
                                                    "permalink": resultado.get("permalink", "")}}}


# Marcas no error_log de um post do Facebook (Fase 4), com as mesmas regras do
# Instagram: só PODE_TENTAR libera nova tentativa manual.
FB_PUBLICANDO = "[Facebook] Publicação em andamento"
FB_PODE_TENTAR = "[Facebook] Não publicado"
FB_CONFERIR = "[Facebook] Não confirmado"


async def _publica_so_facebook(db: AsyncSession, post: Post, user_id: uuid.UUID) -> dict:
    """Post só do Facebook, com a mesma trava do Instagram: marcado como "em
    andamento" numa única instrução no banco antes de qualquer chamada; o
    agendador só pega "scheduled", então nunca tenta de novo sozinho."""
    agora = datetime.now(timezone.utc)
    trava = await db.execute(
        update(Post)
        .where(
            Post.id == post.id,
            or_(
                Post.status.in_([PostStatusEnum.draft, PostStatusEnum.scheduled]),
                and_(Post.status == PostStatusEnum.failed, Post.error_log.like(FB_PODE_TENTAR + "%")),
            ),
        )
        .values(
            status=PostStatusEnum.failed,
            error_log=(f"{FB_PUBLICANDO} desde {agora.astimezone(FUSO_BRASILIA):%d/%m %H:%M}. "
                       "Se esta mensagem não sumir em alguns minutos, confira na página se o post saiu "
                       "antes de tentar de novo."),
        )
        .returning(Post.id)
        .execution_options(synchronize_session=False)
    )
    if trava.scalar_one_or_none() is None:
        await db.rollback()
        raise PublishError(
            "Este post já está sendo publicado ou já foi enviado ao Facebook. "
            "Confira na página antes de tentar de novo; se não saiu, crie o post outra vez."
        )
    await db.commit()

    try:
        token, page_id = await get_facebook_token(db, user_id)
        resultado = await facebook_service.publicar(token, page_id, post.media_urls or [], post.content)
    except (TokenExpiredError, OAuthError) as e:
        post.status = PostStatusEnum.failed
        post.error_log = f"{FB_PODE_TENTAR}: {e}"
        await db.commit()
        return {"post": post, "results": {"facebook": {"success": False, "error": str(e)}}}
    except FacebookError as e:
        post.status = PostStatusEnum.failed
        post.error_log = f"{FB_PODE_TENTAR if e.pode_tentar_de_novo else FB_CONFERIR}: {e}"
        await db.commit()
        return {"post": post, "results": {"facebook": {"success": False, "error": str(e)}}}
    except Exception as e:  # inesperado: não dá para saber se saiu
        post.status = PostStatusEnum.failed
        post.error_log = (f"{FB_CONFERIR}: erro inesperado ({type(e).__name__}). "
                          "Confira na página se o post saiu antes de tentar de novo.")
        await db.commit()
        return {"post": post, "results": {"facebook": {"success": False, "error": post.error_log}}}

    post.status = PostStatusEnum.published
    post.published_at = datetime.now(timezone.utc)
    post.platform_post_id = resultado["post_id"]
    post.error_log = None
    await db.commit()
    await db.refresh(post)
    return {"post": post, "results": {"facebook": {"success": True, "post_id": resultado["post_id"],
                                                   "permalink": resultado.get("permalink", "")}}}


# ── Orquestrador Principal ─────────────────────────────────────────────────────

async def publish_post(
    db: AsyncSession,
    post_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict:
    """
    Orquestra a publicação de um post nas plataformas configuradas.
    Atualiza o status do post no banco independente do resultado.
    Retorna um resumo de sucesso/falha por plataforma.
    """
    result = await db.execute(
        select(Post).where(Post.id == post_id, Post.user_id == user_id)
    )
    post = result.scalar_one_or_none()

    if not post:
        raise PublishError(f"Post {post_id} não encontrado.")

    if post.status == PostStatusEnum.published:
        raise PublishError("Este post já foi publicado.")

    if post.platform == PlatformEnum.instagram:
        return await _publica_so_instagram(db, post, user_id)
    if post.platform == PlatformEnum.facebook:
        return await _publica_so_facebook(db, post, user_id)

    results = {}

    # ── Publicar no LinkedIn ───────────────────────────────────────────────────
    if post.platform in (PlatformEnum.linkedin, PlatformEnum.both):
        try:
            # Busca o platform_user_id da credencial armazenada
            from app.db.models import OAuthCredential
            from sqlalchemy import and_
            cred_result = await db.execute(
                select(OAuthCredential).where(
                    and_(
                        OAuthCredential.user_id == user_id,
                        OAuthCredential.platform == PlatformEnum.linkedin,
                    )
                )
            )
            li_cred = cred_result.scalar_one_or_none()
            person_urn = li_cred.platform_user_id if li_cred else ""

            li_post_id = await publish_to_linkedin(db, post, user_id, person_urn)
            results["linkedin"] = {"success": True, "post_id": li_post_id}
            post.platform_post_id = li_post_id

        except PublishError as e:
            results["linkedin"] = {"success": False, "error": str(e)}
            post.error_log = f"[LinkedIn] {str(e)}"

    # ── Publicar no Instagram ──────────────────────────────────────────────────
    if post.platform in (PlatformEnum.instagram, PlatformEnum.both):
        try:
            from app.db.models import OAuthCredential
            from sqlalchemy import and_
            cred_result = await db.execute(
                select(OAuthCredential).where(
                    and_(
                        OAuthCredential.user_id == user_id,
                        OAuthCredential.platform == PlatformEnum.instagram,
                    )
                )
            )
            ig_cred = cred_result.scalar_one_or_none()
            ig_user_id = ig_cred.platform_user_id if ig_cred else ""

            ig_media_id = await publish_to_instagram(db, post, user_id, ig_user_id)
            results["instagram"] = {"success": True, "media_id": ig_media_id}
            if not post.platform_post_id:
                post.platform_post_id = ig_media_id

        except PublishError as e:
            results["instagram"] = {"success": False, "error": str(e)}
            error_prefix = post.error_log or ""
            post.error_log = f"{error_prefix}\n[Instagram] {str(e)}".strip()

    # ── Atualiza status final do post ──────────────────────────────────────────
    any_success = any(v.get("success") for v in results.values())
    all_success = all(v.get("success") for v in results.values())

    if all_success:
        post.status = PostStatusEnum.published
        post.published_at = datetime.now(timezone.utc)
    elif any_success:
        # Publicou em ao menos uma plataforma — marcamos como publicado parcialmente
        post.status = PostStatusEnum.published
        post.published_at = datetime.now(timezone.utc)
    else:
        post.status = PostStatusEnum.failed

    await db.commit()
    await db.refresh(post)

    return {"post": post, "results": results}
