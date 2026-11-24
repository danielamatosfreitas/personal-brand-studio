"""
app/services/linkedin_documents_service.py
Publicação de conteúdo rico (documento/carrossel em PDF, e imagem única) no
LinkedIn -- Fase 1 (documentos) + correção do bug de imagem sem mídia (posts
via "Publicar mídia pronta" saíam só com texto, porque só documento tinha
tratamento especial).

Usa a API REST versionada do LinkedIn (sucessora do /v2/ugcPosts para
conteúdo com mídia rica), no mesmo padrão de 3 passos pra cada tipo de mídia:
  1. initializeUpload -- registra o arquivo e recebe uma uploadUrl
  2. PUT dos bytes nessa uploadUrl
  3. cria o post no feed referenciando o arquivo já enviado

Usa o mesmo scope já concedido hoje (w_member_social), sem produto adicional
a configurar no app do LinkedIn -- confirmado por teste tanto pra documento
quanto pra imagem.
"""
import asyncio
import urllib.parse

import httpx

LINKEDIN_VERSION = "202608"  # confirmado ativo em 2026-09-11; o LinkedIn só mantém uma janela de
# ~12 meses e o mês corrente às vezes ainda não foi ativado -- se voltar a dar
# "NONEXISTENT_VERSION", teste um mês anterior via /posts/test-linkedin-document
LINKEDIN_DOCUMENTS_URL = "https://api.linkedin.com/rest/documents"
LINKEDIN_IMAGES_URL = "https://api.linkedin.com/rest/images"
LINKEDIN_VIDEOS_URL = "https://api.linkedin.com/rest/videos"
LINKEDIN_POSTS_URL = "https://api.linkedin.com/rest/posts"


class LinkedInDocumentError(Exception):
    """Erro em qualquer etapa da publicação de documento no LinkedIn."""
    pass


def _headers(access_token: str, version: str | None = None) -> dict:
    return {
        "Authorization": f"Bearer {access_token}",
        "LinkedIn-Version": version or LINKEDIN_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
    }


async def register_document_upload(
    access_token: str, owner_urn: str, version: str | None = None
) -> tuple[str, str]:
    """
    Passo 1: inicializa o upload de um documento no LinkedIn.
    Retorna (upload_url, document_urn). Não publica nada ainda.
    `version` permite sobrescrever LINKEDIN_VERSION (usado só em diagnóstico).
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{LINKEDIN_DOCUMENTS_URL}?action=initializeUpload",
            headers=_headers(access_token, version),
            json={"initializeUploadRequest": {"owner": owner_urn}},
        )

    if response.status_code != 200:
        raise LinkedInDocumentError(
            f"Falha ao inicializar upload de documento no LinkedIn "
            f"(status {response.status_code}): {response.text}"
        )

    value = response.json().get("value", {})
    upload_url = value.get("uploadUrl")
    document_urn = value.get("document")
    if not upload_url or not document_urn:
        raise LinkedInDocumentError(
            f"LinkedIn não retornou uploadUrl/document: {response.text}"
        )
    return upload_url, document_urn


async def upload_document_binary(upload_url: str, access_token: str, pdf_bytes: bytes) -> None:
    """Passo 2: envia os bytes do PDF para a uploadUrl. Ainda não publica nada."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.put(
            upload_url,
            content=pdf_bytes,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if response.status_code not in (200, 201):
        raise LinkedInDocumentError(
            f"Falha ao enviar o PDF para o LinkedIn (status {response.status_code}): {response.text}"
        )


async def create_document_post(
    access_token: str,
    owner_urn: str,
    commentary: str,
    document_urn: str,
    title: str,
) -> str:
    """
    Passo 3: cria o post no feed referenciando o documento já enviado.
    Este passo PUBLICA o post publicamente. Retorna o URN do post.
    """
    payload = {
        "author": owner_urn,
        "commentary": commentary,
        "visibility": "PUBLIC",
        "distribution": {
            "feedDistribution": "MAIN_FEED",
            "targetEntities": [],
            "thirdPartyDistributionChannels": [],
        },
        "content": {
            "media": {
                "title": title,
                "id": document_urn,
            }
        },
        "lifecycleState": "PUBLISHED",
        "isReshareDisabledByAuthor": False,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            LINKEDIN_POSTS_URL,
            headers=_headers(access_token),
            json=payload,
        )

    if response.status_code not in (200, 201):
        raise LinkedInDocumentError(
            f"Falha ao publicar o post com documento no LinkedIn "
            f"(status {response.status_code}): {response.text}"
        )

    return response.headers.get("x-restli-id", "")


