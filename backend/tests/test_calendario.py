"""
Espelho do Calendário (20/10): envio com chave própria, guardado no bucket
(simulado aqui), leitura com a senha do app. Nenhuma tabela no banco.
"""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services import calendario_service as cs

SENHA = "senha-de-teste"
CHAVE = "chave-de-sincronizacao-de-teste"
RAIZ = Path(__file__).resolve().parent.parent
EXEMPLO = (RAIZ / "docs" / "exemplo-calendario-espelho.json").read_bytes()
client = TestClient(app)  # sem "with": não roda o startup (banco e agendador)


@pytest.fixture
def bucket(monkeypatch):
    """Bucket em memória no lugar do armazenamento real."""
    guardado = {}
    monkeypatch.setattr(cs, "_grava", lambda dados: guardado.update({"atual": dados, "anterior": guardado.get("atual")}))
    monkeypatch.setattr(cs, "_le", lambda: guardado.get("atual"))
    monkeypatch.setattr(settings, "CALENDARIO_SYNC_TOKEN", CHAVE)
    return guardado


def _envia(corpo=EXEMPLO, chave=CHAVE):
    headers = {"Content-Type": "application/json", **({"X-Sync-Token": chave} if chave is not None else {})}
    return client.post("/api/v1/calendario/espelho", content=corpo, headers=headers)


def _com(**mudanca):
    d = json.loads(EXEMPLO)
    d["itens"][0].update(mudanca)
    return json.dumps(d).encode()


def test_exemplo_da_especificacao_e_valido():
    e = cs.Espelho.model_validate_json(EXEMPLO)
    assert len(e.itens) == 6 and {i.rede for i in e.itens} == {"stories", "linkedin_pessoal", "instagram", "facebook", "linkedin_empresa"}


def test_envio_fechado_sem_a_variavel_no_servidor(monkeypatch):
    monkeypatch.setattr(settings, "CALENDARIO_SYNC_TOKEN", "")
    r = _envia()
    assert r.status_code == 503 and "ainda não foi configurado" in r.json()["detail"]


@pytest.mark.parametrize("chave", [None, "", "outra-chave", SENHA])
def test_envio_recusa_sem_a_chave_certa(bucket, chave):
    # nem a senha do app vale para enviar
    assert _envia(chave=chave).status_code == 401
    assert bucket == {}


def test_chave_no_endereco_nao_vale(bucket):
    r = client.post(f"/api/v1/calendario/espelho?token={CHAVE}", content=EXEMPLO, headers={"Content-Type": "application/json"})
    assert r.status_code == 401 and bucket == {}


def test_envio_guarda_o_espelho_e_a_versao_anterior(bucket):
    r = _envia()
    assert r.status_code == 200
    corpo = r.json()
    assert corpo["itens"] == 6 and corpo["gerado_em"].startswith("2026-10-20T12:00:00")
    assert CHAVE not in json.dumps(corpo)
    atual = bucket["atual"]
    assert atual["recebido_em"] and atual["itens"][5]["titulo_documento"] == "A conta do fim da 6x1 numa loja pequena"
    # textos guardados exatamente como vieram (quebras de linha, hashtags)
    original = json.loads(EXEMPLO)
    assert [i.get("legenda") for i in atual["itens"]] == [i.get("legenda") for i in original["itens"]]
    _envia(_com(titulo="Título trocado"))
    assert bucket["anterior"]["itens"][0]["titulo"] == "Enquete da escala 6x1"
    assert bucket["atual"]["itens"][0]["titulo"] == "Título trocado"


@pytest.mark.parametrize("corpo,trecho", [
    (_com(rede="tiktok"), "rede"),
    (_com(hora="9h"), "hora"),
    (_com(data="27/10/2026"), "data"),
    (_com(titulo=""), "titulo"),
    (_com(id="2026-10-23-stories-texto"), "id repetido"),
    (json.dumps({**json.loads(EXEMPLO), "gerado_em": "2026-10-20T12:00:00"}).encode(), "fuso"),
    (json.dumps({**json.loads(EXEMPLO), "versao": 2}).encode(), "versao"),
    (b"isto nao e json", "JSON"),
])
def test_formato_errado_e_recusado_e_o_anterior_fica(bucket, corpo, trecho):
    _envia()
    antes = bucket["atual"]
    r = _envia(corpo)
    assert r.status_code == 422 and trecho in json.dumps(r.json(), ensure_ascii=False)
    assert bucket["atual"] is antes


def test_campo_a_mais_e_ignorado(bucket):
    assert _envia(_com(campo_novo="qualquer")).status_code == 200
    assert "campo_novo" not in bucket["atual"]["itens"][0]


def test_arquivo_grande_demais(bucket):
    assert _envia(b" " * (cs.TAMANHO_MAX + 1)).status_code == 413


def test_leitura_exige_a_senha_do_app(bucket):
    _envia()
    assert client.get("/api/v1/calendario/espelho").status_code == 401
    assert client.get("/api/v1/calendario/espelho", headers={"X-Sync-Token": CHAVE}).status_code == 401
    r = client.get("/api/v1/calendario/espelho", headers={"X-Access-Token": SENHA})
    assert r.status_code == 200 and len(r.json()["itens"]) == 6


def test_leitura_sem_espelho_ainda(bucket):
    r = client.get("/api/v1/calendario/espelho", headers={"X-Access-Token": SENHA})
    assert r.status_code == 200 and r.json() == {"vazio": True, "itens": []}


def test_script_de_envio_nao_mostra_a_chave(tmp_path, monkeypatch, capsys):
    import importlib.util
    spec = importlib.util.spec_from_file_location("enviar", RAIZ / "scripts" / "enviar_espelho_calendario.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    (tmp_path / ".sync_token").write_text(CHAVE + "\n", encoding="ascii")
    arq = tmp_path / "calendario-espelho.json"
    arq.write_bytes(EXEMPLO)
    monkeypatch.setattr(mod, "RAIZ", tmp_path)
    enviado = {}

    class Resp:
        status_code = 200
        def json(self):
            return {"itens": 6, "gerado_em": "2026-10-20T15:00:00Z", "recebido_em": "2026-10-20T15:01:00Z"}

    def post(url, content, timeout, headers):
        enviado.update(url=url, headers=headers, content=content)
        return Resp()
    monkeypatch.setattr(mod.httpx, "post", post)
    monkeypatch.setattr("sys.argv", ["enviar", str(arq)])
    assert mod.main() == 0
    saida = capsys.readouterr().out
    assert enviado["headers"]["X-Sync-Token"] == CHAVE and CHAVE not in enviado["url"]
    assert CHAVE not in saida and "Espelho enviado: 6 itens" in saida
