import base64
import os
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

# Use the same SECRET_KEY as Auth module
SECRET_KEY = os.getenv("SECRET_KEY", "resolvit-super-secret-key-change-in-production-2024")

def _get_fernet() -> Fernet:
    """
    Derives a Fernet-compatible key from the application's SECRET_KEY.
    Uses PBKDF2 for deterministic key derivation so saved tokens 
    can be decrypted later using the same SECRET_KEY.
    """
    salt = b'resolvit_static_salt_2026' # Hardcoded salt for deterministic key derivation
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(SECRET_KEY.encode()))
    return Fernet(key)

def encrypt_token(token: str) -> str:
    """Encrypts a string (e.g., access_token) for database storage."""
    if not token:
        return None
    try:
        f = _get_fernet()
        return f.encrypt(token.encode()).decode()
    except Exception as e:
        print(f"[CRYPTO-ERROR] Encryption failed: {e}")
        return None

def decrypt_token(encrypted_token: str) -> str:
    """Decrypts a database-stored token."""
    if not encrypted_token:
        return None
    try:
        f = _get_fernet()
        return f.decrypt(encrypted_token.encode()).decode()
    except Exception as e:
        print(f"[CRYPTO-ERROR] Decryption failed: {e}")
        return None
