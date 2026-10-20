"""
Agendados (19/10): painel Ver (post completo como vai sair) e Editar
(texto, horário, código da peça e primeiro comentário sem cancelar).
Tudo simulado: banco falso, bucket falso, nenhuma rede chamada.
"""
import io
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import respx
from fastapi import HTTPException
from PIL import Image
from sqlalchemy.sql.dml import Insert, Update

from app.api.v1.endpoints import posts as ep
from app.db.models import Post, PostExtra, PlatformEnum, PostStatusEnum
from app.schemas.schemas import PostEdit
from app.services import previa_service as pv

TEXTO = "Centralizar decisões quase sempre começa como cuidado.\n\nSegunda linha.\n\n#gestao #pessoas"


def _pdf(paginas=3):
    imgs = [Image.new("RGB", (1080, 1350), (44 + i * 30, 74, 59)) for i in range(paginas)]
    out = io.BytesIO()
    imgs[0].save(out, format="PDF", save_all=True, append_images=imgs[1:])
    return out.getvalue()


def _post(platform=PlatformEnum.linkedin, midias=None, em=timedelta(hours=12), status=PostStatusEnum.scheduled):
    return Post(id=uuid.uuid4(), user_id=uuid.uuid4(), platform=platform, content=TEXTO, media_urls=midias,
                status=status, scheduled_at=datetime.now(timezone.utc) + em)


@pytest.fixture
def bucket(monkeypatch):
    monkeypatch.setattr(pv.storage_service, "presigned_url", lambda ref, ttl=None: f"https://bucket.teste/{ref.split('://')[-1]}?x=1")

    async def baixa(ref):
        return _pdf(3)
    monkeypatch.setattr(pv, "_baixa_pdf", baixa)


class _Db:
    """Banco falso: aplica no post os valores do UPDATE e guarda o INSERT de post_extras."""

    def __init__(self, post, extra=None, ativos=True, rowcount=1):
        self.post, self.extra, self.ativos, self.rowcount = post, extra, ativos, rowcount
        self.updates, self.inserts, self.commits, self.rollbacks = [], [], 0, 0

    async def execute(self, stmt):
        valores = {getattr(c, "key", c): b.value for c, b in getattr(stmt, "_values", {}).items()} if isinstance(stmt, (Update, Insert)) else {}
        if isinstance(stmt, Update):
            self.updates.append(valores)
            if self.rowcount == 1:
                self._pendente = ("post", valores)
        elif isinstance(stmt, Insert):
            self.inserts.append(valores)
            self._pendente_extra = valores
        return SimpleNamespace(rowcount=self.rowcount)

    async def commit(self):
        self.commits += 1
        if getattr(self, "_pendente", None):
            for k, v in self._pendente[1].items():
                setattr(self.post, k, v)
            self._pendente = None
        if getattr(self, "_pendente_extra", None):
            v = {k: x for k, x in self._pendente_extra.items() if k != "post_id"}
            self.extra = self.extra or PostExtra(post_id=self.post.id)
            for k, x in v.items():
                setattr(self.extra, k, x)
            self._pendente_extra = None

    async def rollback(self):
        self.rollbacks += 1
        self._pendente = self._pendente_extra = None


@pytest.fixture
def banco(monkeypatch):
    def usa(db):
        async def post_e_extras(_db, _post_id):
            return db.post, db.extra, db.ativos
        monkeypatch.setattr(ep, "_post_e_extras", post_e_extras)
        return db
    return usa


def _sem_proibidos(texto):
    assert not any(c in texto for c in "–—") and " - " not in texto and " pra " not in texto


