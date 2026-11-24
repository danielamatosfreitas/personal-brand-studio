"""
Fase 4 (16/10): publicação na página do Facebook "Capital Humano Intelligence".
Tudo simulado: o Facebook é interceptado (respx), o bucket e o banco são falsos.
"""
import io
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
import respx
from fastapi import HTTPException
from PIL import Image

from app.api.v1.endpoints import posts as posts_endpoints
from app.core.config import encrypt_token, decrypt_token, settings
from app.db.models import OAuthCredential, Post, PlatformEnum, PostStatusEnum
from app.schemas.schemas import PostCreate
from app.services import facebook_service as fb
from app.services import instagram_service as ig
from app.services import oauth_service as oa
from app.services import publishing_service as ps
from app.services import scheduler_service as ss

USUARIO = uuid.uuid4()
TOKEN = "token-da-pagina-de-teste"
PAGINA = "111222333"
OUTRA = "999888777"
G = fb.graph_url()


@pytest.fixture(autouse=True)
def trava_pelo_id(monkeypatch):
    """A trava compara pelo FACEBOOK_PAGE_ID; nos testes, o da página simulada."""
    monkeypatch.setattr(settings, "FACEBOOK_PAGE_ID", PAGINA)


class _Resultado:
    def __init__(self, valor):
        self.valor = valor

    def scalar_one_or_none(self):
        return self.valor

    def scalars(self):
        return SimpleNamespace(all=lambda: self.valor)


