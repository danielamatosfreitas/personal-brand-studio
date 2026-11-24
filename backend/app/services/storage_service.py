"""
app/services/storage_service.py
Mídia do Personal Brand Studio num bucket compatível com S3.

Hoje: Railway Storage Bucket (privado). Trocar para Cloudflare R2 ou outro
serviço S3 é só mudar as variáveis S3_* (ver app/core/config.py); o código é o
mesmo. Nada aqui depende do Supabase.

Como funciona:
  - upload_media sobe o arquivo (envio em partes acima de 16 MB, o que cobre
    vídeo de 300 MB) e devolve uma referência "midia://<chave>", que é o que
    fica gravado em Post.media_urls;
  - na hora de publicar, resolve_media_url troca a referência por uma URL
    assinada, válida por MEDIA_URL_TTL_SECONDS (6 horas por padrão), que o
    LinkedIn (via backend) e o Instagram conseguem baixar. Assim um post
    agendado para daqui a semanas nunca carrega uma URL vencida;
  - URLs antigas (https://..., de posts feitos antes desta mudança) passam
    direto, sem alteração.
"""
import asyncio
import io
import uuid

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config

from app.core.config import settings

REF_PREFIX = "midia://"
_PARTE = 16 * 1024 * 1024  # envio em partes de 16 MB acima de 16 MB


class StorageError(Exception):
    """Erro ao subir ou assinar mídia no bucket."""
    pass


def _faltando() -> list[str]:
    return [nome for nome in ("S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY")
            if not getattr(settings, nome)]


def client():
    """Cliente S3 configurado só pelas variáveis S3_*."""
    faltando = _faltando()
    if faltando:
        raise StorageError(
            "Armazenamento de mídia não configurado. Defina na Railway: " + ", ".join(faltando) + "."
        )
    estilo = settings.S3_ADDRESSING_STYLE if settings.S3_ADDRESSING_STYLE in ("virtual", "path") else "virtual"
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT,
        aws_access_key_id=settings.S3_ACCESS_KEY_ID,
        aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
        region_name=settings.S3_REGION or "auto",
        config=Config(signature_version="s3v4", s3={"addressing_style": estilo},
                      retries={"max_attempts": 3, "mode": "standard"}),
    )


def transfer_config() -> TransferConfig:
    return TransferConfig(multipart_threshold=_PARTE, multipart_chunksize=_PARTE, max_concurrency=4)


def _sobe(dados: bytes, chave: str, content_type: str) -> None:
    client().upload_fileobj(
        io.BytesIO(dados), settings.S3_BUCKET, chave,
        ExtraArgs={"ContentType": content_type}, Config=transfer_config(),
    )


async def upload_media(data: bytes, extension: str, content_type: str) -> str:
    """
    Sobe `data` para o bucket e devolve a referência "midia://<chave>".
    `extension` sem ponto (ex: "jpg", "pdf"). A chave é sempre nova (uuid),
    então nunca sobrescreve nada.
    """
    chave = f"{uuid.uuid4().hex}.{extension.lower().lstrip('.')}"
    try:
        await asyncio.to_thread(_sobe, data, chave, content_type)
    except StorageError:
        raise
    except Exception as e:  # erro do bucket (credencial, rede, permissão)
        raise StorageError(f"Falha ao subir mídia para o armazenamento: {type(e).__name__}: {e}") from e
    return REF_PREFIX + chave


def chave_de(ref: str) -> str:
    return ref[len(REF_PREFIX):] if ref.startswith(REF_PREFIX) else ref


def presigned_url(ref: str, ttl_seconds: int | None = None) -> str:
    """URL assinada de leitura (GET) para uma referência "midia://<chave>"."""
    return client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.S3_BUCKET, "Key": chave_de(ref)},
        ExpiresIn=int(ttl_seconds or settings.MEDIA_URL_TTL_SECONDS),
    )


def resolve_media_url(url: str) -> str:
    """Referência "midia://..." vira URL assinada; qualquer outra URL passa igual."""
    return presigned_url(url) if url.startswith(REF_PREFIX) else url
