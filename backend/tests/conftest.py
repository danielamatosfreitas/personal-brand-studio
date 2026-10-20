"""
tests/conftest.py
Testes simulados: nenhuma chamada sai para o LinkedIn, o Instagram, o Supabase
ou o banco. As variáveis abaixo são valores de teste, não credenciais reais.
"""
import os
import sys

from cryptography.fernet import Fernet

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://teste:teste@127.0.0.1:1/teste")
os.environ.setdefault("FERNET_KEY", Fernet.generate_key().decode())
os.environ.setdefault("SECRET_KEY", "chave-de-sessao-so-para-teste")
os.environ.setdefault("APP_ACCESS_TOKEN", "senha-de-teste")
os.environ.setdefault("FRONTEND_URL", "https://frontend.teste")
os.environ.setdefault("LINKEDIN_CLIENT_ID", "cliente-teste")
os.environ.setdefault("LINKEDIN_REDIRECT_URI", "https://backend.teste/api/v1/oauth/linkedin/callback")
os.environ.setdefault("INSTAGRAM_APP_ID", "app-teste")
os.environ.setdefault("INSTAGRAM_REDIRECT_URI", "https://backend.teste/api/v1/oauth/instagram/callback")
os.environ.setdefault("FACEBOOK_APP_ID", "app-facebook-teste")
os.environ.setdefault("FACEBOOK_APP_SECRET", "segredo-facebook-de-teste")
os.environ.setdefault("FACEBOOK_PAGE_NAME", "Capital Humano Intelligence")
os.environ.setdefault("FACEBOOK_PAGE_ID", "100000000000001")
os.environ.setdefault("FACEBOOK_REDIRECT_URI", "https://backend.teste/api/v1/oauth/facebook/callback")