class _Banco:
    def __init__(self, respostas=None):
        self.respostas = list(respostas or [])
        self.adicionados, self.commits, self.rollbacks = [], 0, 0

    def add(self, obj):
        self.adicionados.append(obj)

    async def execute(self, _consulta):
        return _Resultado(self.respostas.pop(0))

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1

    async def refresh(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()


def _png():
    out = io.BytesIO()
    Image.new("RGB", (1080, 1350), (44, 74, 59)).save(out, format="PNG")
    return out.getvalue()


@pytest.fixture
def bucket(monkeypatch):
    monkeypatch.setattr(fb.storage_service, "resolve_media_url",
                        lambda ref: f"https://bucket.teste/origem/{ref.split('://')[-1]}")
    monkeypatch.setattr(ig.storage_service, "resolve_media_url",
                        lambda ref: f"https://bucket.teste/origem/{ref.split('://')[-1]}")
    monkeypatch.setattr(ig.storage_service, "_sobe", lambda *a: None)
    monkeypatch.setattr(ig.storage_service, "presigned_url", lambda chave, ttl=None: f"https://bucket.teste/{chave}?x=1")
    monkeypatch.setattr(ig.storage_service, "client", lambda: SimpleNamespace(delete_object=lambda **k: None))


def _origens(m, n):
    for i in range(n):
        m.get(f"https://bucket.teste/origem/slide-{i + 1:02d}.png").mock(return_value=httpx.Response(200, content=_png()))
    return [f"midia://slide-{i + 1:02d}.png" for i in range(n)]


def _facebook(m, falha=None):
    """Simula a página: confere nome, fotos sem publicar, post com várias fotos."""
    m.get(f"{G}/{PAGINA}").mock(return_value=httpx.Response(200, json={"id": PAGINA, "name": "Capital Humano Intelligence"}))
    contador = {"n": 0}

    def foto(request):
        corpo = request.content
        if falha == "upload2" and contador["n"] == 1:
            return httpx.Response(400, json={"error": {"code": 324, "message": "Missing or invalid image file"}})
        contador["n"] += 1
        if b'name="published"\r\n\r\ntrue' in corpo:
            return httpx.Response(200, json={"id": "foto-unica", "post_id": f"{PAGINA}_post-unico"})
        return httpx.Response(200, json={"id": f"foto-{contador['n']}"})

    fotos = m.post(f"{G}/{PAGINA}/photos").mock(side_effect=foto)
    if falha == "feed":
        feed = m.post(f"{G}/{PAGINA}/feed").mock(return_value=httpx.Response(500, json={"error": {"code": 2, "message": "Service unavailable"}}))
    else:
        feed = m.post(f"{G}/{PAGINA}/feed").mock(return_value=httpx.Response(200, json={"id": f"{PAGINA}_post-1"}))
    m.get(host="graph.facebook.com", path__regex=r"/foto-\d+$").mock(return_value=httpx.Response(200, json={"id": "x", "width": 1080, "height": 1350}))
    apaga = m.delete(host="graph.facebook.com", path__regex=r"/foto-\d+$").mock(return_value=httpx.Response(200, json={"success": True}))
    m.get(host="graph.facebook.com", path__regex=r"_post").mock(return_value=httpx.Response(200, json={"permalink_url": "https://www.facebook.com/p/1"}))
    return fotos, feed, apaga


def _sem_token_fora_do_cabecalho(m):
    for c in m.calls:
        if c.request.url.host == "graph.facebook.com":
            assert c.request.headers.get("authorization") == f"Bearer {TOKEN}"
            assert TOKEN not in str(c.request.url) and TOKEN.encode() not in (c.request.content or b"")


# ── Trava de página ────────────────────────────────────────────────────────────

PAGINAS = [
    {"id": OUTRA, "name": "Outra Empresa", "access_token": "token-outra", "tasks": ["CREATE_CONTENT"]},
    {"id": PAGINA, "name": "Capital Humano Intelligence", "access_token": TOKEN, "tasks": ["CREATE_CONTENT", "MANAGE"]},
    {"id": "555", "name": "Página Pessoal", "access_token": "token-pessoal", "tasks": ["CREATE_CONTENT"]},
]


def test_conexao_escolhe_so_a_pagina_da_empresa():
    assert fb.escolhe_pagina(PAGINAS)["id"] == PAGINA


@pytest.mark.parametrize("paginas,trecho", [
    ([], "não liberou nenhuma Página"),
    ([PAGINAS[0], PAGINAS[2]], 'liberou as Páginas "Outra Empresa" e "Página Pessoal", mas não a "Capital Humano Intelligence"'),
    ([PAGINAS[0]], 'liberou a Página "Outra Empresa"'),
    ([PAGINAS[1], {**PAGINAS[1], "name": "Cópia"}], "mais de uma Página"),
    ([{**PAGINAS[1], "tasks": ["ANALYZE"]}], "não pode criar publicações"),
])
def test_conexao_recusa_sem_a_pagina_certa(paginas, trecho):
    with pytest.raises(fb.FacebookError) as e:
        fb.escolhe_pagina(paginas)
    assert trecho in str(e.value)
    texto = str(e.value)  # mensagem de tela: sem termos proibidos nem técnicos
    assert not any(c in texto for c in "–—") and " - " not in texto and " pra " not in texto
    assert "token" not in texto.lower() and "FACEBOOK_" not in texto


def test_trava_compara_pelo_id_e_nao_pelo_nome(monkeypatch):
    # nome escrito de outro jeito, mesmo ID: é a Página da empresa
    assert fb.escolhe_pagina([{**PAGINAS[1], "name": "Capital Humano Intelligence Oficial"}])["id"] == PAGINA
    # mesmo nome, outro ID: recusada
    with pytest.raises(fb.FacebookError):
        fb.escolhe_pagina([{**PAGINAS[1], "id": OUTRA}])
    # sem o monkeypatch, vale o ID configurado (nos testes, o do conftest)
    monkeypatch.undo()
    assert settings.FACEBOOK_PAGE_ID == "100000000000001"


def test_permissao_desmarcada_tem_motivo_claro():
    fb.confere_permissoes(["pages_show_list", "pages_read_engagement", "pages_manage_posts", "public_profile"])
    with pytest.raises(fb.FacebookError) as e:
        fb.confere_permissoes(["pages_show_list", "public_profile"])
    assert "ficou desmarcada a permissão de ler o conteúdo da Página e publicar na Página" in str(e.value)


@pytest.mark.asyncio
async def test_conexao_com_permissao_recusada_nao_grava_nada():
    db = _Banco([None])
    with respx.mock(assert_all_called=False) as m:
        m.post(f"{G}/oauth/access_token").mock(side_effect=[
            httpx.Response(200, json={"access_token": "usuario-curto"}), httpx.Response(200, json={"access_token": "usuario-longo"})])
        m.get(f"{G}/me/accounts").mock(return_value=httpx.Response(200, json={"data": []}))
        m.get(f"{G}/{PAGINA}").mock(return_value=httpx.Response(200, json={"id": PAGINA, "name": "x", "access_token": TOKEN}))
        m.get(f"{G}/me/permissions").mock(return_value=httpx.Response(200, json={"data": [
            {"permission": "pages_show_list", "status": "declined"}, {"permission": "pages_read_engagement", "status": "granted"},
            {"permission": "pages_manage_posts", "status": "granted"}]}))
        with pytest.raises(oa.OAuthError) as e:
            await oa.exchange_facebook_code("codigo", db, USUARIO)
    assert "ver as suas Páginas" in str(e.value) and db.adicionados == [] and db.commits == 0


def test_id_fixo_na_railway_tambem_trava(monkeypatch):
    monkeypatch.setattr(settings, "FACEBOOK_PAGE_ID", "000")
    with pytest.raises(fb.FacebookError):
        fb.escolhe_pagina(PAGINAS)
    with pytest.raises(fb.PaginaErradaError):
        fb.confere_pagina(PAGINA, PAGINA)


@pytest.mark.asyncio
async def test_publicar_em_outra_pagina_e_recusado_sem_chamar_o_facebook(bucket):
    with respx.mock(assert_all_called=False) as m:
        with pytest.raises(fb.PaginaErradaError) as e:
            await fb.publicar(TOKEN, PAGINA, ["midia://slide-01.png"], "x", page_id_destino=OUTRA)
        assert len(m.calls) == 0
    assert "Capital Humano Intelligence" in str(e.value)


@pytest.mark.asyncio
async def test_pagina_com_outro_id_e_recusada_antes_de_subir_fotos(bucket):
    with respx.mock(assert_all_called=False) as m:
        refs = _origens(m, 1)
        m.get(f"{G}/{PAGINA}").mock(return_value=httpx.Response(200, json={"id": OUTRA, "name": "Capital Humano Intelligence"}))
        fotos = m.post(f"{G}/{PAGINA}/photos")
        with pytest.raises(fb.PaginaErradaError):
            await fb.publicar(TOKEN, PAGINA, refs, "x")
    assert fotos.call_count == 0


# ── Publicação ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_uma_imagem_vira_foto_com_legenda(bucket):
    with respx.mock(assert_all_called=False) as m:
        refs = _origens(m, 1)
        fotos, feed, _ = _facebook(m)
        r = await fb.publicar(TOKEN, PAGINA, refs, "Legenda do card")
        _sem_token_fora_do_cabecalho(m)
    corpo = fotos.calls[0].request.content
    assert fotos.call_count == 1 and feed.call_count == 0
    assert b'name="caption"\r\n\r\nLegenda do card' in corpo and b'name="published"\r\n\r\ntrue' in corpo
    assert b'filename="imagem-01.png"' in corpo
    assert r["publicado"] is True and r["post_id"] == f"{PAGINA}_post-unico"


@pytest.mark.asyncio
async def test_varias_imagens_viram_um_post_na_ordem_dos_arquivos(bucket):
    with respx.mock(assert_all_called=False) as m:
        refs = _origens(m, 3)
        fotos, feed, apaga = _facebook(m)
        r = await fb.publicar(TOKEN, PAGINA, refs, "Legenda da peça")
        _sem_token_fora_do_cabecalho(m)
    envios = [c.request.content for c in fotos.calls]
    assert [b'filename="imagem-0%d.png"' % i in envios[i - 1] for i in (1, 2, 3)] == [True] * 3
    assert all(b'name="published"\r\n\r\nfalse' in e for e in envios)
    campos = dict(httpx.QueryParams(feed.calls[0].request.content.decode()))
    assert campos["message"] == "Legenda da peça"
    assert [json.loads(campos[f"attached_media[{i}]"])["media_fbid"] for i in range(3)] == ["foto-1", "foto-2", "foto-3"]
    assert feed.call_count == 1 and apaga.call_count == 0 and r["post_id"] == f"{PAGINA}_post-1"


@pytest.mark.asyncio
@pytest.mark.parametrize("n", [1, 7])
async def test_ensaio_sobe_sem_publicar_confere_e_apaga(bucket, n):
    with respx.mock(assert_all_called=False) as m:
        refs = _origens(m, n)
        fotos, feed, apaga = _facebook(m)
        r = await fb.publicar(TOKEN, PAGINA, refs, "x", ensaio=True)
    assert all(b'name="published"\r\n\r\nfalse' in c.request.content for c in fotos.calls)
    assert fotos.call_count == n and feed.call_count == 0 and apaga.call_count == n
    assert r["publicado"] is False and r["apagadas"] == n and [f["n"] for f in r["fotos"]] == list(range(1, n + 1))


@pytest.mark.asyncio
async def test_falha_ao_subir_apaga_o_que_subiu_e_pode_tentar_de_novo(bucket):
    with respx.mock(assert_all_called=False) as m:
        refs = _origens(m, 3)
        _, feed, apaga = _facebook(m, falha="upload2")
        with pytest.raises(fb.FacebookError) as e:
            await fb.publicar(TOKEN, PAGINA, refs, "x")
    assert e.value.pode_tentar_de_novo is True and feed.call_count == 0 and apaga.call_count == 1
    assert "imagens" in str(e.value) or "imagem" in str(e.value)


@pytest.mark.asyncio
async def test_falha_no_post_final_exige_conferir(bucket):
    with respx.mock(assert_all_called=False) as m:
        refs = _origens(m, 2)
        _, feed, apaga = _facebook(m, falha="feed")
        with pytest.raises(fb.FacebookError) as e:
            await fb.publicar(TOKEN, PAGINA, refs, "x")
    assert e.value.pode_tentar_de_novo is False and feed.call_count == 1 and apaga.call_count == 0


# ── Pelo app: trava contra duplicata e falha marcada ───────────────────────────

def _post(plataforma=PlatformEnum.facebook, n=2, status=PostStatusEnum.scheduled, error_log=None):
    return Post(id=uuid.uuid4(), user_id=USUARIO, platform=plataforma, content="Legenda",
                media_urls=[f"midia://slide-{i + 1:02d}.png" for i in range(n)], status=status, error_log=error_log)


def _cred_fb(valido=True):
    agora = datetime.now(timezone.utc)
    return OAuthCredential(platform=PlatformEnum.facebook, access_token=encrypt_token(TOKEN), platform_user_id=PAGINA,
                           token_expires_at=agora + (timedelta(days=3650) if valido else timedelta(days=-1)),
                           updated_at=agora - timedelta(days=2))


def _cred_ig():
    agora = datetime.now(timezone.utc)
    return OAuthCredential(platform=PlatformEnum.instagram, access_token=encrypt_token("token-ig"), platform_user_id="1784",
                           token_expires_at=agora + timedelta(days=40), updated_at=agora - timedelta(days=2))


@pytest.mark.asyncio
async def test_post_do_facebook_publicado_pelo_app(bucket):
    post = _post()
    with respx.mock(assert_all_called=False) as m:
        _origens(m, 2)
        _, feed, _ = _facebook(m)
        saida = await ps.publish_post(_Banco([post, post.id, _cred_fb()]), post.id, USUARIO)
    assert feed.call_count == 1 and post.status == PostStatusEnum.published
    assert post.platform_post_id == f"{PAGINA}_post-1" and post.error_log is None
    assert saida["results"]["facebook"]["success"] is True


@pytest.mark.asyncio
async def test_post_ja_travado_nao_chama_o_facebook(bucket):
    post = _post(status=PostStatusEnum.failed, error_log=ps.FB_PUBLICANDO + " desde 20/10 15:00.")
    with respx.mock(assert_all_called=False) as m:
        with pytest.raises(ps.PublishError):
            await ps.publish_post(_Banco([post, None]), post.id, USUARIO)
        assert len(m.calls) == 0


@pytest.mark.asyncio
async def test_falha_fica_nao_publicado_com_motivo(bucket):
    post = _post()
    with respx.mock(assert_all_called=False) as m:
        _origens(m, 2)
        _facebook(m, falha="upload2")
        await ps.publish_post(_Banco([post, post.id, _cred_fb()]), post.id, USUARIO)
    assert post.status == PostStatusEnum.failed and post.error_log.startswith(ps.FB_PODE_TENTAR)
    assert "não aceitou uma das imagens" in post.error_log


@pytest.mark.asyncio
async def test_instagram_e_facebook_independentes_falha_de_um_nao_cancela_o_outro(bucket, monkeypatch):
    """"Instagram + Facebook" são dois posts: o Instagram falha, o Facebook sai."""
    monkeypatch.setattr(ig.asyncio, "sleep", lambda s: _nada())
    post_ig, post_fb = _post(PlatformEnum.instagram), _post(PlatformEnum.facebook)
    banco = _Banco([[post_ig, post_fb], post_ig, post_ig.id, _cred_ig(), post_fb, post_fb.id, _cred_fb()])

    class _Sessao:
        async def __aenter__(self):
            return banco

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(ss, "AsyncSessionLocal", lambda: _Sessao())
    with respx.mock(assert_all_called=False) as m:
        _origens(m, 2)
        m.get(f"{ig.graph_url()}/me").mock(return_value=httpx.Response(200, json={"user_id": "1784", "username": "gestao.capitalhumano"}))
        m.post(f"{ig.graph_url()}/1784/media").mock(return_value=httpx.Response(400, json={"error": {"code": 9004, "error_subcode": 2207052}}))
        _, feed, _ = _facebook(m)
        await ss._publish_due_posts()
    assert post_ig.status == PostStatusEnum.failed and post_ig.error_log.startswith(ps.IG_PODE_TENTAR)
    assert post_fb.status == PostStatusEnum.published and feed.call_count == 1


async def _nada():
    return None


# ── Conexão e token ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_conexao_guarda_so_a_pagina_da_empresa_criptografada():
    db = _Banco([None])
    with respx.mock(assert_all_called=False) as m:
        troca = m.post(f"{G}/oauth/access_token").mock(side_effect=[
            httpx.Response(200, json={"access_token": "usuario-curto"}),
            httpx.Response(200, json={"access_token": "usuario-longo", "expires_in": 5184000}),
        ])
        contas = m.get(f"{G}/me/accounts").mock(return_value=httpx.Response(200, json={"data": PAGINAS}))
        perms = m.get(f"{G}/me/permissions").mock(return_value=httpx.Response(200, json={"data": PERMISSOES}))
        cred = await oa.exchange_facebook_code("codigo", db, USUARIO)
    assert cred.platform == PlatformEnum.facebook and cred.platform_user_id == PAGINA
    assert cred.access_token != TOKEN and decrypt_token(cred.access_token) == TOKEN
    assert cred.token_expires_at > datetime.now(timezone.utc) + timedelta(days=3000)
    for c in troca.calls + contas.calls + perms.calls:  # chave e tokens nunca no endereço
        assert settings.FACEBOOK_APP_SECRET not in str(c.request.url)
        assert "usuario-" not in str(c.request.url)
    assert contas.calls[0].request.headers["authorization"] == "Bearer usuario-longo"
    assert perms.calls[0].request.headers["authorization"] == "Bearer usuario-longo"
    # guarda só o que foi concedido (pages_manage_engagement recusada fica de fora)
    assert cred.scope == "pages_manage_posts,pages_read_engagement,pages_show_list,public_profile"
    assert len(db.adicionados) == 1


PERMISSOES = [
    {"permission": "pages_show_list", "status": "granted"}, {"permission": "pages_read_engagement", "status": "granted"},
    {"permission": "pages_manage_posts", "status": "granted"}, {"permission": "pages_manage_engagement", "status": "declined"},
    {"permission": "public_profile", "status": "granted"},
]


def _troca(m):
    m.post(f"{G}/oauth/access_token").mock(side_effect=[
        httpx.Response(200, json={"access_token": "usuario-curto"}), httpx.Response(200, json={"access_token": "usuario-longo"})])
    m.get(f"{G}/me/permissions").mock(return_value=httpx.Response(200, json={"data": PERMISSOES}))


@pytest.mark.asyncio
async def test_pagina_de_portfolio_empresarial_vem_pela_consulta_direta(caplog):
    """Página de portfólio empresarial: /me/accounts vem vazio sem
    business_management; o token sai do nó da Página (campo access_token)."""
    caplog.set_level(logging.DEBUG)
    db = _Banco([None])
    with respx.mock(assert_all_called=False) as m:
        _troca(m)
        m.get(f"{G}/me/accounts").mock(return_value=httpx.Response(200, json={"data": []}))
        direta = m.get(f"{G}/{PAGINA}").mock(return_value=httpx.Response(200, json={
            "id": PAGINA, "name": "Capital Humano Intelligence", "access_token": TOKEN}))
        cred = await oa.exchange_facebook_code("codigo", db, USUARIO)
    assert cred.platform_user_id == PAGINA and decrypt_token(cred.access_token) == TOKEN
    pedido = direta.calls[0].request
    assert pedido.headers["authorization"] == "Bearer usuario-longo" and "usuario-" not in str(pedido.url)
    assert "access_token" in pedido.url.params["fields"]
    assert f"consulta direta à Página {PAGINA}: ok" in caplog.text and TOKEN not in caplog.text


@pytest.mark.asyncio
async def test_consulta_direta_so_quando_a_pagina_nao_veio_e_so_a_da_trava():
    with respx.mock(assert_all_called=False) as m:
        _troca(m)
        m.get(f"{G}/me/accounts").mock(return_value=httpx.Response(200, json={"data": PAGINAS}))
        direta = m.get(f"{G}/{PAGINA}")
        outras = m.get(host="graph.facebook.com", path__regex=rf"/({OUTRA}|555)$")
        await oa.exchange_facebook_code("codigo", _Banco([None]), USUARIO)
    assert direta.call_count == 0 and outras.call_count == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("resposta", [
    httpx.Response(400, json={"error": {"code": 100, "error_subcode": 33, "message": "Unsupported get request"}}),
    httpx.Response(200, json={"id": PAGINA, "name": "Capital Humano Intelligence"}),  # sem access_token
])
async def test_consulta_direta_sem_acesso_nao_grava_e_explica(resposta):
    db = _Banco([None])
    with respx.mock(assert_all_called=False) as m:
        _troca(m)
        m.get(f"{G}/me/accounts").mock(return_value=httpx.Response(200, json={"data": []}))
        m.get(f"{G}/{PAGINA}").mock(return_value=resposta)
        with pytest.raises(oa.OAuthError) as e:
            await oa.exchange_facebook_code("codigo", db, USUARIO)
    texto = str(e.value)
    assert ("não entregou o acesso à Página" in texto) and db.adicionados == [] and db.commits == 0
    assert not any(c in texto for c in "–—") and " - " not in texto and " pra " not in texto and "token" not in texto.lower()


@pytest.mark.asyncio
async def test_permissoes_concedidas_saem_da_conexao():
    cred = _cred_fb()
    cred.scope = "pages_manage_posts,pages_read_engagement,pages_show_list"
    assert await oa.facebook_permissoes(_Banco([cred]), USUARIO) == ["pages_manage_posts", "pages_read_engagement", "pages_show_list"]
    assert await oa.facebook_permissoes(_Banco([None]), USUARIO) == []


@pytest.mark.asyncio
async def test_token_invalidado_marca_conexao_vencida():
    cred = _cred_fb()
    with respx.mock(assert_all_called=False) as m:
        m.get(f"{G}/{PAGINA}").mock(return_value=httpx.Response(400, json={"error": {"code": 190, "message": "invalid"}}))
        estado = await oa.confere_token_facebook(_Banco(), cred)
    assert estado == "invalidado" and cred.is_expired()


@pytest.mark.asyncio
async def test_token_valido_continua_valido():
    cred = _cred_fb()
    with respx.mock(assert_all_called=False) as m:
        m.get(f"{G}/{PAGINA}").mock(return_value=httpx.Response(200, json={"id": PAGINA}))
        assert await oa.confere_token_facebook(_Banco(), cred) == "valido"
    assert not cred.is_expired()


@pytest.mark.asyncio
async def test_nenhum_token_nem_chave_no_log(bucket, caplog):
    caplog.set_level(logging.DEBUG)
    caplog.set_level(logging.DEBUG, logger="httpx")
    post = _post(n=2)
    with respx.mock(assert_all_called=False) as m:
        _origens(m, 2)
        _facebook(m)
        m.post(f"{G}/oauth/access_token").mock(side_effect=[
            httpx.Response(200, json={"access_token": "usuario-curto"}),
            httpx.Response(200, json={"access_token": "usuario-longo"})])
        m.get(f"{G}/me/accounts").mock(return_value=httpx.Response(200, json={"data": PAGINAS}))
        m.get(f"{G}/me/permissions").mock(return_value=httpx.Response(200, json={"data": PERMISSOES}))
        await oa.exchange_facebook_code("codigo", _Banco([None]), USUARIO)
        await ps.publish_post(_Banco([post, post.id, _cred_fb()]), post.id, USUARIO)
    for segredo in (TOKEN, "usuario-curto", "usuario-longo", settings.FACEBOOK_APP_SECRET):
        assert segredo not in caplog.text


# ── Criação do post ────────────────────────────────────────────────────────────

@pytest.fixture
def usuario(monkeypatch):
    async def primeiro(db):
        return USUARIO
    monkeypatch.setattr(posts_endpoints, "_get_first_user_id", primeiro)


@pytest.mark.asyncio
@pytest.mark.parametrize("midias,trecho", [([], "pelo menos uma imagem"), (["midia://a.pdf"], "só imagens")])
async def test_criacao_do_facebook_recusa_o_que_nao_publica(usuario, midias, trecho):
    with pytest.raises(HTTPException) as e:
        await posts_endpoints.create_post(PostCreate(platform=PlatformEnum.facebook, content="x", media_urls=midias), _Banco())
    assert e.value.status_code == 422 and trecho in e.value.detail


@pytest.mark.asyncio
async def test_criacao_do_facebook_aceita_10_imagens_agendadas(usuario):
    post = await posts_endpoints.create_post(PostCreate(
        platform=PlatformEnum.facebook, content="x", media_urls=[f"midia://{i}.png" for i in range(10)],
        scheduled_at=datetime.now(timezone.utc) + timedelta(days=1)), _Banco())
    assert post.status == PostStatusEnum.scheduled and len(post.media_urls) == 10
