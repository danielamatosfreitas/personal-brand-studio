"""
app/services/oauth_service.py
Lógica de negócio para o fluxo OAuth 2.0 do LinkedIn e Instagram.
Responsabilidades:
  - Gerar URLs de autorização
  - Trocar authorization code por access_token
  - Salvar/atualizar credenciais criptografadas no banco
  - Detectar e tratar token expirado
"""
import uuid
import secrets
from datetime import datetime, timezone, timedelta
from urllib.parse import urlencode

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.core.config import settings, encrypt_token, decrypt_token
from app.db.models import OAuthCredential, PlatformEnum

import logging
logger = logging.getLogger("oauth")


# ── URLs das APIs ──────────────────────────────────────────────────────────────

LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization"
LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo"
LINKEDIN_ORGANIZATION_ACLS_URL = "https://api.linkedin.com/v2/organizationAcls"
LINKEDIN_ORGANIZATION_URL = "https://api.linkedin.com/v2/organizations/{org_id}"

# Instagram API with Instagram Login (fluxo nativo do Instagram, sem passar
# pela tela de login do Facebook / sem precisar de Página do Facebook vinculada).
# Requer um app configurado com o produto "Instagram" no Meta for Developers
# (não o produto "Facebook Login for Business").
INSTAGRAM_AUTH_URL = "https://www.instagram.com/oauth/authorize"
INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token"
INSTAGRAM_LONG_LIVED_URL = "https://graph.instagram.com/access_token"
INSTAGRAM_REFRESH_URL = "https://graph.instagram.com/refresh_access_token"
INSTAGRAM_ME_URL = f"https://graph.instagram.com/{settings.INSTAGRAM_API_VERSION}/me"

# Token de longa duração do Instagram (60 dias): renovado sozinho quando faltam
# menos de RENOVAR_ANTES_DIAS para vencer. A Meta só renova token com mais de
# 24 horas de vida que ainda não venceu.
RENOVAR_ANTES_DIAS = 15
IDADE_MINIMA_RENOVACAO = timedelta(hours=24)


# ── Exceções customizadas ──────────────────────────────────────────────────────

class TokenExpiredError(Exception):
    """Lançada quando o token OAuth está expirado e não há refresh disponível."""
    pass


class OAuthError(Exception):
    """Erros gerais durante o fluxo OAuth."""
    pass


# ── LinkedIn ───────────────────────────────────────────────────────────────────

def get_linkedin_auth_url() -> tuple[str, str]:
    """
    Gera a URL de autorização do LinkedIn e um state aleatório para CSRF.
    Retorna: (url, state)
    """
    state = secrets.token_urlsafe(32)
    params = {
        "response_type": "code",
        "client_id": settings.LINKEDIN_CLIENT_ID,
        "redirect_uri": settings.LINKEDIN_REDIRECT_URI,
        "state": state,
        "scope": settings.LINKEDIN_SCOPES,
    }
    url = f"{LINKEDIN_AUTH_URL}?{urlencode(params)}"
    return url, state


