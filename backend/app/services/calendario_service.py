"""
app/services/calendario_service.py
Espelho do Calendário (20/10): cópia só de leitura do calendário oficial (o
arquivo HTML da pasta MARKETING, mantido pela sessão Calendário), para a dona da conta
conferir os textos pelo celular. O app nunca edita o calendário.

O espelho é um arquivo JSON (formato em docs/espelho-calendario.md) guardado
no mesmo bucket da mídia, sem tabela no banco:
  - calendario/espelho.json: a versão atual;
  - calendario/espelho-anterior.json: a versão de antes do último envio.
"""
import asyncio
import json
from datetime import date, datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.config import settings
from app.services import storage_service

CHAVE_ATUAL = "calendario/espelho.json"
CHAVE_ANTERIOR = "calendario/espelho-anterior.json"
TAMANHO_MAX = 5 * 1024 * 1024
TEXTO_MAX = 20000

Rede = Literal["linkedin_pessoal", "linkedin_empresa", "instagram", "facebook", "stories"]
Formato = Literal["carrossel", "card", "pdf", "reel", "texto", "stories", "imagem", "video"]


class ItemEspelho(BaseModel):
    """Uma linha do calendário (uma publicação numa rede)."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1, max_length=120)
    data: date
    hora: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    rede: Rede
    codigo: Optional[str] = Field(default=None, max_length=40)
    titulo: str = Field(min_length=1, max_length=300)
    formato: Optional[Formato] = None
    slides: Optional[int] = Field(default=None, ge=1, le=20)
    cor: Optional[str] = Field(default=None, max_length=40)
    status: Optional[str] = Field(default=None, max_length=120)
    legenda: Optional[str] = Field(default=None, max_length=TEXTO_MAX)
    primeiro_comentario: Optional[str] = Field(default=None, max_length=TEXTO_MAX)
    titulo_documento: Optional[str] = Field(default=None, max_length=300)
    roteiro: Optional[str] = Field(default=None, max_length=TEXTO_MAX)
    notas: Optional[str] = Field(default=None, max_length=TEXTO_MAX)


class Espelho(BaseModel):
    model_config = ConfigDict(extra="ignore")

    versao: Literal[1]
    gerado_em: datetime
    fonte: Optional[str] = Field(default=None, max_length=200)
    itens: list[ItemEspelho] = Field(max_length=3000)

    @field_validator("gerado_em")
    @classmethod
    def com_fuso(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("gerado_em precisa ter o fuso horário (ex.: 2026-10-20T10:49:00-03:00).")
        return v

    @model_validator(mode="after")
    def ids_unicos(self):
        vistos, repetidos = set(), set()
        for it in self.itens:
            (repetidos if it.id in vistos else vistos).add(it.id)
        if repetidos:
            raise ValueError(f"id repetido: {', '.join(sorted(repetidos)[:5])}")
        return self


def _grava(espelho: dict) -> None:
    s3 = storage_service.client()
    try:
        s3.copy_object(Bucket=settings.S3_BUCKET, Key=CHAVE_ANTERIOR,
                       CopySource={"Bucket": settings.S3_BUCKET, "Key": CHAVE_ATUAL})
    except Exception as e:  # primeiro envio: ainda não há versão atual
        if "NoSuchKey" not in type(e).__name__ and "NoSuchKey" not in str(e) and "404" not in str(e):
            raise
    s3.put_object(Bucket=settings.S3_BUCKET, Key=CHAVE_ATUAL, ContentType="application/json; charset=utf-8",
                  Body=json.dumps(espelho, ensure_ascii=False).encode("utf-8"))


def _le() -> Optional[dict]:
    s3 = storage_service.client()
    try:
        obj = s3.get_object(Bucket=settings.S3_BUCKET, Key=CHAVE_ATUAL)
    except Exception as e:
        if "NoSuchKey" in type(e).__name__ or "NoSuchKey" in str(e) or "404" in str(e):
            return None
        raise
    return json.loads(obj["Body"].read().decode("utf-8"))


async def guarda(espelho: Espelho) -> dict:
    dados = {**espelho.model_dump(mode="json"), "recebido_em": datetime.now(timezone.utc).isoformat()}
    await asyncio.to_thread(_grava, dados)
    return dados


async def le() -> Optional[dict]:
    return await asyncio.to_thread(_le)
