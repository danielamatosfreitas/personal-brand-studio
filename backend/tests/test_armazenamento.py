"""
Armazenamento de mídia em bucket S3 (Railway Storage Bucket hoje; R2 trocando
só as variáveis). Simulado: o envio usa um cliente falso e a assinatura da URL
é calculada localmente pelo boto3, sem rede.
"""
import base64
import io
import json
import uuid
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import settings
from app.services import linkedin_documents_service as lds
from app.services import publishing_service as ps
from app.services import storage_service as st

SEGREDO = "segredo-de-teste-que-nunca-pode-aparecer"


@pytest.fixture
def bucket(monkeypatch):
    """Configuração de teste no padrão da Railway (estilo virtual-hosted)."""
    for nome, valor in {
        "S3_ENDPOINT": "https://t3.storage.teste", "S3_BUCKET": "pb-midia",
        "S3_ACCESS_KEY_ID": "chave-de-teste", "S3_SECRET_ACCESS_KEY": SEGREDO,
        "S3_REGION": "auto", "S3_ADDRESSING_STYLE": "virtual", "MEDIA_URL_TTL_SECONDS": 21600,
    }.items():
        monkeypatch.setattr(settings, nome, valor)


class _ClienteFalso:
    def __init__(self):
        self.envios = []

    def upload_fileobj(self, arquivo, bucket, chave, ExtraArgs=None, Config=None):
        self.envios.append({"bytes": arquivo.read(), "bucket": bucket, "chave": chave, "extra": ExtraArgs, "config": Config})


def test_sem_configuracao_erro_claro_sem_valores(monkeypatch):
    for nome in ("S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"):
        monkeypatch.setattr(settings, nome, "")
    with pytest.raises(st.StorageError) as erro:
        st.client()
    assert "S3_ENDPOINT" in str(erro.value) and "S3_SECRET_ACCESS_KEY" in str(erro.value)


def test_backend_nao_conhece_mais_o_supabase():
    assert not any(n.startswith("SUPABASE") for n in type(settings).model_fields)
    codigo = open(st.__file__, encoding="utf-8").read()
    assert "SUPABASE_" not in codigo and "service_role" not in codigo.lower()


@pytest.mark.asyncio
async def test_upload_devolve_referencia_e_usa_envio_em_partes(bucket, monkeypatch):
    falso = _ClienteFalso()
    monkeypatch.setattr(st, "client", lambda: falso)
    ref1 = await st.upload_media(b"abc", "JPG", "image/jpeg")
    ref2 = await st.upload_media(b"def", "pdf", "application/pdf")
    assert ref1.startswith("midia://") and ref1.endswith(".jpg")
    assert ref2.endswith(".pdf") and ref1 != ref2
    e = falso.envios[0]
    assert e["bucket"] == "pb-midia" and e["bytes"] == b"abc" and e["extra"] == {"ContentType": "image/jpeg"}
    # vídeo de 300 MB vai em partes de 16 MB
    assert e["config"].multipart_threshold == 16 * 1024 * 1024 and e["config"].multipart_chunksize == 16 * 1024 * 1024


def _confere_assinatura(url, host, caminho):
    u = urlparse(url)
    q = parse_qs(u.query)
    assert u.scheme == "https" and u.hostname == host and u.path == caminho
    assert q["X-Amz-Expires"] == ["21600"] and q["X-Amz-Algorithm"] == ["AWS4-HMAC-SHA256"] and q["X-Amz-Signature"][0]
    assert SEGREDO not in url


def test_url_assinada_railway_virtual(bucket):
    url = st.resolve_media_url("midia://abc123.jpg")
    _confere_assinatura(url, "pb-midia.t3.storage.teste", "/abc123.jpg")


def test_url_assinada_estilo_path(bucket, monkeypatch):
    monkeypatch.setattr(settings, "S3_ADDRESSING_STYLE", "path")
    _confere_assinatura(st.resolve_media_url("midia://abc123.pdf"), "t3.storage.teste", "/pb-midia/abc123.pdf")


def test_trocar_para_r2_e_so_mudar_variaveis(bucket, monkeypatch):
    monkeypatch.setattr(settings, "S3_ENDPOINT", "https://contateste.r2.cloudflarestorage.com")
    _confere_assinatura(st.resolve_media_url("midia://abc123.mp4"), "pb-midia.contateste.r2.cloudflarestorage.com", "/abc123.mp4")


def test_url_antiga_passa_sem_mudanca(bucket):
    antiga = "https://projeto.supabase.co/storage/v1/object/public/personal-brand-media/x.jpg"
    assert st.resolve_media_url(antiga) == antiga


@pytest.mark.asyncio
async def test_linkedin_publica_pdf_do_bucket_pela_url_assinada(bucket, monkeypatch):
    async def get_valid_token(db, user_id, platform):
        return "token-de-teste"
    monkeypatch.setattr(ps, "get_valid_token", get_valid_token)

    async def titulo(db, post_id):
        return "Título do documento"
    monkeypatch.setattr(ps, "titulo_do_documento", titulo)
    post = SimpleNamespace(id=uuid.uuid4(), content="Carrossel", media_urls=["midia://carrossel.pdf"], linkedin_organization_urn=None, title=None)
    with respx.mock(assert_all_called=False) as m:
        baixa = m.get(url__startswith="https://pb-midia.t3.storage.teste/carrossel.pdf").mock(return_value=httpx.Response(200, content=b"%PDF-teste"))
        m.post(f"{lds.LINKEDIN_DOCUMENTS_URL}?action=initializeUpload").mock(return_value=httpx.Response(
            200, json={"value": {"uploadUrl": "https://upload.teste/doc", "document": "urn:li:document:1"}}))
        envio = m.put("https://upload.teste/doc").mock(return_value=httpx.Response(201))
        posts = m.post(lds.LINKEDIN_POSTS_URL).mock(return_value=httpx.Response(201, headers={"x-restli-id": "urn:li:share:9"}))
        urn = await ps.publish_to_linkedin(None, post, uuid.uuid4(), "pessoa")
    assert urn == "urn:li:share:9"
    assert baixa.call_count == 1 and "X-Amz-Signature=" in str(baixa.calls[0].request.url)
    assert envio.calls[0].request.content == b"%PDF-teste"
    assert json.loads(posts.calls[0].request.content)["content"]["media"]["id"] == "urn:li:document:1"


def test_rota_de_upload_devolve_referencias(bucket, monkeypatch):
    from app.main import app
    falso = _ClienteFalso()
    monkeypatch.setattr(st, "client", lambda: falso)
    buf = io.BytesIO()
    Image.new("RGB", (1080, 1350), (44, 74, 59)).save(buf, format="PNG")
    png = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    r = TestClient(app).post("/api/v1/media/upload", headers={"X-Access-Token": "senha-de-teste"},
                             json={"images_base64": [png, png], "assemble_pdf": True})
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert all(u.startswith("midia://") and u.endswith(".jpg") for u in corpo["image_urls"])
    assert corpo["pdf_url"].startswith("midia://") and corpo["pdf_url"].endswith(".pdf")
    assert [e["extra"]["ContentType"] for e in falso.envios] == ["image/jpeg", "image/jpeg", "application/pdf"]
