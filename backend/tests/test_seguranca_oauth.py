"""
Fase 1 de segurança: a senha de acesso só pelo cabeçalho, nunca pelo endereço;
início da conexão por POST; state anti-CSRF no servidor, de uso único.
"""
import uuid
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.endpoints import oauth as oauth_endpoints

SENHA = "senha-de-teste"
client = TestClient(app)  # sem "with": não roda o startup (banco e agendador)


def _state_da(url: str) -> str:
    return parse_qs(urlparse(url).query)["state"][0]


@pytest.mark.parametrize("plataforma", ["linkedin", "instagram"])
def test_start_exige_senha_no_cabecalho(plataforma):
    assert client.post(f"/api/v1/oauth/{plataforma}/start").status_code == 401
    # senha no endereço não vale mais
    assert client.post(f"/api/v1/oauth/{plataforma}/start?token={SENHA}").status_code == 401
    r = client.post(f"/api/v1/oauth/{plataforma}/start", headers={"X-Access-Token": SENHA})
    assert r.status_code == 200
    url = r.json()["url"]
    assert SENHA not in url
    assert _state_da(url)


@pytest.mark.parametrize("plataforma", ["linkedin", "instagram"])
def test_rota_antiga_por_get_nao_existe_mais(plataforma):
    r = client.get(f"/api/v1/oauth/{plataforma}/authorize?token={SENHA}", follow_redirects=False)
    assert r.status_code in (404, 405)


def test_nenhuma_rota_aceita_senha_pelo_endereco():
    assert client.get(f"/api/v1/oauth/status?token={SENHA}").status_code == 401
    assert client.get(f"/api/v1/posts/?token={SENHA}").status_code == 401


def test_callback_linkedin_valida_state_de_uso_unico(monkeypatch):
    async def primeiro_usuario(db):
        return uuid.uuid4()

    async def troca(code, db, user_id):
        assert code == "codigo-teste"
        return object()

    async def sem_banco():
        yield None

    monkeypatch.setattr(oauth_endpoints, "_get_first_user_id", primeiro_usuario)
    monkeypatch.setattr(oauth_endpoints, "exchange_linkedin_code", troca)
    app.dependency_overrides[oauth_endpoints.get_db] = sem_banco
    try:
        url = client.post("/api/v1/oauth/linkedin/start", headers={"X-Access-Token": SENHA}).json()["url"]
        state = _state_da(url)
        r = client.get(f"/api/v1/oauth/linkedin/callback?code=codigo-teste&state={state}", follow_redirects=False)
        assert r.status_code in (302, 307)
        assert "oauth=linkedin&status=success" in r.headers["location"]
        # o mesmo state não vale duas vezes
        r2 = client.get(f"/api/v1/oauth/linkedin/callback?code=codigo-teste&state={state}", follow_redirects=False)
        assert r2.status_code == 400
        # state inventado também não
        r3 = client.get("/api/v1/oauth/linkedin/callback?code=codigo-teste&state=inventado", follow_redirects=False)
        assert r3.status_code == 400
    finally:
        app.dependency_overrides.clear()


def test_state_de_uma_plataforma_nao_vale_na_outra(monkeypatch):
    async def sem_banco():
        yield None

    app.dependency_overrides[oauth_endpoints.get_db] = sem_banco
    try:
        url = client.post("/api/v1/oauth/linkedin/start", headers={"X-Access-Token": SENHA}).json()["url"]
        r = client.get(f"/api/v1/oauth/instagram/callback?code=x&state={_state_da(url)}", follow_redirects=False)
        assert "oauth=instagram&status=error" in r.headers["location"]
    finally:
        app.dependency_overrides.clear()


def test_state_vencido_e_recusado(monkeypatch):
    from app.core import oauth_state
    oauth_state.registra_state("linkedin", "state-velho")
    plataforma, _ = oauth_state._estados["state-velho"]
    oauth_state._estados["state-velho"] = (plataforma, 0.0)  # venceu
    assert oauth_state.consome_state("linkedin", "state-velho") is False