# ── Ver ────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_ver_linkedin_com_pdf_mostra_o_que_sai(bucket):
    post = _post(midias=["midia://capa.png", "midia://carrossel.pdf"])
    with respx.mock(assert_all_called=False) as m:
        extra = PostExtra(post_id=post.id, titulo_documento="Quando tudo passa pelo dono", codigo_peca="pt056",
                          primeiro_comentario="Link nos comentários: https://exemplo.teste")
        p = await pv.monta_previa(post, extra, True)
        assert len(m.calls) == 0  # nenhuma rede chamada
    assert p["content"] == TEXTO and "\n\n#gestao #pessoas" in p["content"]  # texto exato, com quebras e hashtags
    assert p["rede"] == "LinkedIn" and p["destino"] == "perfil pessoal" and p["codigo_peca"] == "pt056"
    assert [m["tipo"] for m in p["midias"]] == ["pdf"]  # com PDF, o LinkedIn publica só o PDF
    assert p["midias"][0]["paginas"] == 3 and p["midias"][0]["primeira_pagina"].startswith("data:image/jpeg;base64,")
    assert p["usa_titulo"] is True and p["titulo_documento"] == "Quando tudo passa pelo dono"
    assert p["primeiro_comentario"].startswith("Link nos comentários")


@pytest.mark.asyncio
async def test_ver_instagram_imagens_na_ordem(bucket):
    refs = [f"midia://slide-{i:02d}.png" for i in (1, 2, 3)]
    p = await pv.monta_previa(_post(PlatformEnum.instagram, refs), None, True)
    assert [m["n"] for m in p["midias"]] == [1, 2, 3]
    assert [m["url"].split("?")[0] for m in p["midias"]] == [f"https://bucket.teste/slide-{i:02d}.png" for i in (1, 2, 3)]
    assert p["usa_titulo"] is False and p["titulo_documento"] is None and p["codigo_peca"] is None


@pytest.mark.asyncio
async def test_ver_pdf_que_nao_abre_explica_sem_quebrar(monkeypatch, bucket):
    async def baixa(ref):
        return b"isto nao e um pdf"
    monkeypatch.setattr(pv, "_baixa_pdf", baixa)
    p = await pv.monta_previa(_post(midias=["midia://x.pdf"]), None, True)
    assert "Não foi possível abrir o PDF" in p["midias"][0]["motivo"]


@pytest.mark.asyncio
async def test_rota_ver_nao_muda_nada(bucket, banco):
    db = banco(_Db(_post(midias=["midia://x.pdf"])))
    antes = (db.post.content, db.post.scheduled_at, db.post.media_urls, db.post.status)
    p = await ep.previa_post(db.post.id, db)
    assert db.updates == [] and db.inserts == [] and db.commits == 0
    assert (db.post.content, db.post.scheduled_at, db.post.media_urls, db.post.status) == antes
    assert p["id"] == str(db.post.id)


# ── Editar ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_editar_texto_e_comentario_salva_e_mostra_o_novo(bucket, banco):
    db = banco(_Db(_post()))
    novo = "Texto novo.\n\n#gestao"
    r = await ep.editar_post(db.post.id, PostEdit(content=novo, primeiro_comentario="Comente aqui"), db)
    assert r["content"] == novo and r["primeiro_comentario"] == "Comente aqui"
    assert r["mensagem"] == "Alterações salvas: texto e primeiro comentário."
    assert db.updates == [{"content": novo}] and db.commits == 1
    _sem_proibidos(r["mensagem"])


@pytest.mark.asyncio
async def test_editar_so_o_codigo_nao_toca_no_post(bucket, banco):
    db = banco(_Db(_post()))
    antes = (db.post.content, db.post.scheduled_at)
    r = await ep.editar_post(db.post.id, PostEdit(codigo_peca="  C2   #09 "), db)
    assert db.updates == [] and db.inserts[0]["codigo_peca"] == "C2 #09"
    assert (db.post.content, db.post.scheduled_at) == antes and r["codigo_peca"] == "C2 #09"
    assert r["mensagem"] == "Alterações salvas: código da peça."


@pytest.mark.asyncio
async def test_editar_horario(bucket, banco):
    db = banco(_Db(_post()))
    quando = (datetime.now(timezone.utc) + timedelta(days=2)).replace(microsecond=0)
    r = await ep.editar_post(db.post.id, PostEdit(scheduled_at=quando), db)
    assert db.updates == [{"scheduled_at": quando}] and r["scheduled_at"] == quando.isoformat()


