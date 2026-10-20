"""
app/api/v1/endpoints/ai.py
Endpoints de geração de conteúdo com IA.
Fase 2.2 — Suporte a carrossel e texto puro no LinkedIn.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from app.core.security import require_access_token
from app.services.ai_service import generate_post, AIServiceError

router = APIRouter(
    prefix="/ai", tags=["IA — Geração de Conteúdo"],
    dependencies=[Depends(require_access_token)],
)


class GeneratePostRequest(BaseModel):
    topic: str
    platform: str
    format_type: str = "text"  # "text", "carousel" ou "quote" (quote é Instagram only)

    @field_validator("topic")
    @classmethod
    def topic_not_empty(cls, v: str) -> str:
        if not v.strip() or len(v.strip()) < 5:
            raise ValueError("O tema precisa ter pelo menos 5 caracteres.")
        return v.strip()

    @field_validator("platform")
    @classmethod
    def platform_valid(cls, v: str) -> str:
        if v.lower() not in ("linkedin", "instagram"):
            raise ValueError("Plataforma deve ser 'linkedin' ou 'instagram'.")
        return v.lower()

    @field_validator("format_type")
    @classmethod
    def format_valid(cls, v: str) -> str:
        if v.lower() not in ("text", "carousel", "quote"):
            raise ValueError("format_type deve ser 'text', 'carousel' ou 'quote'.")
        return v.lower()


class GeneratePostResponse(BaseModel):
    platform: str
    topic: str
    format_type: str
    generated_text: str
    char_count: int
    word_count: int


@router.post(
    "/generate_post",
    response_model=GeneratePostResponse,
    summary="Gera um post com IA no tom de voz configurado na persona",
)
async def generate_post_endpoint(payload: GeneratePostRequest):
    """
    Gera conteúdo para LinkedIn ou Instagram.

    Exemplos de uso:

    Post de texto LinkedIn:
    ```json
    {"topic": "turnover alto como sintoma de cultura fraca", "platform": "linkedin", "format_type": "text"}
    ```

    Roteiro de carrossel LinkedIn:
    ```json
    {"topic": "os 5 erros que destroem a cultura de uma empresa", "platform": "linkedin", "format_type": "carousel"}
    ```

    Post Instagram:
    ```json
    {"topic": "por que gestores promovidos sem preparo destroem times", "platform": "instagram", "format_type": "text"}
    ```
    """
    try:
        text = await generate_post(
            topic=payload.topic,
            platform=payload.platform,
            format_type=payload.format_type,
        )
    except AIServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))

    return GeneratePostResponse(
        platform=payload.platform,
        topic=payload.topic,
        format_type=payload.format_type,
        generated_text=text,
        char_count=len(text),
        word_count=len(text.split()),
    )
