"""
app/core/security.py
Trava de acesso simples pra API inteira -- uma senha única (APP_ACCESS_TOKEN),
sem banco de dados nem sistema de usuários. Aceita a senha só pelo
cabeçalho X-Access-Token (chamadas via fetch, do frontend). Nunca pelo
endereço: senha em query string fica gravada em log de acesso, histórico do
navegador e cabeçalho Referer. Desde a Fase 1 de segurança (14/10), o início
da conexão OAuth também é um fetch (POST /oauth/{plataforma}/start).

Falha FECHADO: se APP_ACCESS_TOKEN não estiver configurado, todo acesso é
negado -- nunca "aberto por padrão". Isso é intencional: o objetivo é que a
API fique bloqueada assim que este código sobe, mesmo antes da variável de
ambiente existir no Railway.
"""
from fastapi import Header, HTTPException

from app.core.config import settings


async def require_access_token(
    x_access_token: str | None = Header(default=None, alias="X-Access-Token"),
) -> None:
    configured = settings.APP_ACCESS_TOKEN
    provided = x_access_token

    if not configured or not provided or provided != configured:
        raise HTTPException(status_code=401, detail="Acesso não autorizado.")
