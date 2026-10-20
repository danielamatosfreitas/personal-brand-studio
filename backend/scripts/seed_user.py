"""
scripts/seed_user.py
Cria a usuária principal no banco de dados.
Execute uma única vez após o primeiro start da aplicação.

Uso:
  SEED_USER_NAME="Seu Nome" SEED_USER_EMAIL=voce@exemplo.com SEED_USER_PASSWORD=... python scripts/seed_user.py

A senha vem da variável de ambiente SEED_USER_PASSWORD (nunca escrita no
código). Observação: hoje nenhuma rota do app confere essa senha; o acesso é
pela senha única APP_ACCESS_TOKEN (app/core/security.py).
"""
import asyncio
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from app.core.config import settings
from app.db.models import User, Base

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


async def seed():
    senha = os.environ.get("SEED_USER_PASSWORD", "")
    if len(senha) < 12:
        sys.exit("Defina SEED_USER_PASSWORD (pelo menos 12 caracteres) antes de rodar o seed.")

    engine = create_async_engine(settings.DATABASE_URL)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as session:
        user = User(
            name=os.environ.get("SEED_USER_NAME", "Pessoa Autora"),
            email=os.environ["SEED_USER_EMAIL"],
            hashed_password=pwd_context.hash(senha),
        )
        session.add(user)
        await session.commit()
        print(f"✅ Usuária criada com sucesso! ID: {user.id}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
