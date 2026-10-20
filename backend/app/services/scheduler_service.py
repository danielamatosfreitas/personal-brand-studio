"""
app/services/scheduler_service.py
Agendamento de publicações.

Loop assíncrono rodando dentro do próprio processo da API (sem serviço
separado no Railway): a cada POLL_INTERVAL_SECONDS, verifica se há posts
com status "scheduled" cuja hora já chegou e publica sozinho, usando o
mesmo publish_post() que o endpoint manual /posts/{id}/publish usa.

Se o processo reiniciar entre uma verificação e outra, nenhum post agendado
se perde -- só atrasa até o próximo ciclo, porque a condição é sempre
"scheduled_at <= agora", não um evento único.
"""
import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.db.models import OAuthCredential, Post, PostStatusEnum, PlatformEnum
from app.services.oauth_service import renova_token_instagram, confere_token_facebook
from app.services.publishing_service import publish_post

logger = logging.getLogger("scheduler")

POLL_INTERVAL_SECONDS = 60  # 1 minuto -- era 5min; reduzido pra apertar a janela
# de atraso máximo entre o horário agendado e a publicação de fato.
# Conferência do token do Instagram (renova quando faltam menos de 15 dias).
RENOVACAO_INTERVALO_SECONDS = 6 * 3600


async def _renova_tokens_instagram() -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(OAuthCredential).where(OAuthCredential.platform == PlatformEnum.instagram))
        for cred in result.scalars().all():
            estado = await renova_token_instagram(db, cred)
            if estado != "nao_precisa":
                logger.info(f"[scheduler] token do Instagram: {estado}")


async def _confere_tokens_facebook() -> None:
    """Fase 4: o token da página não vence por data (não há renovação); aqui só
    se confere se ele continua valendo, para a tela pedir reconexão se não."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(OAuthCredential).where(OAuthCredential.platform == PlatformEnum.facebook))
        for cred in result.scalars().all():
            estado = await confere_token_facebook(db, cred)
            if estado != "valido":
                logger.warning(f"[scheduler] token da página do Facebook: {estado}")


async def _publish_due_posts() -> None:
    async with AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)
        result = await db.execute(
            select(Post).where(
                Post.status == PostStatusEnum.scheduled,
                Post.scheduled_at <= now,
            )
        )
        due_posts = result.scalars().all()

        for post in due_posts:
            try:
                await publish_post(db, post.id, post.user_id)
                logger.info(f"[scheduler] post {post.id} publicado no horário agendado.")
            except Exception as e:
                logger.error(f"[scheduler] falha ao publicar post agendado {post.id}: {e}")


async def scheduler_loop() -> None:
    """Roda para sempre em background — chamado uma vez no startup da API."""
    ultima_renovacao = 0.0
    while True:
        try:
            await _publish_due_posts()
        except Exception as e:
            # Um erro de conexão pontual (ex: banco reiniciando) não pode matar o loop
            logger.error(f"[scheduler] erro no ciclo de verificação: {e}")
        agora = asyncio.get_running_loop().time()
        if agora - ultima_renovacao >= RENOVACAO_INTERVALO_SECONDS:
            ultima_renovacao = agora
            try:
                await _renova_tokens_instagram()
            except Exception as e:
                logger.error(f"[scheduler] erro ao conferir o token do Instagram: {type(e).__name__}")
            try:
                await _confere_tokens_facebook()
            except Exception as e:
                logger.error(f"[scheduler] erro ao conferir o token do Facebook: {type(e).__name__}")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