@pytest.mark.asyncio
async def test_salvar_sem_mudar_nada_nao_grava(bucket, banco):
    db = banco(_Db(_post()))
    r = await ep.editar_post(db.post.id, PostEdit(content=TEXTO, scheduled_at=db.post.scheduled_at), db)
    assert db.updates == [] and db.inserts == [] and db.commits == 0 and r["mensagem"].startswith("Nada mudou")


@pytest.mark.asyncio
@pytest.mark.parametrize("post,dados,trecho", [
    (lambda: _post(em=timedelta(minutes=1)), {"content": "x"}, "menos de 2 minutos"),
    (lambda: _post(status=PostStatusEnum.published), {"content": "x"}, "não está mais agendado"),
    (lambda: _post(), {"content": "   "}, "não pode ficar vazio"),
    (lambda: _post(), {"content": "a" * 3001}, "limite desta rede é 3000"),
    (lambda: _post(), {"scheduled_at": datetime.now(timezone.utc) + timedelta(minutes=3)}, "pelo menos 5 minutos"),
    (lambda: _post(), {"codigo_peca": "x" * 41}, "no máximo 40"),
    (lambda: _post(), {"primeiro_comentario": "a" * 1251}, "limite desta rede é 1250"),
])
async def test_editar_recusa_com_motivo_e_nao_grava(bucket, banco, post, dados, trecho):
    db = banco(_Db(post()))
    with pytest.raises(HTTPException) as e:
        await ep.editar_post(db.post.id, PostEdit(**dados), db)
    assert trecho in e.value.detail and db.updates == [] and db.inserts == [] and db.commits == 0
    _sem_proibidos(e.value.detail)


@pytest.mark.asyncio
async def test_post_que_saiu_durante_a_edicao_nao_grava_nada(bucket, banco):
    db = banco(_Db(_post(), rowcount=0))
    with pytest.raises(HTTPException) as e:
        await ep.editar_post(db.post.id, PostEdit(content="novo", primeiro_comentario="c"), db)
    assert "Nada foi salvo" in e.value.detail and db.rollbacks == 1 and db.commits == 0
    assert db.post.content == TEXTO and db.inserts == []


@pytest.mark.asyncio
async def test_sem_a_tabela_nova_texto_funciona_e_codigo_explica(bucket, banco):
    db = banco(_Db(_post(), ativos=False))
    with pytest.raises(HTTPException) as e:
        await ep.editar_post(db.post.id, PostEdit(content="novo", codigo_peca="pt056"), db)
    assert "ainda não estão ativados" in e.value.detail and db.updates == [] and db.commits == 0
    r = await ep.editar_post(db.post.id, PostEdit(content="novo"), db)
    assert r["content"] == "novo" and r["extras_ativos"] is False


def test_tabela_nova_nao_e_criada_sozinha_no_inicio():
    import inspect
    from app import main
    fonte = inspect.getsource(main.on_startup)
    assert 't.name != "post_extras"' in fonte and "tables=tabelas" in fonte


# ── Título do documento (19/10): nunca vem da legenda ─────────────────────────

@pytest.mark.asyncio
async def test_ver_pdf_sem_titulo_gravado_nao_inventa(bucket):
    p = await pv.monta_previa(_post(midias=["midia://x.pdf"]), None, True)
    assert p["usa_titulo"] is True and p["titulo_documento"] is None


@pytest.mark.asyncio
async def test_editar_titulo_do_documento_sem_tocar_no_post(bucket, banco):
    db = banco(_Db(_post(midias=["midia://pt056.pdf"])))
    antes = (db.post.content, db.post.scheduled_at, db.post.media_urls)
    r = await ep.editar_post(db.post.id, PostEdit(titulo_documento=" Quando tudo  passa pelo dono ", codigo_peca="pt056"), db)
    assert db.updates == [] and db.inserts == [{"post_id": db.post.id, "titulo_documento": "Quando tudo passa pelo dono", "codigo_peca": "pt056"}]
    assert (db.post.content, db.post.scheduled_at, db.post.media_urls) == antes
    assert r["titulo_documento"] == "Quando tudo passa pelo dono" and r["codigo_peca"] == "pt056"
    assert r["mensagem"] == "Alterações salvas: título do documento e código da peça."