async def publish_linkedin_document_post(
    access_token: str,
    owner_urn: str,
    commentary: str,
    pdf_bytes: bytes,
    title: str,
) -> str:
    """Orquestra os 3 passos e retorna o URN do post publicado."""
    upload_url, document_urn = await register_document_upload(access_token, owner_urn)
    await upload_document_binary(upload_url, access_token, pdf_bytes)
    return await create_document_post(access_token, owner_urn, commentary, document_urn, title)


# ── Imagem única ───────────────────────────────────────────────────────────────
# Mesmo padrão de 3 passos dos documentos, mas usando /rest/images e sem
# "title" no content.media (title é específico de documento, não de imagem).

async def register_image_upload(
    access_token: str, owner_urn: str, version: str | None = None
) -> tuple[str, str]:
    """Passo 1: inicializa o upload de uma imagem. Retorna (upload_url, image_urn)."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{LINKEDIN_IMAGES_URL}?action=initializeUpload",
            headers=_headers(access_token, version),
            json={"initializeUploadRequest": {"owner": owner_urn}},
        )

    if response.status_code != 200:
        raise LinkedInDocumentError(
            f"Falha ao inicializar upload de imagem no LinkedIn "
            f"(status {response.status_code}): {response.text}"
        )

    value = response.json().get("value", {})
    upload_url = value.get("uploadUrl")
    image_urn = value.get("image")
    if not upload_url or not image_urn:
        raise LinkedInDocumentError(
            f"LinkedIn não retornou uploadUrl/image: {response.text}"
        )
    return upload_url, image_urn


async def upload_image_binary(upload_url: str, access_token: str, image_bytes: bytes) -> None:
    """Passo 2: envia os bytes da imagem para a uploadUrl."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.put(
            upload_url,
            content=image_bytes,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if response.status_code not in (200, 201):
        raise LinkedInDocumentError(
            f"Falha ao enviar a imagem para o LinkedIn (status {response.status_code}): {response.text}"
        )


async def create_image_post(
    access_token: str,
    owner_urn: str,
    commentary: str,
    image_urn: str,
) -> str:
    """Passo 3: cria o post no feed referenciando a imagem já enviada."""
    payload = {
        "author": owner_urn,
        "commentary": commentary,
        "visibility": "PUBLIC",
        "distribution": {
            "feedDistribution": "MAIN_FEED",
            "targetEntities": [],
            "thirdPartyDistributionChannels": [],
        },
        "content": {
            "media": {"id": image_urn},
        },
        "lifecycleState": "PUBLISHED",
        "isReshareDisabledByAuthor": False,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            LINKEDIN_POSTS_URL,
            headers=_headers(access_token),
            json=payload,
        )

    if response.status_code not in (200, 201):
        raise LinkedInDocumentError(
            f"Falha ao publicar o post com imagem no LinkedIn "
            f"(status {response.status_code}): {response.text}"
        )

    return response.headers.get("x-restli-id", "")


async def publish_linkedin_image_post(
    access_token: str,
    owner_urn: str,
    commentary: str,
    image_bytes: bytes,
) -> str:
    """Orquestra os 3 passos e retorna o URN do post publicado."""
    upload_url, image_urn = await register_image_upload(access_token, owner_urn)
    await upload_image_binary(upload_url, access_token, image_bytes)
    return await create_image_post(access_token, owner_urn, commentary, image_urn)


# ── Galeria de imagens (multiImage) ─────────────────────────────────────────────
# Mesmo passo 1+2 da imagem única (register_image_upload/upload_image_binary já
# são por-imagem, então servem sem alteração), mas o passo 3 referencia várias
# imagens de uma vez em content.multiImage em vez de content.media.

LINKEDIN_MAX_GALLERY_IMAGES = 9  # limite do próprio LinkedIn pra post multiImage


