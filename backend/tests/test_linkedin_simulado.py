"""
Publicação no LinkedIn em modo simulado: as chamadas HTTP são interceptadas
(respx) e nada é publicado de verdade. Confere, para cada tipo de post, que o
backend chama as rotas certas do LinkedIn com o autor certo (perfil pessoal ou
Página de empresa), e que o agendador publica os posts vencidos.
"""
import asyncio
import json
import uuid
from types import SimpleNamespace

import httpx
import pytest
import respx

from app.db.models import OAuthCredential, PlatformEnum, Post, PostStatusEnum
from app.services import linkedin_documents_service as lds
from app.services import publishing_service as ps
from app.services import scheduler_service as ss

MIDIA = "https://midia.teste/storage/v1/object/public/personal-brand-media"
PESSOA = "abc123"
EMPRESA = "urn:li:organization:999"


@pytest.fixture(autouse=True)
def token_falso(monkeypatch):
    async def get_valid_token(db, user_id, platform):
        return "token-de-teste"
    monkeypatch.setattr(ps, "get_valid_token", get_valid_token)

    async def titulo(db, post_id):
        return "Quando tudo passa pelo dono"
    monkeypatch.setattr(ps, "titulo_do_documento", titulo)

    async def sem_espera(_):
        return None
    monkeypatch.setattr(lds.asyncio, "sleep", sem_espera)


def _post(media_urls=None, org=None):
    return SimpleNamespace(id=uuid.uuid4(), content="Texto do post", media_urls=media_urls or [], linkedin_organization_urn=org, title=None)


def _autor(chamada) -> str:
    return json.loads(chamada.request.content)["author"]


def _mock_linkedin(m: respx.MockRouter):
    m.post(f"{lds.LINKEDIN_DOCUMENTS_URL}?action=initializeUpload").mock(return_value=httpx.Response(
        200, json={"value": {"uploadUrl": "https://upload.teste/doc", "document": "urn:li:document:1"}}))
    m.post(f"{lds.LINKEDIN_IMAGES_URL}?action=initializeUpload").mock(side_effect=[
        httpx.Response(200, json={"value": {"uploadUrl": f"https://upload.teste/img{i}", "image": f"urn:li:image:{i}"}}) for i in range(9)])
    m.post(f"{lds.LINKEDIN_VIDEOS_URL}?action=initializeUpload").mock(return_value=httpx.Response(
        200, json={"value": {"uploadInstructions": [{"uploadUrl": "https://upload.teste/vid", "firstByte": 0, "lastByte": 9}],
                             "video": "urn:li:video:1", "uploadToken": "t"}}))
    m.put(url__startswith="https://upload.teste/").mock(return_value=httpx.Response(201, headers={"ETag": "e1"}))
    m.post(f"{lds.LINKEDIN_VIDEOS_URL}?action=finalizeUpload").mock(return_value=httpx.Response(200))
    m.get(url__startswith=f"{lds.LINKEDIN_VIDEOS_URL}/").mock(return_value=httpx.Response(200, json={"status": "AVAILABLE"}))
    posts = m.post(lds.LINKEDIN_POSTS_URL).mock(return_value=httpx.Response(201, headers={"x-restli-id": "urn:li:share:rest"}))
    ugc = m.post(ps.LINKEDIN_UGC_POST_URL).mock(return_value=httpx.Response(201, headers={"x-restli-id": "urn:li:share:ugc"}))
    m.get(url__startswith=MIDIA).mock(return_value=httpx.Response(200, content=b"0123456789"))
    return posts, ugc


@pytest.mark.asyncio
@pytest.mark.parametrize("org", [None, EMPRESA])
async def test_texto(org):
    with respx.mock(assert_all_called=False) as m:
        posts, ugc = _mock_linkedin(m)
        urn = await ps.publish_to_linkedin(None, _post(org=org), uuid.uuid4(), PESSOA)
    assert urn == "urn:li:share:ugc" and ugc.call_count == 1 and posts.call_count == 0
    assert _autor(ugc.calls[0]) == (org or f"urn:li:person:{PESSOA}")


@pytest.mark.asyncio
@pytest.mark.parametrize("org", [None, EMPRESA])
async def test_pdf_carrossel(org):
    with respx.mock(assert_all_called=False) as m:
        posts, _ = _mock_linkedin(m)
        urn = await ps.publish_to_linkedin(None, _post([f"{MIDIA}/a.pdf"], org), uuid.uuid4(), PESSOA)
    assert urn == "urn:li:share:rest"
    corpo = json.loads(posts.calls[0].request.content)
    assert corpo["content"]["media"]["id"] == "urn:li:document:1"
    assert corpo["content"]["media"]["title"] == "Quando tudo passa pelo dono"  # do campo, nunca da legenda
    assert corpo["author"] == (org or f"urn:li:person:{PESSOA}")


