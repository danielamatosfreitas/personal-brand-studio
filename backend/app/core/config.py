from pydantic_settings import BaseSettings, SettingsConfigDict
from cryptography.fernet import Fernet


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str
    FERNET_KEY: str
    SECRET_KEY: str
    LINKEDIN_CLIENT_ID: str = ""
    LINKEDIN_CLIENT_SECRET: str = ""
    LINKEDIN_REDIRECT_URI: str = ""
    # w_organization_social -- publicar em Páginas de empresa que a usuária
    # administra. Exige reconexão (o consentimento já dado não cobre escopo
    # novo) e que o app LinkedIn tenha o produto "Community Management API"
    # habilitado -- diferente do "Share on LinkedIn" já usado pro perfil
    # pessoal, esse costuma exigir aprovação da LinkedIn.
    LINKEDIN_SCOPES: str = "openid profile email w_member_social w_organization_social"
    # Credenciais do produto "Instagram" no Meta for Developers (Instagram API
    # with Instagram Login) -- NÃO são as credenciais do Facebook Login for
    # Business. App ID/Secret ficam nas configurações desse produto específico.
    INSTAGRAM_APP_ID: str = ""
    INSTAGRAM_APP_SECRET: str = ""
    INSTAGRAM_REDIRECT_URI: str = ""
    INSTAGRAM_SCOPES: str = "instagram_business_basic,instagram_business_content_publish"
    # Versão da API do Instagram (graph.instagram.com) usada na publicação.
    INSTAGRAM_API_VERSION: str = "v23.0"
    # Facebook (Fase 4): login do Facebook (app da Meta: ID e chave secreta do
    # app, em Configurações > Básico), só para publicar na página da empresa.
    FACEBOOK_APP_ID: str = ""
    FACEBOOK_APP_SECRET: str = ""
    FACEBOOK_REDIRECT_URI: str = ""
    # Permissões mínimas para publicar foto em página (referência de
    # /{page-id}/photos): pages_show_list, pages_read_engagement, pages_manage_posts.
    FACEBOOK_SCOPES: str = "pages_show_list,pages_read_engagement,pages_manage_posts"
    FACEBOOK_API_VERSION: str = "v25.0"
    # Trava de página: o app só publica nesta página. A trava compara pelo ID
    # (19/10: o ID mostrado na tela da Meta para a Página da empresa); o nome
    # serve só para as mensagens. Com FACEBOOK_PAGE_ID vazio, volta a comparar
    # pelo nome.
    FACEBOOK_PAGE_NAME: str = ""
    FACEBOOK_PAGE_ID: str = ""
    APP_ENV: str = "development"
    # Registro de todas as consultas SQL no log (com os valores). Desligado por
    # padrão: em produção o log não pode carregar dado gravado, nem token
    # criptografado. Liga só para depurar, com SQL_ECHO=1 (19/10).
    SQL_ECHO: bool = False
    FRONTEND_URL: str = "http://localhost:3000"
    # Armazenamento de mídia em bucket compatível com S3 (decisão de 15/10:
    # Railway Storage Bucket; trocar para Cloudflare R2 ou outro S3 é só mudar
    # estas variáveis). Bucket privado: a URL entregue ao LinkedIn e ao
    # Instagram é assinada na hora de publicar (app/services/storage_service.py).
    S3_ENDPOINT: str = ""
    S3_BUCKET: str = ""
    S3_ACCESS_KEY_ID: str = ""
    S3_SECRET_ACCESS_KEY: str = ""
    S3_REGION: str = "auto"
    # "virtual" (bucket no subdomínio, padrão da Railway e aceito pelo R2) ou "path".
    S3_ADDRESSING_STYLE: str = "virtual"
    # Validade da URL assinada entregue às redes (6 horas).
    MEDIA_URL_TTL_SECONDS: int = 21600
    # Senha única que protege toda a API. Enquanto vazia, TODO acesso é negado
    # (falha fechado) -- é assim que evita a API ficar aberta entre o deploy
    # deste código e a hora que a variável é configurada no Railway.
    APP_ACCESS_TOKEN: str = ""
    # Chave própria do envio do espelho do Calendário (20/10): só a sessão
    # Calendário usa, para mandar o calendario-espelho.json. Vazia = o envio
    # fica fechado (falha fechado, como a senha do app).
    CALENDARIO_SYNC_TOKEN: str = ""
    CORS_EXTRA_ORIGINS: str = ""
    CORS_ORIGIN_REGEX: str = ""

    @property
    def fernet(self) -> Fernet:
        return Fernet(self.FERNET_KEY.encode())


settings = Settings()


def encrypt_token(token: str) -> str:
    return settings.fernet.encrypt(token.encode()).decode()


def decrypt_token(encrypted_token: str) -> str:
    return settings.fernet.decrypt(encrypted_token.encode()).decode()