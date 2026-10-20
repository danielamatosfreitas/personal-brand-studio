"""
app/db/models.py
Modelos SQLAlchemy — Fase 1: User, OAuthCredentials, Post.
"""
import uuid
import enum
from datetime import datetime

from sqlalchemy import (
    String, Text, Enum as SAEnum, ForeignKey,
    DateTime, JSON, func
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


# ── Enums ──────────────────────────────────────────────────────────────────────

class PlatformEnum(str, enum.Enum):
    linkedin = "linkedin"
    instagram = "instagram"
    both = "both"
    # Fase 4: exige no banco, antes do deploy,
    # ALTER TYPE platform_enum ADD VALUE IF NOT EXISTS 'facebook';
    facebook = "facebook"


class PostStatusEnum(str, enum.Enum):
    draft = "draft"
    scheduled = "scheduled"
    published = "published"
    failed = "failed"


# ── Modelos ────────────────────────────────────────────────────────────────────

class User(Base):
    """
    Usuária do sistema. Na Fase 1, haverá apenas um registro (a pessoa dona da conta).
    """
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relacionamentos
    credentials: Mapped[list["OAuthCredential"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    posts: Mapped[list["Post"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class OAuthCredential(Base):
    """
    Tokens OAuth de cada plataforma social conectada.
    Tokens são armazenados CRIPTOGRAFADOS via Fernet.
    """
    __tablename__ = "oauth_credentials"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    platform: Mapped[PlatformEnum] = mapped_column(
        SAEnum(PlatformEnum, name="platform_enum", create_type=True), nullable=False
    )

    # Tokens armazenados criptografados — NUNCA em plaintext
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)

    token_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    scope: Mapped[str | None] = mapped_column(Text, nullable=True)
    platform_user_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relacionamentos
    user: Mapped["User"] = relationship(back_populates="credentials")

    def is_expired(self) -> bool:
        """Verifica se o token já expirou (com margem de 5 minutos)."""
        from datetime import timezone, timedelta
        margin = timedelta(minutes=5)
        return datetime.now(timezone.utc) >= (self.token_expires_at - margin)


class Post(Base):
    """
    Rascunho ou publicação de conteúdo.
    """
    __tablename__ = "posts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    platform: Mapped[PlatformEnum] = mapped_column(
        SAEnum(PlatformEnum, name="platform_enum", create_type=True), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # Lista de URLs de mídia para Instagram (imagens/vídeos)
    media_urls: Mapped[list | None] = mapped_column(JSON, nullable=True)

    status: Mapped[PostStatusEnum] = mapped_column(
        SAEnum(PostStatusEnum, name="post_status_enum", create_type=True),
        nullable=False,
        default=PostStatusEnum.draft,
    )

    # ID retornado pela API da plataforma após publicação
    platform_post_id: Mapped[str | None] = mapped_column(String(512), nullable=True)

    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Quando status == scheduled, data/hora em que o scheduler_loop deve publicar
    scheduled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Destino no LinkedIn: null = perfil pessoal; preenchido = URN da Página
    # de empresa (ex: "urn:li:organization:12345") escolhida pela usuária.
    linkedin_organization_urn: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Log de erros de publicação para diagnóstico
    error_log: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relacionamentos
    user: Mapped["User"] = relationship(back_populates="posts")


class PostExtra(Base):
    """
    Dados de um post (19/10): título do documento (PDF no LinkedIn; nunca
    vem da legenda), primeiro comentário (a Dani faz à mão depois que o post
    sai) e código da peça. Ficam numa tabela à parte para a tabela posts
    (lida pelo agendador) não mudar. Criada pela Dani, com o SQL aprovado:
    CREATE TABLE IF NOT EXISTS post_extras (
        post_id UUID PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
        titulo_documento VARCHAR(200),
        primeiro_comentario TEXT,
        codigo_peca VARCHAR(40),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """
    __tablename__ = "post_extras"

    post_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True
    )
    titulo_documento: Mapped[str | None] = mapped_column(String(200), nullable=True)
    codigo_peca: Mapped[str | None] = mapped_column(String(40), nullable=True)
    primeiro_comentario: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
