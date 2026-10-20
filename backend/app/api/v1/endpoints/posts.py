"""
app/api/v1/endpoints/posts.py
Endpoints de gerenciamento e publicação de posts.
"""
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, update

from app.core.security import require_access_token
from app.db.database import get_db
from app.db.models import OAuthCredential, Post, PostExtra, PostStatusEnum, PlatformEnum, User
from app.schemas.schemas import PostCreate, PostEdit, PostResponse, PublishResponse
from app.services import previa_service, extras_service
from app.services.oauth_service import get_valid_token, get_instagram_token, get_facebook_token, OAuthError, TokenExpiredError
from app.services.publishing_service import publish_post, PublishError, INSTAGRAM_SEM_MIDIA
from app.services import instagram_service, facebook_service
from app.services.storage_service import resolve_media_url
from app.services.linkedin_documents_service import (
    register_document_upload,
    upload_document_binary,
    register_image_upload,
    upload_image_binary,
    register_video_upload,
    upload_video_parts,
    finalize_video_upload,
    LinkedInDocumentError,
)

router = APIRouter(
    prefix="/posts", tags=["Posts"],
    dependencies=[Depends(require_access_token)],
)


async def _get_first_user_id(db: AsyncSession) -> uuid.UUID:
    """Busca o ID da usuária principal. Substituir por JWT na Fase 3."""
    result = await db.execute(select(User).limit(1))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Nenhuma usuária cadastrada.")
    return user.id


@router.post(
    "/",
    response_model=PostResponse,
    status_code=201,
    summary="Cria um novo rascunho de post",
)
async def create_post(payload: PostCreate, db: AsyncSession = Depends(get_db)):
    """
    Cria um rascunho de post no banco de dados.
    O post não é publicado automaticamente — use o endpoint /publish para isso.

    Sem mídia, o post vale só para o LinkedIn (sai como texto puro, na hora
    ou agendado). O Instagram não aceita publicação sem mídia: o pedido é
    recusado aqui, na criação, em vez de falhar só na hora de publicar.
    """
    if payload.platform in (PlatformEnum.instagram, PlatformEnum.both) and not payload.media_urls:
        raise HTTPException(status_code=422, detail=INSTAGRAM_SEM_MIDIA)
    # Fase 3: Instagram só com imagem única ou carrossel de 2 a 10 imagens, e
    # um post por rede (a trava contra publicar duas vezes vale por post).
    if payload.platform == PlatformEnum.both:
        raise HTTPException(status_code=422, detail="Crie um post para cada rede: um para o LinkedIn e outro para o Instagram.")
    if payload.platform == PlatformEnum.instagram:
        motivo = instagram_service.valida_midias(payload.media_urls)
        if motivo:
            raise HTTPException(status_code=422, detail=motivo)
    # Fase 4: Facebook com as mesmas peças do Instagram (1 a 10 imagens).
    if payload.platform == PlatformEnum.facebook:
        motivo = facebook_service.valida_midias(payload.media_urls)
        if motivo:
            raise HTTPException(status_code=422, detail=motivo)

    # 19/10: PDF no LinkedIn sai como documento e o título vem só do campo
    # "Título do documento"; sem ele, o post não é criado (nada é tirado da legenda).
    usa_titulo = payload.platform == PlatformEnum.linkedin and any(
        previa_service.tipo_midia(u) == "pdf" for u in (payload.media_urls or []))
    enviados = set(payload.model_fields_set) | ({"titulo_documento"} if usa_titulo else set())
    if usa_titulo and not extras_service.limpa_titulo(payload.titulo_documento):
        raise HTTPException(status_code=422, detail="Informe o título do documento (PDF). O app não usa a legenda como título.")
    extras = _extras_enviados(payload, enviados, payload.platform, usa_titulo, None)
    if extras and not await extras_service.extras_ativos(db):
        raise HTTPException(status_code=409, detail="Título do documento, primeiro comentário e código da peça ainda não estão "
                                                    "ativados no banco. Post com PDF no LinkedIn fica para depois dessa ativação.")

    user_id = await _get_first_user_id(db)

    post = Post(
        user_id=user_id,
        platform=payload.platform,
        content=payload.content,
        media_urls=payload.media_urls,
        status=PostStatusEnum.scheduled if payload.scheduled_at else PostStatusEnum.draft,
        scheduled_at=payload.scheduled_at,
        linkedin_organization_urn=payload.linkedin_organization_urn,
    )
    db.add(post)
    if extras:
        await db.flush()
        await extras_service.grava_extras(db, post.id, extras)
    await db.commit()
    await db.refresh(post)
    return post


