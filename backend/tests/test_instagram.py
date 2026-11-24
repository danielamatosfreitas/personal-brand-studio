"""
Fase 3 (16/10): publicação no Instagram (imagem única e carrossel).
Tudo simulado: o Instagram é interceptado (respx), o bucket e o banco são falsos.
"""
import io

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
import respx
from fastapi import HTTPException
from PIL import Image, ImageDraw

from app.api.v1.endpoints import posts as posts_endpoints
from app.core.config import encrypt_token, decrypt_token
from app.db.models import OAuthCredential, Post, PlatformEnum, PostStatusEnum
from app.schemas.schemas import PostCreate
from app.services import instagram_service as ig
from app.services import oauth_service as oa
from app.services import publishing_service as ps

USUARIO = uuid.uuid4()
TOKEN = "token-instagram-de-teste"
G = ig.graph_url()
IG_ID = "17841400000000000"


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
        self.adicionados, self.commits, self.rollbacks, self.consultas = [], 0, 0, []

    def add(self, obj):
        self.adicionados.append(obj)

    async def execute(self, consulta):
        self.consultas.append(consulta)
        return _Resultado(self.respostas.pop(0))

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1

    async def refresh(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()


def _png(w=1080, h=1350, cor=(44, 74, 59, 255)):
    img = Image.new("RGBA", (w, h), cor)
    ImageDraw.Draw(img).rectangle([100, 600, 899, 639], fill=(243, 238, 227, 255))  # um traço de "texto" creme
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


@pytest.fixture
def bucket(monkeypatch):
    """Bucket falso: guarda o que subiu e o que foi apagado."""
    estado = {"subiu": {}, "apagou": [], "pngs": {}}

    def sobe(dados, chave, tipo):
        estado["subiu"][chave] = (dados, tipo)

    class _Cliente:
        def delete_object(self, Bucket, Key):
            estado["apagou"].append(Key)

    monkeypatch.setattr(ig.storage_service, "_sobe", sobe)
    monkeypatch.setattr(ig.storage_service, "client", lambda: _Cliente())
    monkeypatch.setattr(ig.storage_service, "presigned_url",
                        lambda chave, ttl=None: f"https://bucket.teste/{chave}?assinatura=x")
    monkeypatch.setattr(ig.storage_service, "resolve_media_url",
                        lambda ref: f"https://bucket.teste/origem/{ref.split('://')[-1]}")
    return estado


def _instagram(m, n_itens, falha_em=None, status_intermediario=True):
    """Simula o Instagram: /me, contêineres, status e publicação."""
    m.get(f"{G}/me").mock(return_value=httpx.Response(200, json={"user_id": IG_ID, "id": "app-scoped", "username": "gestao.capitalhumano", "account_type": "BUSINESS"}))
    contador = {"n": 0}

    def cria(request):
        corpo = dict(httpx.QueryParams(request.content.decode()))
        if falha_em == "conteiner":
            return httpx.Response(400, json={"error": {"code": 9004, "error_subcode": 2207052, "message": "Media download has failed."}})
        if corpo.get("media_type") == "CAROUSEL":
            return httpx.Response(200, json={"id": "carrossel-1"})
        contador["n"] += 1
        return httpx.Response(200, json={"id": f"item-{contador['n']}"})

    m.post(f"{G}/{IG_ID}/media").mock(side_effect=cria)
    vistos = set()

    def status(request):
        cid = request.url.path.rsplit("/", 1)[-1]
        if status_intermediario and cid not in vistos:
            vistos.add(cid)
            return httpx.Response(200, json={"status_code": "IN_PROGRESS"})
        return httpx.Response(200, json={"status_code": "FINISHED"})

    m.get(host="graph.instagram.com", path__regex=r"/(item-\d+|carrossel-1|unico)$").mock(side_effect=status)
    if falha_em == "publicar":
        pub = m.post(f"{G}/{IG_ID}/media_publish").mock(return_value=httpx.Response(500, json={"error": {"code": 2, "message": "Service temporarily unavailable"}}))
    else:
        pub = m.post(f"{G}/{IG_ID}/media_publish").mock(return_value=httpx.Response(200, json={"id": "midia-publicada-1"}))
    m.get(f"{G}/midia-publicada-1").mock(return_value=httpx.Response(200, json={"permalink": "https://www.instagram.com/p/teste/"}))
    return pub


def _origens(m, n):
    for i in range(n):
        m.get(f"https://bucket.teste/origem/slide-{i + 1}.png").mock(return_value=httpx.Response(200, content=_png()))
    return [f"midia://slide-{i + 1}.png" for i in range(n)]


async def _sem_espera(_s):
    return None


def _token_so_no_cabecalho(m):
    for chamada in m.calls:
        req = chamada.request
        if req.url.host == "graph.instagram.com":
            assert req.headers.get("authorization") == f"Bearer {TOKEN}"
            assert TOKEN not in str(req.url) and TOKEN.encode() not in (req.content or b"")


# ── Imagem ─────────────────────────────────────────────────────────────────────

def test_png_vira_jpeg_no_mesmo_tamanho_sem_perder_qualidade():
    jpeg, tamanho = ig.para_jpeg(_png())
    img = Image.open(io.BytesIO(jpeg))
    assert img.format == "JPEG" and img.mode == "RGB" and img.size == (1080, 1350) == tamanho
    assert img.getpixel((500, 300)) == pytest.approx((44, 74, 59), abs=3)
    assert img.getpixel((500, 620)) == pytest.approx((243, 238, 227), abs=3)


def test_jpeg_pronto_passa_sem_recompressao():
    out = io.BytesIO()
    Image.new("RGB", (1080, 1080), (10, 20, 30)).save(out, format="JPEG", quality=90)
    assert ig.para_jpeg(out.getvalue())[0] == out.getvalue()


@pytest.mark.parametrize("w,h", [(1080, 1920), (200, 250), (2000, 2500)])
def test_tamanho_fora_do_instagram_e_recusado(w, h):
    with pytest.raises(ig.InstagramError) as e:
        ig.para_jpeg(_png(w, h))
    assert "1080x1350" in str(e.value)


def test_validacao_das_midias():
    assert ig.valida_midias(["midia://a.png"]) is None
    assert ig.valida_midias([f"midia://{i}.png" for i in range(10)]) is None
    assert "no máximo 10" in ig.valida_midias([f"midia://{i}.png" for i in range(11)])
    assert "só imagens" in ig.valida_midias(["midia://a.png", "midia://b.pdf"])
    assert "só com texto" in ig.valida_midias([])


# ── Fluxo na API do Instagram ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_ensaio_carrossel_de_7_cria_conteineres_confere_e_nao_publica(bucket):
    with respx.mock(assert_all_called=False) as m:
        refs = _origens(m, 7)
        pub = _instagram(m, 7)
        r = await ig.publicar(TOKEN, refs, "Legenda da peça 9", prefixo="post-1", ensaio=True, dormir=_sem_espera)
        _token_so_no_cabecalho(m)
        criados = [dict(httpx.QueryParams(c.request.content.decode())) for c in m.calls
                   if c.request.method == "POST" and c.request.url.path.endswith("/media")]
    assert pub.call_count == 0 and r["publicado"] is False and r["ensaio"] is True
    assert r["conta"] == "gestao.capitalhumano" and r["tipo"] == "carrossel"
    assert [i["status"] for i in r["itens"]] == ["FINISHED"] * 7 and r["status"] == "FINISHED"
    itens, carrossel = criados[:7], criados[7]
    assert all(c["is_carousel_item"] == "true" and "caption" not in c for c in itens)
    assert [c["image_url"].split("?")[0] for c in itens] == [f"https://bucket.teste/instagram-temp/post-1/{i:02d}.jpg" for i in range(1, 8)]
    assert carrossel == {"media_type": "CAROUSEL", "children": ",".join(f"item-{i}" for i in range(1, 8)), "caption": "Legenda da peça 9"}
    # JPEG 1080x1350 no bucket, e as cópias temporárias apagadas no fim
    for chave, (dados, tipo) in bucket["subiu"].items():
        assert tipo == "image/jpeg" and Image.open(io.BytesIO(dados)).size == (1080, 1350)
    assert sorted(bucket["apagou"]) == sorted(bucket["subiu"])


@pytest.mark.asyncio
async def test_imagem_unica_publica_uma_vez_com_legenda(bucket):
    with respx.mock(assert_all_called=False) as m:
        refs = _origens(m, 1)
        m.get(f"{G}/me").mock(return_value=httpx.Response(200, json={"user_id": IG_ID, "username": "gestao.capitalhumano"}))
        cria = m.post(f"{G}/{IG_ID}/media").mock(return_value=httpx.Response(200, json={"id": "unico"}))
        m.get(f"{G}/unico").mock(return_value=httpx.Response(200, json={"status_code": "FINISHED"}))
        pub = m.post(f"{G}/{IG_ID}/media_publish").mock(return_value=httpx.Response(200, json={"id": "midia-publicada-1"}))
        m.get(f"{G}/midia-publicada-1").mock(return_value=httpx.Response(200, json={"permalink": "https://www.instagram.com/p/x/"}))
        r = await ig.publicar(TOKEN, refs, "Card de frase", prefixo="p", dormir=_sem_espera)
        _token_so_no_cabecalho(m)
    corpo = dict(httpx.QueryParams(cria.calls[0].request.content.decode()))
    assert corpo["caption"] == "Card de frase" and "is_carousel_item" not in corpo and "media_type" not in corpo
    assert pub.call_count == 1 and dict(httpx.QueryParams(pub.calls[0].request.content.decode())) == {"creation_id": "unico"}
    assert r["media_id"] == "midia-publicada-1" and r["permalink"].startswith("https://www.instagram.com/")


@pytest.mark.asyncio
async def test_conteiner_com_erro_para_antes_de_publicar(bucket):
    with respx.mock(assert_all_called=False) as m:
        refs = _origens(m, 2)
        m.get(f"{G}/me").mock(return_value=httpx.Response(200, json={"user_id": IG_ID}))
        m.post(f"{G}/{IG_ID}/media").mock(side_effect=[httpx.Response(200, json={"id": "item-1"}), httpx.Response(200, json={"id": "item-2"})])
        m.get(f"{G}/item-1").mock(return_value=httpx.Response(200, json={"status_code": "FINISHED"}))
        m.get(f"{G}/item-2").mock(return_value=httpx.Response(200, json={"status_code": "ERROR", "status": "Error: image"}))
        pub = m.post(f"{G}/{IG_ID}/media_publish")
        with pytest.raises(ig.InstagramError) as e:
            await ig.publicar(TOKEN, refs, "x", prefixo="p", dormir=_sem_espera)
    assert pub.call_count == 0 and e.value.pode_tentar_de_novo is True
    assert "imagem 2" in str(e.value) and sorted(bucket["apagou"]) == sorted(bucket["subiu"])


def test_mensagens_em_linguagem_simples():
    assert "Reconecte o Instagram" in ig.mensagem_simples({"code": 190, "message": "Error validating access token"})
    assert "permissão" in ig.mensagem_simples({"code": 10, "message": "x"})
    assert "limite" in ig.mensagem_simples({"code": 4, "error_subcode": 2207042})
    assert "baixar uma das imagens" in ig.mensagem_simples({"code": 9004, "error_subcode": 2207052})
    for t in (ig.mensagem_simples({"code": c}) for c in (190, 10, 4, 9004, 36003, 1)):
        assert not any(ch in t for ch in "–—") and " - " not in t


# ── Publicação pelo app: trava contra duplicata e falha marcada ────────────────

def _post(status=PostStatusEnum.scheduled, n=2, error_log=None):
    return Post(id=uuid.uuid4(), user_id=USUARIO, platform=PlatformEnum.instagram, content="Legenda",
                media_urls=[f"midia://slide-{i + 1}.png" for i in range(n)], status=status, error_log=error_log)


def _cred(dias=40, idade_h=48):
    agora = datetime.now(timezone.utc)
    return OAuthCredential(platform=PlatformEnum.instagram, access_token=encrypt_token(TOKEN), platform_user_id=IG_ID,
                           token_expires_at=agora + timedelta(days=dias), updated_at=agora - timedelta(hours=idade_h))


@pytest.mark.asyncio
async def test_publicacao_ok_marca_publicado(bucket, monkeypatch):
    monkeypatch.setattr(ig.asyncio, "sleep", _sem_espera)
    post = _post()
    db = _Banco([post, post.id, _cred()])
    with respx.mock(assert_all_called=False) as m:
        assert _origens(m, 2) == post.media_urls
        pub = _instagram(m, 2)
        saida = await ps.publish_post(db, post.id, USUARIO)
    assert pub.call_count == 1
    assert post.status == PostStatusEnum.published and post.platform_post_id == "midia-publicada-1" and post.error_log is None
    assert saida["results"]["instagram"]["success"] is True


@pytest.mark.asyncio
async def test_post_ja_travado_nao_chama_o_instagram(bucket):
    post = _post(status=PostStatusEnum.failed, error_log=ps.IG_PUBLICANDO + " desde 20/10 09:00.")
    db = _Banco([post, None])
    with respx.mock(assert_all_called=False) as m:
        with pytest.raises(ps.PublishError) as e:
            await ps.publish_post(db, post.id, USUARIO)
        assert len(m.calls) == 0
    assert "Confira no Instagram" in str(e.value) and db.rollbacks == 1


@pytest.mark.asyncio
async def test_dois_disparos_do_mesmo_post_publicam_uma_vez_so(bucket, monkeypatch):
    """O primeiro disparo trava o post; o segundo encontra a trava e não chama o Instagram."""
    monkeypatch.setattr(ig.asyncio, "sleep", _sem_espera)
    post = _post()
    with respx.mock(assert_all_called=False) as m:
        _origens(m, 2)
        pub = _instagram(m, 2)
        await ps.publish_post(_Banco([post, post.id, _cred()]), post.id, USUARIO)
        post_de_novo = _post(status=PostStatusEnum.scheduled)  # cópia antiga lida antes da trava
        post_de_novo.id = post.id
        with pytest.raises(ps.PublishError):
            await ps.publish_post(_Banco([post_de_novo, None]), post.id, USUARIO)
    assert pub.call_count == 1


@pytest.mark.asyncio
async def test_falha_antes_de_publicar_fica_falho_e_pode_tentar_de_novo(bucket, monkeypatch):
    monkeypatch.setattr(ig.asyncio, "sleep", _sem_espera)
    post = _post()
    with respx.mock(assert_all_called=False) as m:
        _origens(m, 2)
        pub = _instagram(m, 2, falha_em="conteiner")
        saida = await ps.publish_post(_Banco([post, post.id, _cred()]), post.id, USUARIO)
    assert pub.call_count == 0
    assert post.status == PostStatusEnum.failed and post.error_log.startswith(ps.IG_PODE_TENTAR)
    assert "não conseguiu baixar uma das imagens" in post.error_log
    assert saida["results"]["instagram"]["success"] is False


@pytest.mark.asyncio
async def test_falha_no_passo_de_publicar_exige_conferir_antes(bucket, monkeypatch):
    monkeypatch.setattr(ig.asyncio, "sleep", _sem_espera)
    post = _post()
    with respx.mock(assert_all_called=False) as m:
        _origens(m, 2)
        pub = _instagram(m, 2, falha_em="publicar")
        await ps.publish_post(_Banco([post, post.id, _cred()]), post.id, USUARIO)
    assert pub.call_count == 1  # uma tentativa só, sem repetir sozinho
    assert post.status == PostStatusEnum.failed and post.error_log.startswith(ps.IG_CONFERIR)


@pytest.mark.asyncio
async def test_conexao_vencida_falha_com_motivo_claro(bucket):
    post = _post()
    with respx.mock(assert_all_called=False) as m:
        saida = await ps.publish_post(_Banco([post, post.id, _cred(dias=-1)]), post.id, USUARIO)
        assert len(m.calls) == 0
    assert post.status == PostStatusEnum.failed and "Reconecte o Instagram" in post.error_log
    assert post.error_log.startswith(ps.IG_PODE_TENTAR) and saida["results"]["instagram"]["success"] is False


@pytest.mark.asyncio
async def test_agendador_so_pega_agendado_e_nao_repete_falho():
    from app.services import scheduler_service as ss
    import inspect
    fonte = inspect.getsource(ss._publish_due_posts)
    assert "PostStatusEnum.scheduled" in fonte and "failed" not in fonte


# ── Token: renovação automática ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_token_perto_de_vencer_e_renovado_e_guardado_criptografado():
    cred = _cred(dias=10)
    db = _Banco()
    with respx.mock(assert_all_called=False) as m:
        r = m.get(oa.INSTAGRAM_REFRESH_URL).mock(return_value=httpx.Response(200, json={"access_token": "token-novo", "expires_in": 5184000}))
        estado = await oa.renova_token_instagram(db, cred)
    assert estado == "renovado" and r.call_count == 1 and db.commits == 1
    assert r.calls[0].request.headers["authorization"] == f"Bearer {TOKEN}" and TOKEN not in str(r.calls[0].request.url)
    assert cred.access_token != "token-novo" and decrypt_token(cred.access_token) == "token-novo"
    assert cred.token_expires_at > datetime.now(timezone.utc) + timedelta(days=59)


@pytest.mark.asyncio
@pytest.mark.parametrize("dias,idade_h,esperado", [(40, 48, "nao_precisa"), (10, 2, "muito_novo"), (-1, 48, "falhou")])
async def test_token_nao_renova_sem_precisar(dias, idade_h, esperado):
    with respx.mock(assert_all_called=False) as m:
        r = m.get(oa.INSTAGRAM_REFRESH_URL)
        estado = await oa.renova_token_instagram(_Banco(), _cred(dias=dias, idade_h=idade_h))
    assert estado.startswith(esperado) and r.call_count == 0


# ── Criação do post ────────────────────────────────────────────────────────────

@pytest.fixture
def usuario(monkeypatch):
    async def primeiro(db):
        return USUARIO
    monkeypatch.setattr(posts_endpoints, "_get_first_user_id", primeiro)


@pytest.mark.asyncio
@pytest.mark.parametrize("plataforma,midias,trecho", [
    # mais de 10 mídias o próprio PostCreate já recusa (schemas.py)
    (PlatformEnum.instagram, ["midia://a.pdf"], "só imagens"),
    (PlatformEnum.both, ["midia://a.png"], "um post para cada rede"),
])
async def test_criacao_recusa_o_que_o_instagram_nao_publica(usuario, plataforma, midias, trecho):
    db = _Banco()
    with pytest.raises(HTTPException) as e:
        await posts_endpoints.create_post(PostCreate(platform=plataforma, content="x", media_urls=midias), db)
    assert e.value.status_code == 422 and trecho in e.value.detail and db.commits == 0


@pytest.mark.asyncio
async def test_criacao_aceita_carrossel_de_10(usuario):
    post = await posts_endpoints.create_post(
        PostCreate(platform=PlatformEnum.instagram, content="x", media_urls=[f"midia://{i}.png" for i in range(10)]), _Banco())
    assert post.status == PostStatusEnum.draft and len(post.media_urls) == 10
