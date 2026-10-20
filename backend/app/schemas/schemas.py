"""
app/schemas/schemas.py
Schemas Pydantic para validação de requests e serialização de responses.
"""
import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator

from app.db.models import PlatformEnum, PostStatusEnum


# ── OAuth ──────────────────────────────────────────────────────────────────────

class OAuthStatusItem(BaseModel):
    platform: PlatformEnum
    connected: bool
    platform_user_id: Optional[str] = None
    token_expires_at: Optional[datetime] = None
    is_expired: bool = False

    model_config = {"from_attributes": True}


class OAuthStatusResponse(BaseModel):
    platforms: list[OAuthStatusItem]


# ── Posts ──────────────────────────────────────────────────────────────────────

class PostCreate(BaseModel):
    platform: PlatformEnum
    content: str
    media_urls: Optional[list[str]] = None
    scheduled_at: Optional[datetime] = None
    # null = perfil pessoal do LinkedIn; preenchido = URN da Página de
    # empresa escolhida (ex: "urn:li:organization:12345")
    linkedin_organization_urn: Optional[str] = None
    # 19/10, em post_extras: título do documento (obrigatório para PDF no
    # LinkedIn), primeiro comentário (feito à mão) e código da peça.
    titulo_documento: Optional[str] = None
    primeiro_comentario: Optional[str] = None
    codigo_peca: Optional[str] = None

    @field_validator("linkedin_organization_urn")
    @classmethod
    def organization_urn_format(cls, v: str | None) -> str | None:
        if v is not None and not v.startswith("urn:li:organization:"):
            raise ValueError("linkedin_organization_urn precisa ser um URN de organização válido.")
        return v

    @field_validator("scheduled_at")
    @classmethod
    def scheduled_at_must_be_future(cls, v: datetime | None) -> datetime | None:
        if v is None:
            return v
        # normaliza pra comparar mesmo se vier sem timezone
        now = datetime.now(v.tzinfo) if v.tzinfo else datetime.utcnow()
        if v <= now:
            raise ValueError("A data de agendamento precisa estar no futuro.")
        return v

    @field_validator("content")
    @classmethod
    def content_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("O conteúdo do post não pode estar vazio.")
        return v.strip()

    @field_validator("media_urls")
    @classmethod
    def validate_media_urls(cls, v: list[str] | None) -> list[str] | None:
        if v and len(v) > 10:
            raise ValueError("Máximo de 10 URLs de mídia por post.")
        return v


class PostEdit(BaseModel):
    """Editar de Agendados (19/10): só os campos enviados mudam. A validação
    fica na rota, para a mensagem de erro sair em português simples."""
    content: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    titulo_documento: Optional[str] = None
    codigo_peca: Optional[str] = None
    primeiro_comentario: Optional[str] = None


class PostResponse(BaseModel):
    id: uuid.UUID
    platform: PlatformEnum
    content: str
    media_urls: Optional[list[str]] = None
    status: PostStatusEnum
    platform_post_id: Optional[str] = None
    published_at: Optional[datetime] = None
    scheduled_at: Optional[datetime] = None
    linkedin_organization_urn: Optional[str] = None
    error_log: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class PublishResponse(BaseModel):
    success: bool
    post_id: uuid.UUID
    platform_post_id: Optional[str] = None
    message: str


# ── User ───────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    created_at: datetime

    model_config = {"from_attributes": True}
