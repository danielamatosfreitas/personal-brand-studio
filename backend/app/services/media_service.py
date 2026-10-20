"""
app/services/media_service.py
Montagem de mídia a partir dos cards PNG gerados no frontend (next/og):
  - PNG -> JPEG (o Instagram Content Publishing API só aceita JPEG)
  - lista de PNGs -> PDF multi-página (documento/carrossel do LinkedIn)
"""
import io

from PIL import Image


class MediaError(Exception):
    """Erro ao processar uma imagem recebida."""
    pass


def _open_png(png_bytes: bytes) -> Image.Image:
    try:
        return Image.open(io.BytesIO(png_bytes))
    except Exception as e:
        raise MediaError(f"Não foi possível ler a imagem enviada: {e}")


def _flatten_to_rgb(img: Image.Image) -> Image.Image:
    """Achata transparência sobre fundo branco (em vez de deixar o PIL descartar
    o canal alfa cru, o que pode enegrecer área transparente ao converter PDF/JPEG)."""
    rgba = img.convert("RGBA")
    background = Image.new("RGB", rgba.size, (255, 255, 255))
    background.paste(rgba, mask=rgba.split()[3])  # canal alfa como máscara
    return background


def png_to_jpeg(png_bytes: bytes, quality: int = 92) -> bytes:
    """Converte um PNG (com transparência ou não) para JPEG com fundo branco."""
    rgb = _flatten_to_rgb(_open_png(png_bytes))
    out = io.BytesIO()
    rgb.save(out, format="JPEG", quality=quality)
    return out.getvalue()


def assemble_pdf(png_images: list[bytes]) -> bytes:
    """Monta um PDF multi-página a partir de uma lista de PNGs, na ordem recebida."""
    if not png_images:
        raise MediaError("Nenhuma imagem recebida para montar o PDF.")

    frames = [_flatten_to_rgb(_open_png(png_bytes)) for png_bytes in png_images]

    out = io.BytesIO()
    frames[0].save(out, format="PDF", save_all=True, append_images=frames[1:])
    return out.getvalue()
