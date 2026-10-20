"""
app/api/v1/endpoints/oauth.py
Endpoints OAuth 2.0 para LinkedIn e Instagram.
Implementa o Authorization Code Flow com proteção CSRF via state.
"""
import logging
import uuid
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.database import get_db
from app.db.models import OAuthCredential, PlatformEnum, User
from app.schemas.schemas import OAuthStatusResponse, OAuthStatusItem
from app.services.oauth_service import (
    get_linkedin_auth_url,
    exchange_linkedin_code,
    get_instagram_auth_url,
    exchange_instagram_code,
    list_linkedin_organizations,
    OAuthError,
)
from app.services.oauth_service import get_valid_token, get_instagram_token, TokenExpiredError
from app.services.oauth_service import get_facebook_auth_url, exchange_facebook_code, get_facebook_token, facebook_permissoes
from app.services import instagram_service, facebook_service
from app.core.config import settings
from app.core.security import require_access_token
from app.core.oauth_state import registra_state, consome_state

router = APIRouter(prefix="/oauth", tags=["OAuth"])
logger = logging.getLogger("oauth")

# ── Nota de Fase 1 ─────────────────────────────────────────────────────────────
# Para simplificar, o user_id está fixo como o primeiro usuário do banco.
# Na Fase 3, isso será substituído por autenticação JWT real.

async def _get_first_user_id(db: AsyncSession) -> uuid.UUID:
    """Busca o ID da usuária principal (owner do sistema)."""
    result = await db.execute(select(User).limit(1))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=404,
            detail="Nenhuma usuária cadastrada. Execute o script de seed primeiro."
        )
    return user.id


# ── LinkedIn ───────────────────────────────────────────────────────────────────

@router.post(
    "/linkedin/start",
    summary="Inicia o fluxo OAuth do LinkedIn",
    dependencies=[Depends(require_access_token)],
)
async def linkedin_start():
    """
    Devolve o endereço de autorização do LinkedIn; o frontend navega até ele.
    A senha de acesso chega no cabeçalho (nunca no endereço). O 'state' fica
    guardado no servidor para validação no callback (anti-CSRF, uso único).
    """
    url, state = get_linkedin_auth_url()
    registra_state("linkedin", state)
    return {"url": url}


