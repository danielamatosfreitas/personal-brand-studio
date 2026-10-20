"""
app/api/v1/endpoints/media.py
Recebe os slides já renderizados no frontend (PNG em base64), converte
para JPEG, opcionalmente monta um PDF multi-página, e sobe tudo para o
bucket de mídia (app/services/storage_service.py). Retorna referências
"midia://<chave>" prontas para entrar em Post.media_urls; na hora de publicar
o backend troca cada uma por uma URL assinada.
"""
import base64

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, field_validator

from app.core.security import require_access_token
from app.services.media_service import assemble_pdf, MediaError, png_to_jpeg
from app.services.storage_service import StorageError, upload_media

router = APIRouter(
    prefix="/media", tags=["Media"],
    dependencies=[Depends(require_access_token)],
)

MAX_EXTERNAL_FILE_SIZE = 20 * 1024 * 1024  # 20MB -- imagem/PDF
MAX_VIDEO_FILE_SIZE = 200 * 1024 * 1024  # 200MB -- vídeo (MP4/MOV)
_VIDEO_EXTENSIONS = {"mp4", "mov"}

# aceita pelo content-type e, como reforço (alguns navegadores mandam
# content-type genérico), pela extensão do nome do arquivo
_EXTENSION_BY_CONTENT_TYPE = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "application/pdf": "pdf",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
}
_EXTENSION_BY_SUFFIX = {
    ".jpg": ("jpg", "image/jpeg"),
    ".jpeg": ("jpg", "image/jpeg"),
    ".png": ("png", "image/png"),
    ".pdf": ("pdf", "application/pdf"),
    ".mp4": ("mp4", "video/mp4"),
    ".mov": ("mov", "video/quicktime"),
}


class SlideUpload(BaseModel):
    images_base64: list[str]  # cada item: PNG em base64 (data URI ou puro)
    assemble_pdf: bool = False  # se True, também monta e sobe um PDF multi-página

    @field_validator("images_base64")
    @classmethod
    def not_empty(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("Envie ao menos uma imagem.")
        if len(v) > 10:
            raise ValueError("Máximo de 10 imagens por post.")
        return v


class SlideUploadResponse(BaseModel):
    image_urls: list[str]
    pdf_url: str | None = None


def _decode_png(b64: str) -> bytes:
    if b64.strip().startswith("data:"):
        b64 = b64.split(",", 1)[1]
    try:
        return base64.b64decode(b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Base64 inválido: {e}")


@router.post(
    "/upload",
    response_model=SlideUploadResponse,
    summary="Sobe os slides gerados (PNG) e retorna URLs públicas",
)
async def upload_slides(payload: SlideUpload):
    png_list = [_decode_png(b64) for b64 in payload.images_base64]

    try:
        image_urls = []
        for png_bytes in png_list:
            jpeg_bytes = png_to_jpeg(png_bytes)
            url = await upload_media(jpeg_bytes, "jpg", "image/jpeg")
            image_urls.append(url)

        pdf_url = None
        if payload.assemble_pdf:
            pdf_bytes = assemble_pdf(png_list)
            pdf_url = await upload_media(pdf_bytes, "pdf", "application/pdf")

    except (MediaError, StorageError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    return SlideUploadResponse(image_urls=image_urls, pdf_url=pdf_url)


class FileUploadResponse(BaseModel):
    url: str
    content_type: str


@router.post(
    "/upload-file",
    response_model=FileUploadResponse,
    summary="Sobe um arquivo já pronto (JPG/PNG/PDF/MP4/MOV), feito fora do sistema",
)
async def upload_external_file(file: UploadFile = File(...)):
    """
    Recebe um arquivo bruto -- foto, PDF ou vídeo já finalizado em outra
    ferramenta -- e sobe pro bucket de mídia sem nenhuma conversão.
    Diferente de /upload, que espera PNGs de cards gerados aqui dentro.
    """
    extension = _EXTENSION_BY_CONTENT_TYPE.get(file.content_type or "")
    content_type = file.content_type

    if not extension:
        name = (file.filename or "").lower()
        for suffix, (ext, ct) in _EXTENSION_BY_SUFFIX.items():
            if name.endswith(suffix):
                extension, content_type = ext, ct
                break

    if not extension:
        raise HTTPException(
            status_code=400,
            detail="Formato não suportado. Envie um arquivo JPG, PNG, PDF, MP4 ou MOV.",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Arquivo vazio.")

    is_video = extension in _VIDEO_EXTENSIONS
    max_size = MAX_VIDEO_FILE_SIZE if is_video else MAX_EXTERNAL_FILE_SIZE
    if len(data) > max_size:
        raise HTTPException(
            status_code=400,
            detail=f"Arquivo maior que {max_size // (1024 * 1024)}MB.",
        )

    try:
        url = await upload_media(data, extension, content_type)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return FileUploadResponse(url=url, content_type=content_type)
