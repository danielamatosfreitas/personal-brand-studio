"""
app/db/database.py
Configuração do engine assíncrono e session factory do SQLAlchemy.
"""
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

# Engine assíncrono — pool configurado para produção leve
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.SQL_ECHO,
    pool_size=5,
    max_overflow=10,
)

# Session factory — expire_on_commit=False evita lazy-load após commit
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Base declarativa para todos os modelos."""
    pass


async def get_db() -> AsyncSession:
    """
    Dependency do FastAPI que provê uma sessão de banco por request.
    Garante fechamento mesmo em caso de exceção.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