@pytest.mark.asyncio
async def test_pdf_sem_titulo_nao_sai_e_nao_chama_o_linkedin(monkeypatch):
    async def sem_titulo(db, post_id):
        return None
    monkeypatch.setattr(ps, "titulo_do_documento", sem_titulo)
    with respx.mock(assert_all_called=False) as m:
        _mock_linkedin(m)
        with pytest.raises(ps.PublishError) as e:
            await ps.publish_to_linkedin(None, _post([f"{MIDIA}/a.pdf"]), uuid.uuid4(), PESSOA)
        assert len(m.calls) == 0
    assert "falta o título do documento" in str(e.value) and "legenda" in str(e.value)


@pytest.mark.asyncio
async def test_imagem_unica():
    with respx.mock(assert_all_called=False) as m:
        posts, _ = _mock_linkedin(m)
        await ps.publish_to_linkedin(None, _post([f"{MIDIA}/a.jpg"]), uuid.uuid4(), PESSOA)
    assert json.loads(posts.calls[0].request.content)["content"]["media"]["id"] == "urn:li:image:0"


@pytest.mark.asyncio
async def test_galeria_de_imagens():
    with respx.mock(assert_all_called=False) as m:
        posts, _ = _mock_linkedin(m)
        await ps.publish_to_linkedin(None, _post([f"{MIDIA}/{i}.png" for i in range(3)], EMPRESA), uuid.uuid4(), PESSOA)
    corpo = json.loads(posts.calls[0].request.content)
    assert [i["id"] for i in corpo["content"]["multiImage"]["images"]] == ["urn:li:image:0", "urn:li:image:1", "urn:li:image:2"]
    assert corpo["author"] == EMPRESA


@pytest.mark.asyncio
async def test_video():
    with respx.mock(assert_all_called=False) as m:
        posts, _ = _mock_linkedin(m)
        await ps.publish_to_linkedin(None, _post([f"{MIDIA}/v.mp4"]), uuid.uuid4(), PESSOA)
    assert json.loads(posts.calls[0].request.content)["content"]["media"]["id"] == "urn:li:video:1"


class _Resultado:
    def __init__(self, valor):
        self.valor = valor

    def scalar_one_or_none(self):
        return self.valor

    def scalars(self):
        return SimpleNamespace(all=lambda: self.valor)


class _BancoFalso:
    def __init__(self, respostas):
        self.respostas = list(respostas)
        self.commits = 0

    async def execute(self, _consulta):
        return _Resultado(self.respostas.pop(0))

    async def commit(self):
        self.commits += 1

    async def refresh(self, _obj):
        return None


@pytest.mark.asyncio
async def test_publish_post_marca_publicado():
    usuario = uuid.uuid4()
    post = Post(id=uuid.uuid4(), user_id=usuario, platform=PlatformEnum.linkedin, content="Texto",
                media_urls=[], status=PostStatusEnum.scheduled)
    cred = OAuthCredential(platform=PlatformEnum.linkedin, platform_user_id=PESSOA)
    db = _BancoFalso([post, cred])
    with respx.mock(assert_all_called=False) as m:
        _, ugc = _mock_linkedin(m)
        r = await ps.publish_post(db, post.id, usuario)
    assert r["results"]["linkedin"]["success"] is True
    assert post.status == PostStatusEnum.published and db.commits == 1
    assert _autor(ugc.calls[0]) == f"urn:li:person:{PESSOA}"


@pytest.mark.asyncio
async def test_agendador_publica_os_posts_vencidos(monkeypatch):
    vencidos = [SimpleNamespace(id=uuid.uuid4(), user_id=uuid.uuid4()) for _ in range(2)]
    publicados = []

    class _Sessao:
        async def __aenter__(self):
            return _BancoFalso([vencidos])

        async def __aexit__(self, *a):
            return False

    async def publish_post(db, post_id, user_id):
        publicados.append(post_id)

    monkeypatch.setattr(ss, "AsyncSessionLocal", lambda: _Sessao())
    monkeypatch.setattr(ss, "publish_post", publish_post)
    await ss._publish_due_posts()
    assert publicados == [p.id for p in vencidos]