async def exchange_linkedin_code(
    code: str,
    db: AsyncSession,
    user_id: uuid.UUID,
) -> OAuthCredential:
    """
    Troca o authorization code por access_token e salva no banco.
    O LinkedIn não fornece refresh_token — o token dura 60 dias.
    """
    async with httpx.AsyncClient() as client:
        response = await client.post(
            LINKEDIN_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.LINKEDIN_REDIRECT_URI,
                "client_id": settings.LINKEDIN_CLIENT_ID,
                "client_secret": settings.LINKEDIN_CLIENT_SECRET,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    if response.status_code != 200:
        raise OAuthError(f"LinkedIn token exchange falhou: {response.text}")

    data = response.json()
    access_token = data["access_token"]
    # LinkedIn tokens duram 60 dias por padrão
    expires_in = data.get("expires_in", 5184000)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    # Busca o ID do usuário na plataforma
    platform_user_id = await _get_linkedin_user_id(access_token)

    # Salva ou atualiza a credencial no banco
    credential = await _upsert_credential(
        db=db,
        user_id=user_id,
        platform=PlatformEnum.linkedin,
        access_token=access_token,
        refresh_token=None,
        expires_at=expires_at,
        scope=settings.LINKEDIN_SCOPES,
        platform_user_id=platform_user_id,
    )
    return credential


async def _get_linkedin_user_id(access_token: str) -> str:
    """Busca o sub (ID único) do usuário autenticado no LinkedIn."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            LINKEDIN_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if response.status_code != 200:
        raise OAuthError(f"Falha ao buscar perfil LinkedIn: {response.text}")
    return response.json().get("sub", "")


async def list_linkedin_organizations(access_token: str) -> list[dict]:
    """
    Lista as Páginas de empresa que a usuária administra no LinkedIn
    (exige o escopo w_organization_social). Nunca levanta exceção -- qualquer
    falha (token sem o escopo novo, produto não habilitado no app, etc.)
    devolve lista vazia, e a interface trata isso como "sem Páginas
    disponíveis", não como erro.
    """
    headers = {
        "Authorization": f"Bearer {access_token}",
        "X-Restli-Protocol-Version": "2.0.0",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            acls_response = await client.get(
                LINKEDIN_ORGANIZATION_ACLS_URL,
                params={"q": "roleAssignee", "role": "ADMINISTRATOR", "state": "APPROVED"},
                headers=headers,
            )
        if acls_response.status_code != 200:
            return []

        elements = acls_response.json().get("elements", [])
        orgs: list[dict] = []

        async with httpx.AsyncClient(timeout=15.0) as client:
            for el in elements:
                org_urn = el.get("organization")  # "urn:li:organization:12345"
                if not org_urn:
                    continue
                org_id = org_urn.rsplit(":", 1)[-1]
                org_response = await client.get(
                    LINKEDIN_ORGANIZATION_URL.format(org_id=org_id),
                    headers=headers,
                )
                if org_response.status_code != 200:
                    continue
                name = org_response.json().get("localizedName")
                if name:
                    orgs.append({"urn": org_urn, "name": name})

        return orgs
    except Exception:
        return []


# ── Instagram / Meta ───────────────────────────────────────────────────────────

def get_instagram_auth_url() -> tuple[str, str]:
    """
    Gera a URL de autorização do Meta/Instagram e um state aleatório.
    Retorna: (url, state)
    """
    state = secrets.token_urlsafe(32)
    params = {
        "client_id": settings.INSTAGRAM_APP_ID,
        "redirect_uri": settings.INSTAGRAM_REDIRECT_URI,
        "scope": settings.INSTAGRAM_SCOPES,
        "response_type": "code",
        "state": state,
    }
    url = f"{INSTAGRAM_AUTH_URL}?{urlencode(params)}"
    return url, state


async def exchange_instagram_code(
    code: str,
    db: AsyncSession,
    user_id: uuid.UUID,
) -> OAuthCredential:
    """
    Troca o code por um short-lived token e depois pelo long-lived token (60 dias).
    """
    # 1. Troca code → short-lived token (Instagram Login: POST form-encoded,
    #    diferente do fluxo antigo via Facebook que usava GET)
    async with httpx.AsyncClient() as client:
        response = await client.post(
            INSTAGRAM_TOKEN_URL,
            data={
                "client_id": settings.INSTAGRAM_APP_ID,
                "client_secret": settings.INSTAGRAM_APP_SECRET,
                "redirect_uri": settings.INSTAGRAM_REDIRECT_URI,
                "code": code,
                "grant_type": "authorization_code",
            },
        )

    if response.status_code != 200:
        raise OAuthError(f"Instagram token exchange falhou: {response.text}")

    short_token = response.json().get("access_token")
    if not short_token:
        raise OAuthError("Instagram não retornou access_token.")

    # 2. Troca short-lived → long-lived token (60 dias)
    long_token_data = await _exchange_instagram_long_lived(short_token)
    access_token = long_token_data["access_token"]
    expires_in = long_token_data.get("expires_in", 5184000)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    # 3. Busca ID do usuário na plataforma
    platform_user_id = await _get_instagram_user_id(access_token)

    credential = await _upsert_credential(
        db=db,
        user_id=user_id,
        platform=PlatformEnum.instagram,
        access_token=access_token,
        refresh_token=None,
        expires_at=expires_at,
        scope=settings.INSTAGRAM_SCOPES,
        platform_user_id=platform_user_id,
    )
    return credential


async def _exchange_instagram_long_lived(short_token: str) -> dict:
    """Converte um short-lived token Meta em long-lived (60 dias)."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            INSTAGRAM_LONG_LIVED_URL,
            params={
                "grant_type": "ig_exchange_token",
                "client_secret": settings.INSTAGRAM_APP_SECRET,
                "access_token": short_token,
            },
        )
    if response.status_code != 200:
        raise OAuthError(f"Falha ao obter long-lived token: {response.text}")
    return response.json()


