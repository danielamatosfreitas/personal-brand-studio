"""
app/main.py
Ponto de entrada da aplicação FastAPI — Personal Brand OS.
Fase 2.1: Motor de IA adicionado.
"""
import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.core.config import settings
from app.api.v1.endpoints import oauth, posts, ai, media, calendario
from app.services.scheduler_service import scheduler_loop

# A biblioteca HTTP registra o endereço completo de cada chamada no nível INFO;
# algumas chamadas às redes levam chave ou token no endereço. Só avisos e erros
# dela entram no log (Fase 4, 16/10).
for _nome in ("httpx", "httpcore"):
    logging.getLogger(_nome).setLevel(logging.WARNING)

app = FastAPI(
    title="Personal Brand OS",
    description="Sistema de marca pessoal: criação, agendamento e publicação de conteúdo",
    version="2.0.0",
)

# ── Middlewares ────────────────────────────────────────────────────────────────

app.add_middleware(SessionMiddleware, secret_key=settings.SECRET_KEY)

app.add_middleware(
    CORSMiddleware,
    # endereços liberados: o do frontend, os extras de CORS_EXTRA_ORIGINS (separados por vírgula) e o local
    allow_origins=[settings.FRONTEND_URL, *[o.strip() for o in settings.CORS_EXTRA_ORIGINS.split(",") if o.strip()], "http://localhost:3000"],
    # deploy previews (subdomínio que muda a cada PR): expressão regular opcional em CORS_ORIGIN_REGEX
    allow_origin_regex=settings.CORS_ORIGIN_REGEX or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────────────────────

app.include_router(oauth.router, prefix="/api/v1")
app.include_router(posts.router, prefix="/api/v1")
app.include_router(ai.router, prefix="/api/v1")
app.include_router(media.router, prefix="/api/v1")
app.include_router(calendario.router, prefix="/api/v1")


# ── Health Check ───────────────────────────────────────────────────────────────

@app.get("/health", tags=["System"])
async def health():
    return {
        "status": "ok",
        "app": "Personal Brand OS",
        "phase": "2",
        "features": ["oauth", "posts", "ai_generation"],
    }


# ── Inicialização do Banco ─────────────────────────────────────────────────────

@app.on_event("startup")
async def on_startup():
    from app.db.database import engine, Base
    from app.db import models  # noqa
    from sqlalchemy import text

    if settings.APP_ENV == "development":
        # post_extras (19/10) fica de fora: no banco de produção ela é criada
        # pela Dani, com o SQL aprovado; enquanto não existe, o app funciona
        # sem código da peça e primeiro comentário.
        tabelas = [t for t in Base.metadata.sorted_tables if t.name != "post_extras"]
        async with engine.begin() as conn:
            await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=tabelas))

    # create_all só cria tabelas novas, nunca colunas em tabela já existente.
    # Sem Alembic no projeto, essa checagem idempotente garante que a coluna
    # scheduled_at exista em produção sem precisar rodar SQL manual no Railway.
    async with engine.begin() as conn:
        await conn.execute(
            text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ")
        )
        await conn.execute(
            text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS linkedin_organization_urn VARCHAR(255)")
        )

    # Loop de agendamento -- roda para sempre dentro deste mesmo processo
    asyncio.create_task(scheduler_loop())