@pytest.mark.asyncio
@pytest.mark.parametrize("midias,titulo,trecho", [
    (["midia://a.pdf"], "   ", "não pode ficar vazio"),
    (["midia://a.png"], "Um título", "Só post do LinkedIn com PDF"),
    ([], "Um título", "Só post do LinkedIn com PDF"),
    (["midia://a.pdf"], "x" * 201, "no máximo 200"),
])
async def test_titulo_invalido_e_recusado(bucket, banco, midias, titulo, trecho):
    db = banco(_Db(_post(midias=midias)))
    with pytest.raises(HTTPException) as e:
        await ep.editar_post(db.post.id, PostEdit(titulo_documento=titulo), db)
    assert trecho in e.value.detail and db.inserts == [] and db.commits == 0
    _sem_proibidos(e.value.detail)


# ── Criar ──────────────────────────────────────────────────────────────────────

class _DbCriar:
    def __init__(self):
        self.adicionados, self.commits, self.flushes = [], 0, 0

    def add(self, obj):
        self.adicionados.append(obj)

    async def flush(self):
        self.flushes += 1
        for o in self.adicionados:
            o.id = o.id or uuid.uuid4()

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj):
        obj.id = obj.id or uuid.uuid4()


@pytest.fixture
def criar(monkeypatch):
    estado = {"ativos": True, "gravados": []}

    async def usuario(db):
        return uuid.uuid4()

    async def ativos(db):
        return estado["ativos"]

    async def grava(db, post_id, valores):
        estado["gravados"].append({"post_id": post_id, **valores})
    monkeypatch.setattr(ep, "_get_first_user_id", usuario)
    monkeypatch.setattr(ep.extras_service, "extras_ativos", ativos)
    monkeypatch.setattr(ep.extras_service, "grava_extras", grava)
    return estado


def _novo(**k):
    from app.schemas.schemas import PostCreate
    base = {"platform": "linkedin", "content": "Legenda do post", "media_urls": ["midia://c.pdf"],
            "scheduled_at": datetime.now(timezone.utc) + timedelta(days=1)}
    return PostCreate(**{**base, **k})


@pytest.mark.asyncio
async def test_criar_pdf_no_linkedin_sem_titulo_e_bloqueado(criar):
    db = _DbCriar()
    with pytest.raises(HTTPException) as e:
        await ep.create_post(_novo(), db)
    assert "Informe o título do documento" in e.value.detail and db.adicionados == [] and criar["gravados"] == []
    _sem_proibidos(e.value.detail)


@pytest.mark.asyncio
async def test_criar_pdf_com_titulo_e_comentario_grava_junto(criar):
    db = _DbCriar()
    post = await ep.create_post(_novo(titulo_documento="Quando tudo passa pelo dono", primeiro_comentario="Comente aqui",
                                      codigo_peca="pt056"), db)
    assert db.commits == 1 and criar["gravados"] == [{"post_id": post.id, "titulo_documento": "Quando tudo passa pelo dono",
                                                       "primeiro_comentario": "Comente aqui", "codigo_peca": "pt056"}]


@pytest.mark.asyncio
async def test_criar_sem_a_tabela_nova_explica_e_nao_cria(criar):
    criar["ativos"] = False
    db = _DbCriar()
    with pytest.raises(HTTPException) as e:
        await ep.create_post(_novo(titulo_documento="Quando tudo passa pelo dono"), db)
    assert "ainda não estão" in e.value.detail and db.adicionados == []
    # post só com texto continua sendo criado normalmente
    await ep.create_post(_novo(media_urls=None), db)
    assert len(db.adicionados) == 1 and criar["gravados"] == []