async def _get_instagram_user_id(access_token: str) -> str:
    """Busca o ID da conta profissional do Instagram (user_id; o campo id é o
    ID do usuário dentro do app)."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            INSTAGRAM_ME_URL,
            params={"fields": "user_id,username"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if response.status_code != 200:
        return ""
    dados = response.json()
    return str(dados.get("user_id") or dados.get("id") or "")


async def _credencial(db: AsyncSession, user_id: uuid.UUID, platform: PlatformEnum) -> OAuthCredential | None:
    result = await db.execute(
        select(OAuthCredential).where(
            and_(OAuthCredential.user_id == user_id, OAuthCredential.platform == platform)
        )
    )
    return result.scalar_one_or_none()


async def renova_token_instagram(db: AsyncSession, credential: OAuthCredential, forcar: bool = False) -> str:
    """
    Renova o token de longa duração do Instagram se faltarem menos de
    RENOVAR_ANTES_DIAS para vencer (ou se forcar=True). Devolve o que
    aconteceu: "renovado", "nao_precisa", "muito_novo" ou "falhou: <motivo>".
    Nunca levanta exceção nem registra o token.
    """
    agora = datetime.now(timezone.utc)
    if credential.is_expired():
        return "falhou: token já vencido, precisa reconectar"
    if not forcar and credential.token_expires_at - agora > timedelta(days=RENOVAR_ANTES_DIAS):
        return "nao_precisa"
    emitido = credential.updated_at or credential.created_at
    if emitido and agora - emitido < IDADE_MINIMA_RENOVACAO:
        return "muito_novo"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                INSTAGRAM_REFRESH_URL,
                params={"grant_type": "ig_refresh_token"},
                headers={"Authorization": f"Bearer {decrypt_token(credential.access_token)}"},
            )
        dados = response.json() if response.status_code == 200 else {}
    except Exception as e:
        return f"falhou: {type(e).__name__}"
    novo = dados.get("access_token")
    if not novo:
        return f"falhou: HTTP {response.status_code}"
    credential.access_token = encrypt_token(novo)
    credential.token_expires_at = agora + timedelta(seconds=int(dados.get("expires_in", 5184000)))
    await db.commit()
    return "renovado"


async def get_instagram_token(db: AsyncSession, user_id: uuid.UUID) -> str:
    """Token do Instagram pronto para usar, renovado antes se estiver perto de vencer."""
    credential = await _credencial(db, user_id, PlatformEnum.instagram)
    if not credential:
        raise OAuthError("O Instagram não está conectado. Conecte o Instagram em Conexões.")
    if credential.is_expired():
        raise TokenExpiredError("A conexão com o Instagram venceu. Reconecte o Instagram em Conexões.")
    await renova_token_instagram(db, credential)
    return decrypt_token(credential.access_token)


# ── Facebook (Fase 4) ──────────────────────────────────────────────────────────
# Login do Facebook só para publicar na página da empresa. O token guardado é
# o da PÁGINA, obtido a partir de um token de usuário de longa duração; pela
# documentação da Meta ("Long-lived Page access token do not have an
# expiration date"), ele não vence por data, só se for invalidado (senha
# trocada, permissão retirada, perda do papel na página). Por isso não há
# renovação: o agendador confere a cada 6 horas se ele continua valendo.

FACEBOOK_SEM_VALIDADE = timedelta(days=3650)


def _fb_graph() -> str:
    return f"https://graph.facebook.com/{settings.FACEBOOK_API_VERSION}"


def get_facebook_auth_url() -> tuple[str, str]:
    state = secrets.token_urlsafe(32)
    params = {
        "client_id": settings.FACEBOOK_APP_ID,
        "redirect_uri": settings.FACEBOOK_REDIRECT_URI,
        "state": state,
        "scope": settings.FACEBOOK_SCOPES,
        "response_type": "code",
    }
    return f"https://www.facebook.com/{settings.FACEBOOK_API_VERSION}/dialog/oauth?{urlencode(params)}", state


async def _fb_token(client: httpx.AsyncClient, dados: dict) -> str:
    """Troca no endpoint oauth/access_token. Chave e tokens vão no corpo do
    pedido (nunca no endereço); o erro devolvido não repete nenhum deles."""
    response = await client.post(f"{_fb_graph()}/oauth/access_token", data={
        "client_id": settings.FACEBOOK_APP_ID, "client_secret": settings.FACEBOOK_APP_SECRET, **dados})
    token = response.json().get("access_token") if response.status_code == 200 else None
    if not token:
        erro = (response.json().get("error") or {}) if response.headers.get("content-type", "").startswith(("application/json", "text/javascript")) else {}
        logger.warning(f"[facebook] troca de código recusada: HTTP {response.status_code}, código {erro.get('code')}/{erro.get('error_subcode')}")
        raise OAuthError("A Meta não confirmou a autorização. Clique em Conectar de novo e conclua a tela da Meta até o fim.")
    return token


async def exchange_facebook_code(code: str, db: AsyncSession, user_id: uuid.UUID) -> OAuthCredential:
    """code -> token de usuário -> token de usuário de longa duração -> token
    da página da empresa (só ela; as outras páginas nunca são guardadas)."""
    from app.services.facebook_service import escolhe_pagina, confere_permissoes, eh_a_pagina, FacebookError

    async with httpx.AsyncClient(timeout=30.0) as client:
        curto = await _fb_token(client, {"redirect_uri": settings.FACEBOOK_REDIRECT_URI, "code": code})
        longo = await _fb_token(client, {"grant_type": "fb_exchange_token", "fb_exchange_token": curto})
        contas = await client.get(f"{_fb_graph()}/me/accounts", params={"fields": "id,name,access_token,tasks", "limit": "100"},
                                  headers={"Authorization": f"Bearer {longo}"})
        # Permissões que a pessoa de fato concedeu (pode ter desmarcado alguma
        # na tela da Meta); ficam guardadas na conexão para conferência.
        concedidas = await client.get(f"{_fb_graph()}/me/permissions", headers={"Authorization": f"Bearer {longo}"})
        paginas = contas.json().get("data", []) if contas.status_code == 200 else None
        lidas_em_accounts = [{"id": p.get("id"), "nome": p.get("name")} for p in (paginas or [])]
        # Página de um portfólio empresarial não aparece em /me/accounts sem a
        # permissão business_management. Nesse caso, o token da Página vem do
        # próprio nó da Página: o campo access_token do nó Page é entregue a
        # quem tem papel na Página (referência Graph API, Page). Só a Página
        # da trava é pedida; nenhuma outra é consultada.
        direta = None
        if settings.FACEBOOK_PAGE_ID and not any(eh_a_pagina(p) for p in (paginas or [])):
            direta = await client.get(f"{_fb_graph()}/{settings.FACEBOOK_PAGE_ID}",
                                      params={"fields": "id,name,access_token"},
                                      headers={"Authorization": f"Bearer {longo}"})
            if direta.status_code == 200 and direta.json().get("id"):
                paginas = [*(paginas or []), direta.json()]
    granted = sorted(p.get("permission", "") for p in (concedidas.json().get("data", []) if concedidas.status_code == 200 else [])
                     if p.get("status") == "granted")
    # Diagnóstico no log (sem token): permissões concedidas, Páginas de
    # /me/accounts (id e nome) e o resultado da consulta direta à Página.
    if direta is None:
        consulta = "não precisou"
    elif direta.status_code == 200:
        consulta = f"ok, com acesso à Página: {'sim' if direta.json().get('access_token') else 'não'}"
    else:
        erro = (direta.json().get("error") or {}) if direta.headers.get("content-type", "").startswith(("application/json", "text/javascript")) else {}
        consulta = f"HTTP {direta.status_code}, código {erro.get('code')}/{erro.get('error_subcode')}"
    logger.warning(f"[facebook] conexão: permissões {granted or 'não lidas'}; Páginas em /me/accounts: "
                   f"{lidas_em_accounts if contas.status_code == 200 else f'erro HTTP {contas.status_code}'}; "
                   f"consulta direta à Página {settings.FACEBOOK_PAGE_ID or '(sem ID)'}: {consulta}")
    try:
        if concedidas.status_code == 200:
            confere_permissoes(granted)
        if paginas is None:
            raise FacebookError("A Meta não mostrou as Páginas do seu perfil. Clique em Conectar de novo; se repetir, avise o suporte.")
        if direta is not None and not any(eh_a_pagina(p) for p in paginas):
            raise FacebookError(f'A Meta autorizou o app, mas não entregou o acesso à Página "{settings.FACEBOOK_PAGE_NAME}". '
                                "Confira se o seu perfil tem acesso total à Página, clique em Conectar de novo e marque a Página "
                                "na tela da Meta; se repetir, avise o suporte.")
        pagina = escolhe_pagina(paginas)
    except FacebookError as e:
        raise OAuthError(str(e))

    return await _upsert_credential(
        db=db, user_id=user_id, platform=PlatformEnum.facebook,
        access_token=pagina["access_token"], refresh_token=None,
        expires_at=datetime.now(timezone.utc) + FACEBOOK_SEM_VALIDADE,
        scope=",".join(granted) if granted else settings.FACEBOOK_SCOPES, platform_user_id=str(pagina["id"]),
    )


async def facebook_permissoes(db: AsyncSession, user_id: uuid.UUID) -> list[str]:
    """Permissões guardadas na conexão do Facebook (as concedidas na conexão)."""
    credential = await _credencial(db, user_id, PlatformEnum.facebook)
    return [p for p in (credential.scope or "").split(",") if p] if credential else []


async def get_facebook_token(db: AsyncSession, user_id: uuid.UUID) -> tuple[str, str]:
    """(token da página, id da página gravado na conexão)."""
    credential = await _credencial(db, user_id, PlatformEnum.facebook)
    if not credential or not credential.platform_user_id:
        raise OAuthError("O Facebook não está conectado. Conecte o Facebook em Conexões.")
    if credential.is_expired():
        raise TokenExpiredError("A conexão com o Facebook deixou de valer. Reconecte o Facebook em Conexões.")
    return decrypt_token(credential.access_token), credential.platform_user_id


async def confere_token_facebook(db: AsyncSession, credential: OAuthCredential) -> str:
    """Conferência do agendador (a cada 6 horas): o token da página ainda vale?
    Se o Facebook disser que não (código 190), a conexão é marcada como vencida
    para a tela pedir reconexão. Nunca levanta exceção nem registra o token."""
    if credential.is_expired():
        return "vencido"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(f"{_fb_graph()}/{credential.platform_user_id}", params={"fields": "id"},
                                 headers={"Authorization": f"Bearer {decrypt_token(credential.access_token)}"})
        erro = r.json().get("error") if r.status_code != 200 else None
    except Exception as e:
        return f"sem resposta: {type(e).__name__}"
    if r.status_code == 200:
        return "valido"
    if erro and erro.get("code") == 190:
        credential.token_expires_at = datetime.now(timezone.utc)
        await db.commit()
        return "invalidado"
    return f"sem confirmação: HTTP {r.status_code}"


# ── Helpers compartilhados ─────────────────────────────────────────────────────

async def _upsert_credential(
    db: AsyncSession,
    user_id: uuid.UUID,
    platform: PlatformEnum,
    access_token: str,
    refresh_token: str | None,
    expires_at: datetime,
    scope: str,
    platform_user_id: str,
) -> OAuthCredential:
    """
    Cria ou atualiza a credencial OAuth de uma plataforma para o usuário.
    Tokens são criptografados antes de salvar.
    """
    result = await db.execute(
        select(OAuthCredential).where(
            and_(
                OAuthCredential.user_id == user_id,
                OAuthCredential.platform == platform,
            )
        )
    )
    credential = result.scalar_one_or_none()

    encrypted_access = encrypt_token(access_token)
    encrypted_refresh = encrypt_token(refresh_token) if refresh_token else None

    if credential:
        # Atualiza token existente
        credential.access_token = encrypted_access
        credential.refresh_token = encrypted_refresh
        credential.token_expires_at = expires_at
        credential.scope = scope
        credential.platform_user_id = platform_user_id
    else:
        # Cria nova credencial
        credential = OAuthCredential(
            user_id=user_id,
            platform=platform,
            access_token=encrypted_access,
            refresh_token=encrypted_refresh,
            token_expires_at=expires_at,
            scope=scope,
            platform_user_id=platform_user_id,
        )
        db.add(credential)

    await db.commit()
    await db.refresh(credential)
    return credential


async def get_valid_token(
    db: AsyncSession,
    user_id: uuid.UUID,
    platform: PlatformEnum,
) -> str:
    """
    Recupera o access_token descriptografado de uma plataforma.
    Lança TokenExpiredError se o token estiver vencido.
    Lança OAuthError se não houver credencial cadastrada.
    """
    result = await db.execute(
        select(OAuthCredential).where(
            and_(
                OAuthCredential.user_id == user_id,
                OAuthCredential.platform == platform,
            )
        )
    )
    credential = result.scalar_one_or_none()

    if not credential:
        raise OAuthError(
            f"Plataforma '{platform}' não está conectada. "
            "Acesse /oauth/{platform}/authorize para autenticar."
        )

    if credential.is_expired():
        raise TokenExpiredError(
            f"O token do {platform} está expirado. "
            "Reconecte a conta em /oauth/{platform}/authorize."
        )

    return decrypt_token(credential.access_token)