async def create_multi_image_post(
    access_token: str,
    owner_urn: str,
    commentary: str,
    image_urns: list[str],
) -> str:
    """Passo 3 (galeria): cria o post no feed referenciando várias imagens já enviadas."""
    payload = {
        "author": owner_urn,
        "commentary": commentary,
        "visibility": "PUBLIC",
        "distribution": {
            "feedDistribution": "MAIN_FEED",
            "targetEntities": [],
            "thirdPartyDistributionChannels": [],
        },
        "content": {
            "multiImage": {
                "images": [{"id": urn} for urn in image_urns],
            }
        },
        "lifecycleState": "PUBLISHED",
        "isReshareDisabledByAuthor": False,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            LINKEDIN_POSTS_URL,
            headers=_headers(access_token),
            json=payload,
        )

    if response.status_code not in (200, 201):
        raise LinkedInDocumentError(
            f"Falha ao publicar a galeria de imagens no LinkedIn "
            f"(status {response.status_code}): {response.text}"
        )

    return response.headers.get("x-restli-id", "")


async def publish_linkedin_multi_image_post(
    access_token: str,
    owner_urn: str,
    commentary: str,
    images_bytes: list[bytes],
) -> str:
    """
    Orquestra a publicação de galeria: registra + envia cada imagem (reaproveita
    register_image_upload/upload_image_binary, que já operam uma imagem por vez),
    depois cria um único post referenciando todas.
    """
    if len(images_bytes) > LINKEDIN_MAX_GALLERY_IMAGES:
        raise LinkedInDocumentError(
            f"O LinkedIn aceita no máximo {LINKEDIN_MAX_GALLERY_IMAGES} imagens por post."
        )

    image_urns: list[str] = []
    for img_bytes in images_bytes:
        upload_url, image_urn = await register_image_upload(access_token, owner_urn)
        await upload_image_binary(upload_url, access_token, img_bytes)
        image_urns.append(image_urn)

    return await create_multi_image_post(access_token, owner_urn, commentary, image_urns)


# ── Vídeo ────────────────────────────────────────────────────────────────────
# Diferente de imagem/documento (1 PUT só), o vídeo do LinkedIn é um upload em
# partes: initializeUpload devolve uma ou mais uploadUrl (cada uma com um
# intervalo de bytes), cada PUT devolve um ETag que precisa ser coletado, e
# finalizeUpload fecha o upload com a lista de ETags em ordem. Só depois disso
# o vídeo é processado pelo LinkedIn (assíncrono) -- por isso espera o status
# virar AVAILABLE antes de criar o post; postar cedo demais costuma falhar.

async def register_video_upload(
    access_token: str,
    owner_urn: str,
    file_size_bytes: int,
    version: str | None = None,
) -> tuple[list[dict], str, str]:
    """
    Passo 1: inicializa o upload de um vídeo no LinkedIn.
    Retorna (upload_instructions, video_urn, upload_token). Cada item de
    upload_instructions tem uploadUrl/firstByte/lastByte -- normalmente um
    só pra vídeos menores, pode vir mais de um pra arquivos grandes.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{LINKEDIN_VIDEOS_URL}?action=initializeUpload",
            headers=_headers(access_token, version),
            json={
                "initializeUploadRequest": {
                    "owner": owner_urn,
                    "fileSizeBytes": file_size_bytes,
                    "uploadCaptions": False,
                    "uploadThumbnail": False,
                }
            },
        )

    if response.status_code != 200:
        raise LinkedInDocumentError(
            f"Falha ao inicializar upload de vídeo no LinkedIn "
            f"(status {response.status_code}): {response.text}"
        )

    value = response.json().get("value", {})
    upload_instructions = value.get("uploadInstructions")
    video_urn = value.get("video")
    upload_token = value.get("uploadToken", "")
    if not upload_instructions or not video_urn:
        raise LinkedInDocumentError(
            f"LinkedIn não retornou uploadInstructions/video: {response.text}"
        )
    return upload_instructions, video_urn, upload_token


async def upload_video_parts(
    upload_instructions: list[dict], access_token: str, video_bytes: bytes
) -> list[str]:
    """Passo 2: envia cada parte do vídeo pra sua uploadUrl e coleta os ETags, em ordem."""
    etags: list[str] = []
    async with httpx.AsyncClient(timeout=120.0) as client:
        for instruction in upload_instructions:
            first_byte = instruction["firstByte"]
            last_byte = instruction["lastByte"]
            chunk = video_bytes[first_byte:last_byte + 1]
            response = await client.put(
                instruction["uploadUrl"],
                content=chunk,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if response.status_code not in (200, 201):
                raise LinkedInDocumentError(
                    f"Falha ao enviar uma parte do vídeo para o LinkedIn "
                    f"(status {response.status_code}): {response.text}"
                )
            etag = response.headers.get("ETag") or response.headers.get("etag")
            if not etag:
                raise LinkedInDocumentError(
                    "O LinkedIn não retornou ETag para uma das partes do vídeo."
                )
            etags.append(etag)
    return etags


async def finalize_video_upload(
    access_token: str,
    video_urn: str,
    upload_token: str,
    etags: list[str],
    version: str | None = None,
) -> None:
    """Passo 3: fecha o upload do vídeo, confirmando todas as partes enviadas."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{LINKEDIN_VIDEOS_URL}?action=finalizeUpload",
            headers=_headers(access_token, version),
            json={
                "finalizeUploadRequest": {
                    "video": video_urn,
                    "uploadToken": upload_token,
                    "uploadedPartIds": etags,
                }
            },
        )
    if response.status_code not in (200, 201, 204):
        raise LinkedInDocumentError(
            f"Falha ao finalizar upload de vídeo no LinkedIn "
            f"(status {response.status_code}): {response.text}"
        )