@router.post(
    "/{post_id}/publish",
    response_model=PublishResponse,
    summary="Publica um post manualmente nas APIs das redes sociais",
)
async def publish(post_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """
    Envia o post para as APIs do LinkedIn e/ou Instagram.
    Trata erros de token expirado com mensagem clara de reconexão.
    """
    user_id = await _get_first_user_id(db)

    try:
        outcome = await publish_post(db, post_id, user_id)
    except PublishError as e:
        raise HTTPException(status_code=400, detail=str(e))

    post = outcome["post"]
    results = outcome["results"]

    # Monta mensagem de retorno legível
    messages = []
    for platform, result in results.items():
        if result.get("success"):
            messages.append(f"{platform}: publicado com sucesso.")
        else:
            messages.append(f"{platform}: falha — {result.get('error')}")

    return PublishResponse(
        success=post.status == PostStatusEnum.published,
        post_id=post.id,
        platform_post_id=post.platform_post_id,
        message=" | ".join(messages) if messages else "Publicação processada.",
    )


@router.post(
    "/{post_id}/cancel",
    response_model=PostResponse,
    summary="Cancela um agendamento (volta o post pra rascunho)",
)
async def cancel_scheduled(post_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """
    Remove um post da fila de agendamento sem apagar o conteúdo -- ele volta
    a ser um rascunho normal, que pode ser editado e reagendado depois.
    """
    user_id = await _get_first_user_id(db)

    result = await db.execute(
        select(Post).where(Post.id == post_id, Post.user_id == user_id)
    )
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post não encontrado.")
    if post.status != PostStatusEnum.scheduled:
        raise HTTPException(status_code=400, detail="Este post não está agendado.")

    post.status = PostStatusEnum.draft
    post.scheduled_at = None
    await db.commit()
    await db.refresh(post)
    return post


@router.get(
    "/",
    response_model=list[PostResponse],
    summary="Lista todos os posts com status",
)
async def list_posts(
    status: PostStatusEnum | None = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Lista posts da usuária, opcionalmente filtrando por status:
    draft | scheduled | published | failed
    """
    user_id = await _get_first_user_id(db)

    query = select(Post).where(Post.user_id == user_id).order_by(Post.created_at.desc())
    if status:
        query = query.where(Post.status == status)

    result = await db.execute(query)
    return result.scalars().all()


@router.get(
    "/{post_id}",
    response_model=PostResponse,
    summary="Retorna um post específico",
)
async def get_post(post_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    user_id = await _get_first_user_id(db)

    result = await db.execute(
        select(Post).where(Post.id == post_id, Post.user_id == user_id)
    )
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post não encontrado.")
    return post


# ── Ver e Editar dos Agendados (19/10) ────────────────────────────────────────

# Edição fechada quando falta pouco para a publicação, para não atrapalhar o
# agendador (ele pega os posts vencidos a cada minuto).
EDICAO_FECHA_ANTES = timedelta(minutes=2)
NOVO_HORARIO_MINIMO = timedelta(minutes=5)
LIMITE_TEXTO = {PlatformEnum.linkedin: 3000, PlatformEnum.instagram: 2200, PlatformEnum.facebook: 63206}
LIMITE_COMENTARIO = {PlatformEnum.linkedin: 1250, PlatformEnum.instagram: 2200, PlatformEnum.facebook: 8000}
CODIGO_MAX = extras_service.CODIGO_MAX
TITULO_MAX = extras_service.TITULO_MAX
NAO_ATIVADOS = ("Título do documento, primeiro comentário e código da peça ainda não estão ativados no banco. "
                "Texto e horário já podem ser editados.")


def _extras_enviados(payload, enviados: set, platform: PlatformEnum, usa_titulo: bool, extra: PostExtra | None) -> dict:
    """Valida título do documento, primeiro comentário e código da peça
    enviados e devolve só os que mudaram (Criar e Editar)."""
    mudou: dict = {}
    if "titulo_documento" in enviados:
        titulo = extras_service.limpa_titulo(payload.titulo_documento)
        if titulo and not usa_titulo:
            raise HTTPException(status_code=422, detail="Só post do LinkedIn com PDF usa título do documento.")
        if usa_titulo and not titulo:
            raise HTTPException(status_code=422, detail="O título do documento não pode ficar vazio: sem ele o post não sai.")
        if titulo and len(titulo) > TITULO_MAX:
            raise HTTPException(status_code=422, detail=f"O título do documento pode ter no máximo {TITULO_MAX} caracteres.")
        if titulo != (extra.titulo_documento if extra else None):
            mudou["titulo_documento"] = titulo
    if "codigo_peca" in enviados:
        codigo = extras_service.limpa_codigo(payload.codigo_peca)
        if codigo and len(codigo) > CODIGO_MAX:
            raise HTTPException(status_code=422, detail=f"O código da peça pode ter no máximo {CODIGO_MAX} caracteres.")
        if codigo != (extra.codigo_peca if extra else None):
            mudou["codigo_peca"] = codigo
    if "primeiro_comentario" in enviados:
        comentario = extras_service.limpa_comentario(payload.primeiro_comentario)
        limite = LIMITE_COMENTARIO.get(platform)
        if comentario and limite and len(comentario) > limite:
            raise HTTPException(status_code=422, detail=f"O primeiro comentário tem {len(comentario)} caracteres; o limite desta rede é {limite}.")
        if comentario != (extra.primeiro_comentario if extra else None):
            mudou["primeiro_comentario"] = comentario
    return mudou


async def _post_e_extras(db: AsyncSession, post_id: uuid.UUID) -> tuple[Post, PostExtra | None, bool]:
    user_id = await _get_first_user_id(db)
    post = (await db.execute(select(Post).where(Post.id == post_id, Post.user_id == user_id))).scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post não encontrado.")
    extra, ativos = await extras_service.le_extra(db, post_id)
    return post, extra, ativos


async def _previa(post: Post, extra: PostExtra | None, ativos: bool) -> dict:
    return await previa_service.monta_previa(post, extra, ativos)


@router.get(
    "/{post_id}/previa",
    summary="Painel Ver: o post completo como vai sair (texto, mídias, código, primeiro comentário)",
)
async def previa_post(post_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Só leitura: não chama nenhuma rede e não muda nada."""
    post, extra, ativos = await _post_e_extras(db, post_id)
    return await _previa(post, extra, ativos)


@router.patch(
    "/{post_id}",
    summary="Editar de Agendados: texto, horário, título do documento, código da peça e primeiro comentário",
)
async def editar_post(post_id: uuid.UUID, payload: PostEdit, db: AsyncSession = Depends(get_db)):
    """
    Muda só os campos enviados, sem cancelar o agendamento. Texto e horário
    mudam numa única atualização que só vale se o post ainda estiver agendado
    e faltar mais de 2 minutos para sair; assim a edição nunca cruza com a
    publicação. Código da peça e primeiro comentário ficam em post_extras.
    """
    post, extra, ativos = await _post_e_extras(db, post_id)
    enviados = payload.model_fields_set
    agora = datetime.now(timezone.utc)

    if post.status != PostStatusEnum.scheduled:
        raise HTTPException(status_code=409, detail="Este post não está mais agendado, então não dá para editar.")
    if not post.scheduled_at or post.scheduled_at <= agora + EDICAO_FECHA_ANTES:
        raise HTTPException(status_code=409, detail="Este post sai em menos de 2 minutos. A edição fica fechada para não atrapalhar a publicação.")

    valores: dict = {}
    if "content" in enviados:
        texto = (payload.content or "").strip()
        if not texto:
            raise HTTPException(status_code=422, detail="O texto do post não pode ficar vazio.")
        limite = LIMITE_TEXTO.get(post.platform)
        if limite and len(texto) > limite:
            raise HTTPException(status_code=422, detail=f"O texto tem {len(texto)} caracteres; o limite desta rede é {limite}.")
        if texto != post.content:
            valores["content"] = texto
    if "scheduled_at" in enviados:
        quando = payload.scheduled_at
        if quando is None or quando.tzinfo is None:
            raise HTTPException(status_code=422, detail="Informe a data e a hora do novo horário.")
        if quando <= agora + NOVO_HORARIO_MINIMO:
            raise HTTPException(status_code=422, detail="O novo horário precisa ser pelo menos 5 minutos depois de agora.")
        if quando != post.scheduled_at:
            valores["scheduled_at"] = quando

    extras = _extras_enviados(payload, enviados, post.platform, previa_service.usa_titulo(post), extra)
    if extras and not ativos:
        raise HTTPException(status_code=409, detail=NAO_ATIVADOS)

    if not valores and not extras:
        return {**await _previa(post, extra, ativos), "mensagem": "Nada mudou: o post continua igual."}

    if valores:
        r = await db.execute(
            update(Post)
            .where(Post.id == post.id, Post.status == PostStatusEnum.scheduled,
                   Post.scheduled_at > agora + EDICAO_FECHA_ANTES)
            .values(**valores)
            .execution_options(synchronize_session=False)
        )
        if r.rowcount != 1:
            await db.rollback()
            raise HTTPException(status_code=409, detail="O post mudou enquanto você editava (saiu ou foi cancelado). Nada foi salvo.")
    if extras:
        await extras_service.grava_extras(db, post.id, extras)
    await db.commit()

    post, extra, ativos = await _post_e_extras(db, post_id)
    nomes = {"content": "texto", "scheduled_at": "horário", "codigo_peca": "código da peça",
             "primeiro_comentario": "primeiro comentário", "titulo_documento": "título do documento"}
    mudou = [nomes[k] for k in (*valores, *extras)]
    lista = mudou[0] if len(mudou) == 1 else ", ".join(mudou[:-1]) + " e " + mudou[-1]
    return {**await _previa(post, extra, ativos), "mensagem": f"Alterações salvas: {lista}."}


# ── Ensaio do Instagram (Fase 3) ──────────────────────────────────────────────

@router.post(
    "/{post_id}/ensaio-instagram",
    summary="Ensaio no Instagram: cria os contêineres e confere se ficaram prontos, SEM publicar",
)
async def ensaio_instagram(post_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """
    Faz todo o caminho da publicação (JPEG, links temporários, contêiner de
    cada imagem, contêiner do carrossel com a legenda, espera ficar pronto) e
    para antes de publicar. Não muda o status do post. Os contêineres que
    sobram no Instagram vencem sozinhos em 24 horas e não aparecem no perfil.
    """
    user_id = await _get_first_user_id(db)
    result = await db.execute(select(Post).where(Post.id == post_id, Post.user_id == user_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post não encontrado.")
    if post.platform != PlatformEnum.instagram:
        raise HTTPException(status_code=400, detail="O ensaio é só para posts do Instagram.")
    try:
        token = await get_instagram_token(db, user_id)
        return await instagram_service.publicar(token, post.media_urls or [], post.content,
                                                prefixo=f"ensaio-{post.id}", ensaio=True)
    except (TokenExpiredError, OAuthError, instagram_service.InstagramError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/{post_id}/ensaio-facebook",
    summary="Ensaio no Facebook: sobe as fotos sem publicar, confere e apaga",
)
async def ensaio_facebook(post_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """
    Confere a página, sobe cada imagem sem publicar (não aparece na página),
    confere cada uma e apaga. Não muda o status do post.
    """
    user_id = await _get_first_user_id(db)
    result = await db.execute(select(Post).where(Post.id == post_id, Post.user_id == user_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post não encontrado.")
    if post.platform != PlatformEnum.facebook:
        raise HTTPException(status_code=400, detail="Este ensaio é só para posts do Facebook.")
    try:
        token, page_id = await get_facebook_token(db, user_id)
        return await facebook_service.publicar(token, page_id, post.media_urls or [], post.content, ensaio=True)
    except (TokenExpiredError, OAuthError, facebook_service.FacebookError) as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Diagnóstico (Fase 1) ─────────────────────────────────────────────────────

class LinkedInDocumentTestRequest(BaseModel):
    pdf_url: str
    linkedin_version: str | None = None  # override pra testar versões da API sem redeploy


@router.post(
    "/test-linkedin-document",
    summary="Testa o upload de documento no LinkedIn SEM publicar nada no feed",
)
async def test_linkedin_document_upload(
    payload: LinkedInDocumentTestRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Faz só os passos 1 e 2 do fluxo (inicializa upload + envia o PDF).
    Nunca chama o passo 3 (criar o post) — não aparece nada no feed do LinkedIn.
    Usado para confirmar que o token/escopo tem acesso à Documents API antes
    de habilitar a publicação de verdade.
    """
    user_id = await _get_first_user_id(db)

    try:
        access_token = await get_valid_token(db, user_id, PlatformEnum.linkedin)
    except (TokenExpiredError, OAuthError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    cred_result = await db.execute(
        select(OAuthCredential).where(
            and_(
                OAuthCredential.user_id == user_id,
                OAuthCredential.platform == PlatformEnum.linkedin,
            )
        )
    )
    li_cred = cred_result.scalar_one_or_none()
    if not li_cred or not li_cred.platform_user_id:
        raise HTTPException(status_code=400, detail="LinkedIn não conectado.")
    owner_urn = f"urn:li:person:{li_cred.platform_user_id}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        pdf_response = await client.get(resolve_media_url(payload.pdf_url))
    if pdf_response.status_code != 200:
        raise HTTPException(
            status_code=400,
            detail=f"Não foi possível baixar o PDF: {pdf_response.status_code}",
        )

    try:
        upload_url, document_urn = await register_document_upload(
            access_token, owner_urn, payload.linkedin_version
        )
        await upload_document_binary(upload_url, access_token, pdf_response.content)
    except LinkedInDocumentError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "success": True,
        "document_urn": document_urn,
        "message": "Upload de documento confirmado. Nenhum post foi publicado no feed.",
    }


class LinkedInImageTestRequest(BaseModel):
    image_url: str
    linkedin_version: str | None = None


@router.post(
    "/test-linkedin-image",
    summary="Testa o upload de imagem no LinkedIn SEM publicar nada no feed",
)
async def test_linkedin_image_upload(
    payload: LinkedInImageTestRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Faz só os passos 1 e 2 do fluxo de imagem (inicializa upload + envia a
    imagem). Nunca chama o passo 3 (criar o post) — não aparece nada no feed.
    Usado pra confirmar acesso à Images API antes de habilitar a correção
    do bug de imagem sem mídia em "Publicar mídia pronta".
    """
    user_id = await _get_first_user_id(db)

    try:
        access_token = await get_valid_token(db, user_id, PlatformEnum.linkedin)
    except (TokenExpiredError, OAuthError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    cred_result = await db.execute(
        select(OAuthCredential).where(
            and_(
                OAuthCredential.user_id == user_id,
                OAuthCredential.platform == PlatformEnum.linkedin,
            )
        )
    )
    li_cred = cred_result.scalar_one_or_none()
    if not li_cred or not li_cred.platform_user_id:
        raise HTTPException(status_code=400, detail="LinkedIn não conectado.")
    owner_urn = f"urn:li:person:{li_cred.platform_user_id}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        image_response = await client.get(resolve_media_url(payload.image_url))
    if image_response.status_code != 200:
        raise HTTPException(
            status_code=400,
            detail=f"Não foi possível baixar a imagem: {image_response.status_code}",
        )

    try:
        upload_url, image_urn = await register_image_upload(
            access_token, owner_urn, payload.linkedin_version
        )
        await upload_image_binary(upload_url, access_token, image_response.content)
    except LinkedInDocumentError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "success": True,
        "image_urn": image_urn,
        "message": "Upload de imagem confirmado. Nenhum post foi publicado no feed.",
    }


class LinkedInMultiImageTestRequest(BaseModel):
    image_urls: list[str]
    linkedin_version: str | None = None


@router.post(
    "/test-linkedin-multi-image",
    summary="Testa o upload de uma galeria de imagens no LinkedIn SEM publicar nada no feed",
)
async def test_linkedin_multi_image_upload(
    payload: LinkedInMultiImageTestRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Registra + envia cada imagem da lista (passos 1+2, por imagem). Nunca
    chama o passo 3 (criar o post) — não aparece nada no feed. Usado pra
    confirmar que várias imagens sobem em sequência sem erro antes de
    habilitar a publicação de galeria de verdade.
    """
    user_id = await _get_first_user_id(db)

    try:
        access_token = await get_valid_token(db, user_id, PlatformEnum.linkedin)
    except (TokenExpiredError, OAuthError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    cred_result = await db.execute(
        select(OAuthCredential).where(
            and_(
                OAuthCredential.user_id == user_id,
                OAuthCredential.platform == PlatformEnum.linkedin,
            )
        )
    )
    li_cred = cred_result.scalar_one_or_none()
    if not li_cred or not li_cred.platform_user_id:
        raise HTTPException(status_code=400, detail="LinkedIn não conectado.")
    owner_urn = f"urn:li:person:{li_cred.platform_user_id}"

    image_urns = []
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            for image_url in payload.image_urls:
                image_response = await client.get(resolve_media_url(image_url))
                if image_response.status_code != 200:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Não foi possível baixar {image_url}: {image_response.status_code}",
                    )
                upload_url, image_urn = await register_image_upload(
                    access_token, owner_urn, payload.linkedin_version
                )
                await upload_image_binary(upload_url, access_token, image_response.content)
                image_urns.append(image_urn)
    except LinkedInDocumentError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "success": True,
        "image_urns": image_urns,
        "message": f"Upload de {len(image_urns)} imagens confirmado. Nenhum post foi publicado no feed.",
    }


class LinkedInVideoTestRequest(BaseModel):
    video_url: str
    linkedin_version: str | None = None


@router.post(
    "/test-linkedin-video",
    summary="Testa o upload de vídeo no LinkedIn SEM publicar nada no feed",
)
async def test_linkedin_video_upload(
    payload: LinkedInVideoTestRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Faz os passos 1+2+3 (inicializar + enviar as partes + finalizar). Nunca
    chama o passo 4 (esperar processar + criar o post) — não aparece nada
    no feed. Usado pra confirmar que o upload em partes funciona antes de
    habilitar a publicação de vídeo de verdade.
    """
    user_id = await _get_first_user_id(db)

    try:
        access_token = await get_valid_token(db, user_id, PlatformEnum.linkedin)
    except (TokenExpiredError, OAuthError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    cred_result = await db.execute(
        select(OAuthCredential).where(
            and_(
                OAuthCredential.user_id == user_id,
                OAuthCredential.platform == PlatformEnum.linkedin,
            )
        )
    )
    li_cred = cred_result.scalar_one_or_none()
    if not li_cred or not li_cred.platform_user_id:
        raise HTTPException(status_code=400, detail="LinkedIn não conectado.")
    owner_urn = f"urn:li:person:{li_cred.platform_user_id}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        video_response = await client.get(resolve_media_url(payload.video_url))
    if video_response.status_code != 200:
        raise HTTPException(
            status_code=400,
            detail=f"Não foi possível baixar o vídeo: {video_response.status_code}",
        )

    try:
        upload_instructions, video_urn, upload_token = await register_video_upload(
            access_token, owner_urn, len(video_response.content), payload.linkedin_version
        )
        etags = await upload_video_parts(upload_instructions, access_token, video_response.content)
        await finalize_video_upload(access_token, video_urn, upload_token, etags, payload.linkedin_version)
    except LinkedInDocumentError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "success": True,
        "video_urn": video_urn,
        "parts": len(upload_instructions),
        "message": "Upload de vídeo confirmado (registrado, enviado e finalizado). Nenhum post foi publicado no feed.",
    }
