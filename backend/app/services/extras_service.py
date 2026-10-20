"""
app/services/extras_service.py
Dados extras de um post (19/10), na tabela post_extras: título do documento
(PDF no LinkedIn), primeiro comentário (feito à mão) e código da peça.

A tabela é criada pela Dani, por SQL aprovado. Enquanto ela não existe, a
leitura devolve "sem extras" e a gravação é recusada com aviso; a tabela
posts, lida pelo agendador, não depende dela.
"""
import uuid

from sqlalchemy import select, text, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import PostExtra

CAMPOS = ("titulo_documento", "primeiro_comentario", "codigo_peca")
TITULO_MAX = 200
CODIGO_MAX = 40


async def extras_ativos(db: AsyncSession) -> bool:
    """A tabela post_extras já existe no banco?"""
    return bool((await db.execute(text("SELECT to_regclass('public.post_extras') IS NOT NULL"))).scalar())


async def le_extra(db: AsyncSession, post_id: uuid.UUID) -> tuple[PostExtra | None, bool]:
    """(extras do post ou None, tabela existe)."""
    if not await extras_ativos(db):
        return None, False
    extra = (await db.execute(select(PostExtra).where(PostExtra.post_id == post_id))).scalar_one_or_none()
    return extra, True


async def titulo_do_documento(db: AsyncSession, post_id: uuid.UUID) -> str | None:
    """Título do documento gravado para o post; None se não houver.
    Nunca vem do texto do post."""
    extra, _ = await le_extra(db, post_id)
    return ((extra.titulo_documento if extra else None) or "").strip() or None


async def grava_extras(db: AsyncSession, post_id: uuid.UUID, valores: dict) -> None:
    """Insere ou atualiza os campos enviados (sem commit)."""
    await db.execute(
        pg_insert(PostExtra).values(post_id=post_id, **valores)
        .on_conflict_do_update(index_elements=[PostExtra.post_id], set_={**valores, "updated_at": func.now()})
    )


def limpa_titulo(v: str | None) -> str | None:
    return " ".join((v or "").split()) or None


def limpa_codigo(v: str | None) -> str | None:
    return " ".join((v or "").split()) or None


def limpa_comentario(v: str | None) -> str | None:
    return (v or "").strip() or None
