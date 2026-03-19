from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    RENDER: str | None = None
    
    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:3000",
        "http://localhost:8001",
        "http://127.0.0.1:8001",
        "https://resolvit-app-2026.vercel.app",
    ]

    # Email Domain Allowlist for Manual Registration
    ALLOWED_EMAIL_DOMAINS: List[str] = [
        # Global personal providers
        "gmail.com",
        "yahoo.com",
        "yahoo.co.in",
        "outlook.com",
        "hotmail.com",
        "live.com",
        "msn.com",
        "icloud.com",
        "me.com",
        "mac.com",
        "aol.com",
        "proton.me",
        "protonmail.com",
        "pm.me",
        "zoho.com",
        "mail.com",
        "gmx.com",
        "gmx.net",
        "yandex.com",
        "yandex.ru",
        # Yahoo regional variants
        "yahoo.in",
        "yahoo.co.uk",
        "yahoo.ca",
        "yahoo.com.au",
    ]

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()