@router.get("/linkedin/callback", summary="Callback OAuth do LinkedIn")
async def linkedin_callback(
    code: str,
    state: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Recebe o authorization code do LinkedIn, valida o state,
    troca pelo access_token e salva no banco.
    """
    # ── Validação CSRF ────────────────────────────────────────────────────────
    if not consome_state("linkedin", state):
        raise HTTPException(
            status_code=400,
            detail="State OAuth inválido. Possível ataque CSRF detectado."
        )

    user_id = await _get_first_user_id(db)

    try:
        credential = await exchange_linkedin_code(code, db, user_id)
    except OAuthError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Redireciona para o frontend com sucesso
    return RedirectResponse(
        f"{settings.FRONTEND_URL}?oauth=linkedin&status=success"
    )


# ── Instagram ──────────────────────────────────────────────────────────────────

@router.post(
    "/instagram/start",
    summary="Inicia o fluxo OAuth do Instagram",
    dependencies=[Depends(require_access_token)],
)
async def instagram_start():
    """
    Devolve o endereço de autorização do Instagram; o frontend navega até ele.
    Mesmo esquema do LinkedIn: senha no cabeçalho, state guardado no servidor.
    """
    url, state = get_instagram_auth_url()
    registra_state("instagram", state)
    return {"url": url}


@router.get("/instagram/callback", summary="Callback OAuth do Instagram")
async def instagram_callback(
    code: str,
    state: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Recebe o authorization code do Instagram, valida o state,
    troca pelo long-lived access_token e salva no banco.

    Erros aqui redirecionam de volta pro frontend com status=error (em vez de
    estourar um JSON cru do FastAPI no domínio do backend) -- assim dá pra ver
    na hora, pela URL, se o fluxo realmente falhou e onde, em vez de a usuária
    achar que "conectou" só porque o navegador saiu da tela do Meta.
    """
    # ── Validação CSRF ────────────────────────────────────────────────────────
    if not consome_state("instagram", state):
        logger.warning("[instagram_callback] State OAuth inválido, vencido ou já usado.")
        return RedirectResponse(
            f"{settings.FRONTEND_URL}?oauth=instagram&status=error"
            f"&message={quote('A autorização venceu ou já foi usada. Clique em Conectar de novo.')}"
        )

    user_id = await _get_first_user_id(db)

    try:
        credential = await exchange_instagram_code(code, db, user_id)
    except OAuthError as e:
        logger.error(f"[instagram_callback] Falha ao trocar code por token: {e}")
        return RedirectResponse(
            f"{settings.FRONTEND_URL}?oauth=instagram&status=error&message={quote(str(e))}"
        )
    except Exception as e:
        logger.exception("[instagram_callback] Erro inesperado no fluxo OAuth do Instagram")
        return RedirectResponse(
            f"{settings.FRONTEND_URL}?oauth=instagram&status=error"
            f"&message={quote('Erro inesperado: ' + str(e))}"
        )

    return RedirectResponse(
        f"{settings.FRONTEND_URL}?oauth=instagram&status=success"
    )


@router.get(
    "/instagram/conta",
    summary="Conta do Instagram conectada e a cota de publicações (Fase 3)",
    dependencies=[Depends(require_access_token)],
)
async def instagram_conta(db: AsyncSession = Depends(get_db)):
    """
    Confere com o próprio Instagram qual conta está conectada (@usuário e tipo
    de conta) e se a permissão de publicar funciona (a cota de publicações só
    responde com ela). Nunca devolve o token.
    """
    user_id = await _get_first_user_id(db)
    try:
        token = await get_instagram_token(db, user_id)
    except (TokenExpiredError, OAuthError) as e:
        return {"conectado": False, "motivo": str(e)}
    try:
        conta = await instagram_service.conta(token)
    except instagram_service.InstagramError as e:
        return {"conectado": True, "conta": None, "motivo": str(e)}
    resposta = {"conectado": True, "conta": conta["username"], "tipo": conta["account_type"]}
    try:
        resposta["publicacoes_24h"] = await instagram_service.limite_de_publicacao(token, conta["ig_id"])
        resposta["pode_publicar"] = True
    except instagram_service.InstagramError as e:
        resposta["pode_publicar"] = False
        resposta["motivo"] = str(e)
    return resposta


# ── Facebook (Fase 4) ──────────────────────────────────────────────────────────

@router.post(
    "/facebook/start",
    summary="Inicia o login do Facebook (só para a página da empresa)",
    dependencies=[Depends(require_access_token)],
)
async def facebook_start():
    """Mesmo esquema do Instagram: senha no cabeçalho, state guardado no servidor."""
    url, state = get_facebook_auth_url()
    registra_state("facebook", state)
    return {"url": url}


@router.get("/facebook/callback", summary="Volta do login do Facebook")
async def facebook_callback(
    state: str,
    request: Request,
    code: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Valida o state, troca o código pelo token de longa duração e guarda só o
    token da página da empresa (as outras páginas da conta nunca são gravadas).
    """
    if not consome_state("facebook", state):
        logger.warning("[facebook_callback] State inválido, vencido ou já usado.")
        return RedirectResponse(
            f"{settings.FRONTEND_URL}?oauth=facebook&status=error"
            f"&message={quote('A autorização venceu ou já foi usada. Clique em Conectar de novo.')}"
        )
    if not code:
        logger.warning(f"[facebook_callback] Volta sem código: {request.query_params.get('error_reason') or request.query_params.get('error') or 'sem motivo'}")
        return RedirectResponse(
            f"{settings.FRONTEND_URL}?oauth=facebook&status=error"
            f"&message={quote('A conexão foi cancelada na tela da Meta. Clique em Conectar de novo e confirme o acesso até o fim.')}"
        )
    user_id = await _get_first_user_id(db)
    try:
        cred = await exchange_facebook_code(code, db, user_id)
    except OAuthError as e:
        logger.error(f"[facebook_callback] Falha na conexão: {e}")
        return RedirectResponse(f"{settings.FRONTEND_URL}?oauth=facebook&status=error&message={quote(str(e))}")
    except Exception as e:
        logger.error(f"[facebook_callback] Erro inesperado: {type(e).__name__}")
        return RedirectResponse(
            f"{settings.FRONTEND_URL}?oauth=facebook&status=error"
            f"&message={quote('Algo deu errado na conexão com o Facebook. Clique em Conectar de novo; se repetir, avise o suporte.')}"
        )
    logger.warning(f"[facebook_callback] Página conectada (id {cred.platform_user_id}).")
    return RedirectResponse(
        f"{settings.FRONTEND_URL}?oauth=facebook&status=success"
        f"&message={quote('Página conectada: ' + settings.FACEBOOK_PAGE_NAME)}"
    )


@router.get(
    "/facebook/conta",
    summary="Página do Facebook conectada (Fase 4)",
    dependencies=[Depends(require_access_token)],
)
async def facebook_conta(db: AsyncSession = Depends(get_db)):
    """Confere com o Facebook a página conectada. Nunca devolve o token."""
    user_id = await _get_first_user_id(db)
    try:
        token, page_id = await get_facebook_token(db, user_id)
    except (TokenExpiredError, OAuthError) as e:
        return {"conectado": False, "motivo": str(e)}
    try:
        info = await facebook_service.pagina(token, page_id)
    except facebook_service.FacebookError as e:
        return {"conectado": True, "pagina": None, "motivo": str(e)}
    return {"conectado": True, "pagina": info.get("name"), "pagina_id": page_id,
            "pagina_certa": facebook_service.eh_a_pagina(info) and str(info.get("id")) == page_id,
            "permissoes": await facebook_permissoes(db, user_id)}


# ── Status Geral ───────────────────────────────────────────────────────────────

@router.get(
    "/status",
    response_model=OAuthStatusResponse,
    summary="Retorna quais plataformas estão conectadas",
    dependencies=[Depends(require_access_token)],
)
async def oauth_status(db: AsyncSession = Depends(get_db)):
    """
    Verifica o status de conexão de cada plataforma social.
    Útil para o frontend exibir quais contas estão ativas.
    """
    user_id = await _get_first_user_id(db)

    result = await db.execute(
        select(OAuthCredential).where(OAuthCredential.user_id == user_id)
    )
    credentials = result.scalars().all()

    connected_platforms = {c.platform: c for c in credentials}
    items = []

    for platform in (PlatformEnum.linkedin, PlatformEnum.instagram, PlatformEnum.facebook):
        cred = connected_platforms.get(platform)
        if cred:
            items.append(OAuthStatusItem(
                platform=platform,
                connected=True,
                platform_user_id=cred.platform_user_id,
                token_expires_at=cred.token_expires_at,
                is_expired=cred.is_expired(),
            ))
        else:
            items.append(OAuthStatusItem(
                platform=platform,
                connected=False,
            ))

    return OAuthStatusResponse(platforms=items)


@router.get(
    "/linkedin/organizations",
    summary="Lista as Páginas de empresa que a usuária administra no LinkedIn",
    dependencies=[Depends(require_access_token)],
)
async def linkedin_organizations(db: AsyncSession = Depends(get_db)):
    """
    Requer o escopo w_organization_social (reconexão do LinkedIn). Se o
    LinkedIn não estiver conectado, o token estiver expirado, ou a conta
    não administrar nenhuma Página, devolve lista vazia -- nunca erro --
    pra interface simplesmente não mostrar a opção nesse caso.
    """
    user_id = await _get_first_user_id(db)

    try:
        access_token = await get_valid_token(db, user_id, PlatformEnum.linkedin)
    except (TokenExpiredError, OAuthError):
        return {"organizations": []}

    organizations = await list_linkedin_organizations(access_token)
    return {"organizations": organizations}
