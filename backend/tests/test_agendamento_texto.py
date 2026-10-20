"""
Fase 4 (acréscimo de 15/10): post só de texto, sem arquivo.
- LinkedIn: aceito na hora ou agendado; o agendador publica como texto puro.
- Instagram (ou os dois canais): recusado já na criação, com mensagem clara.
Tudo simulado: o banco é falso e as chamadas ao LinkedIn são interceptadas.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
import respx
from fastapi import HTTPException

from app.api.v1.endpoints import posts as posts_endpoints
from app.db.models import OAuthCredential, PlatformEnum, PostStatusEnum
from app.schemas.schemas import PostCreate
from app.services import publishing_service as ps
from app.services import scheduler_service as ss

USUARIO = uuid.uuid4()
PESSOA = "abc123"


class _Resultado:
    def __init__(self, valor):
        self.valor = valor

    def scalar_one_or_none(self):
        return self.valor

    def scalars(self):
        return SimpleNamespace(all=lambda: self.valor)


class _Banco:
    """Banco falso: guarda o que foi criado e responde às consultas em ordem."""

    def __init__(self, respostas=None):
        self.respostas = list(respostas or [])
        self.adicionados = []
        self.commits = 0

    def add(self, obj):
        self.adicionados.append(obj)

    async def execute(self, _consulta):
        return _Resultado(self.respostas.pop(0))

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()


@pytest.fixture(autouse=True)
def sem_rede(monkeypatch):
    async def primeiro_usuario(db):
        return USUARIO

    async def get_valid_token(db, user_id, platform):
        return "token-de-teste"

    monkeypatch.setattr(posts_endpoints, "_get_first_user_id", primeiro_usuario)
    monkeypatch.setattr(ps, "get_valid_token", get_valid_token)


def _daqui_a(minutos):
    return datetime.now(timezone.utc) + timedelta(minutes=minutos)


@pytest.mark.asyncio
@pytest.mark.parametrize("org", [None, "urn:li:organization:999"])
async def test_linkedin_so_texto_agendado_e_publicado_pelo_agendador(monkeypatch, org):
    # 1. criação: sem arquivo, com data futura, perfil pessoal ou Página
    db = _Banco()
    payload = PostCreate(platform=PlatformEnum.linkedin, content="Post só com texto.",
                         scheduled_at=_daqui_a(30), linkedin_organization_urn=org)
    post = await posts_endpoints.create_post(payload, db)
    assert post.status == PostStatusEnum.scheduled
    assert not post.media_urls
    post.user_id = USUARIO

    # 2. a hora chega: o agendador encontra o post e publica pelo caminho real
    cred = OAuthCredential(platform=PlatformEnum.linkedin, platform_user_id=PESSOA)
    banco_agendador = _Banco([[post], post, cred])

    class _Sessao:
        async def __aenter__(self):
            return banco_agendador

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(ss, "AsyncSessionLocal", lambda: _Sessao())
    with respx.mock(assert_all_called=False) as m:
        ugc = m.post(ps.LINKEDIN_UGC_POST_URL).mock(return_value=httpx.Response(201, headers={"x-restli-id": "urn:li:share:1"}))
        rest = m.post("https://api.linkedin.com/rest/posts")
        await ss._publish_due_posts()

    # 3. saiu como texto puro, pelo autor certo, e o post ficou publicado
    assert ugc.call_count == 1 and rest.call_count == 0
    corpo = json.loads(ugc.calls[0].request.content)
    conteudo = corpo["specificContent"]["com.linkedin.ugc.ShareContent"]
    assert conteudo["shareCommentary"]["text"] == "Post só com texto."
    assert conteudo["shareMediaCategory"] == "NONE"
    assert corpo["author"] == (org or f"urn:li:person:{PESSOA}")
    assert post.status == PostStatusEnum.published
    assert post.platform_post_id == "urn:li:share:1"


@pytest.mark.asyncio
async def test_linkedin_so_texto_na_hora_vira_rascunho_pronto_para_publicar():
    db = _Banco()
    post = await posts_endpoints.create_post(PostCreate(platform=PlatformEnum.linkedin, content="Agora."), db)
    assert post.status == PostStatusEnum.draft and not post.media_urls


@pytest.mark.asyncio
@pytest.mark.parametrize("plataforma", [PlatformEnum.instagram, PlatformEnum.both])
@pytest.mark.parametrize("agendado", [False, True])
async def test_instagram_sem_arquivo_e_recusado_com_mensagem_clara(plataforma, agendado):
    db = _Banco()
    payload = PostCreate(platform=plataforma, content="Texto", media_urls=[],
                         scheduled_at=_daqui_a(30) if agendado else None)
    with pytest.raises(HTTPException) as erro:
        await posts_endpoints.create_post(payload, db)
    assert erro.value.status_code == 422
    assert "Instagram não aceita publicação só com texto" in erro.value.detail
    assert db.adicionados == [] and db.commits == 0
    assert not any(c in erro.value.detail for c in "–—")


@pytest.mark.asyncio
async def test_instagram_com_arquivo_continua_aceito():
    db = _Banco()
    post = await posts_endpoints.create_post(
        PostCreate(platform=PlatformEnum.instagram, content="Texto", media_urls=["https://midia.teste/a.jpg"]), db)
    assert post.status == PostStatusEnum.draft