async def wait_for_video_ready(
    access_token: str,
    video_urn: str,
    version: str | None = None,
    timeout_seconds: int = 60,
) -> None:
    """
    Espera o vídeo terminar de processar no LinkedIn (status AVAILABLE) antes
    de criar o post -- postar antes disso costuma falhar. Faz polling a cada
    3s até o limite de timeout_seconds.
    """
    video_id = urllib.parse.quote(video_urn, safe="")
    elapsed = 0
    interval = 3
    async with httpx.AsyncClient(timeout=15.0) as client:
        while elapsed < timeout_seconds:
            response = await client.get(
                f"{LINKEDIN_VIDEOS_URL}/{video_id}",
                headers=_headers(access_token, version),
            )
            if response.status_code == 200:
                status = response.json().get("status")
                if status == "AVAILABLE":
                    return
                if status == "FAILED":
                    raise LinkedInDocumentError("O LinkedIn falhou ao processar o vídeo enviado.")
            await asyncio.sleep(interval)
            elapsed += interval
    raise LinkedInDocumentError(
        "O vídeo ainda não terminou de processar no LinkedIn (esgotou o tempo de espera)."
    )


async def create_video_post(
    access_token: str,
    owner_urn: str,
    commentary: str,
    video_urn: str,
) -> str:
    """Passo 4: cria o post no feed referenciando o vídeo já enviado e processado."""
    payload = {
        "author": owner_urn,
        "commentary": commentary,
        "visibility": "PUBLIC",
        "distribution": {
            "feedDistribution": "MAIN_FEED",
            "targetEntities": [],
            "thirdPartyDistributionChannels": [],
        },
        "content": {
            "media": {"id": video_urn},
        },
        "lifecycleState": "PUBLISHED",
        "isReshareDisabledByAuthor": False,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            LINKEDIN_POSTS_URL,
            headers=_headers(access_token),
            json=payload,
        )

    if response.status_code not in (200, 201):
        raise LinkedInDocumentError(
            f"Falha ao publicar o post com vídeo no LinkedIn "
            f"(status {response.status_code}): {response.text}"
        )

    return response.headers.get("x-restli-id", "")


async def publish_linkedin_video_post(
    access_token: str,
    owner_urn: str,
    commentary: str,
    video_bytes: bytes,
) -> str:
    """Orquestra os 4 passos (inicializar, enviar partes, finalizar, esperar
    processar) e retorna o URN do post publicado."""
    upload_instructions, video_urn, upload_token = await register_video_upload(
        access_token, owner_urn, len(video_bytes)
    )
    etags = await upload_video_parts(upload_instructions, access_token, video_bytes)
    await finalize_video_upload(access_token, video_urn, upload_token, etags)
    await wait_for_video_ready(access_token, video_urn)
    return await create_video_post(access_token, owner_urn, commentary, video_urn)
