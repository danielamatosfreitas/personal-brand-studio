"""
app/api/v1/endpoints/calendario.py
Espelho do Calendário (20/10), só de leitura no app.

  - POST /calendario/espelho: a sessão Calendário envia o calendario-espelho.json.
    Protegido pela chave própria CALENDARIO_SYNC_TOKEN, no cabeçalho
    X-Sync-Token (nunca no endereço). Sem a variável no servidor, o envio
    fica fechado.
  - GET /calendario/espelho: a página Calendário do app lê o espelho, com a
    senha do app (X-Access-Token), como as outras rotas.
"""
import hmac
import json

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import ValidationError

from app.core.config import settings
from app.core.security import require_access_token
from app.services import calendario_service
from app.services.storage_service import StorageError

router = APIRouter(prefix="/calendario", tags=["Calendário"])


def _confere_chave(x_sync_token: str | None) -> None:
    configurada = settings.CALENDARIO_SYNC_TOKEN
    if not configurada:
        raise HTTPException(status_code=503, detail="O envio do calendário ainda não foi configurado no servidor.")
    if not x_sync_token or not hmac.compare_digest(x_sync_token.encode(), configurada.encode()):
        raise HTTPException(status_code=401, detail="Chave de sincronização recusada.")


def _erros(e: ValidationError) -> list[str]:
    return [f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}" for err in e.errors()[:10]]


@router.post("/espelho", summary="Recebe o espelho do Calendário (chave de sincronização)")
async def recebe_espelho(request: Request, x_sync_token: str | None = Header(default=None, alias="X-Sync-Token")):
    _confere_chave(x_sync_token)
    corpo = await request.body()
    if len(corpo) > calendario_service.TAMANHO_MAX:
        raise HTTPException(status_code=413, detail="O espelho passa de 5 MB.")
    try:
        bruto = json.loads(corpo.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise HTTPException(status_code=422, detail={"mensagem": "O arquivo não é um JSON válido em UTF-8."})
    try:
        espelho = calendario_service.Espelho.model_validate(bruto)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail={"mensagem": "O espelho não segue o formato combinado.", "erros": _erros(e)})
    try:
        guardado = await calendario_service.guarda(espelho)
    except StorageError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return {"ok": True, "itens": len(espelho.itens), "gerado_em": guardado["gerado_em"], "recebido_em": guardado["recebido_em"]}


@router.get("/espelho", summary="Espelho do Calendário para a página do app", dependencies=[Depends(require_access_token)])
async def le_espelho():
    try:
        dados = await calendario_service.le()
    except StorageError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return dados if dados is not None else {"vazio": True, "itens": []}
