"""
RESOLVIT - Authentication Module
JWT token management + bcrypt password hashing
"""
import os
import bcrypt
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from fastapi import HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

# ── Config ───────────────────────────────────────────────────
SECRET_KEY   = os.getenv("SECRET_KEY", "resolvit-super-secret-key-change-in-production-2024")
ALGORITHM    = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = int(os.getenv("ACCESS_TOKEN_EXPIRE_HOURS", "24"))
PASSWORD_RESET_TOKEN_EXPIRE_MINUTES = int(os.getenv("PASSWORD_RESET_TOKEN_EXPIRE_MINUTES", "30"))
OTP_EXPIRE_MINUTES = int(os.getenv("OTP_EXPIRE_MINUTES", "5"))
SIGNUP_TOKEN_EXPIRE_MINUTES = 15
APP_BASE_URL = os.getenv("APP_BASE_URL", "https://resolvit-ai.online")

bearer_scheme = HTTPBearer()


# ── Password Utilities ────────────────────────────────────────
def hash_password(plain: str) -> str:
    """Hash a plaintext password using bcrypt."""
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plaintext password against a bcrypt hash."""
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ── Password Reset Token Utilities ───────────────────────────
def generate_reset_token() -> str:
    """Generate a secure random token for password reset."""
    import secrets
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Hash a token or OTP using SHA-256 for secure storage."""
    import hashlib
    return hashlib.sha256(token.encode()).hexdigest()


def generate_otp() -> str:
    """Generate a 6-digit numeric OTP."""
    import secrets
    return "".join([str(secrets.randbelow(10)) for _ in range(6)])


# ── JWT Utilities ─────────────────────────────────────────────
def create_access_token(user_id: str, role: str, email: str, department: Optional[str] = None) -> str:
    """Create a signed JWT access token."""
    payload = {
        "sub": user_id,
        "role": role,
        "email": email,
        "department": department,
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def create_signup_token(email: str) -> str:
    """Create a short-lived JWT token for completing signup after OTP verification."""
    payload = {
        "sub": email,
        "type": "signup_verification",
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(minutes=SIGNUP_TOKEN_EXPIRE_MINUTES)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT token. Returns payload dict."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── FastAPI Auth Dependency ───────────────────────────────────
def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> dict:
    """FastAPI dependency: extract and return the current user from JWT."""
    return decode_token(credentials.credentials)


def require_roles(*allowed_roles: str):
    """
    Returns a FastAPI dependency that enforces role-based access.
    Usage: Depends(require_roles('admin', 'authority'))
    """
    def role_checker(current_user: dict = Depends(get_current_user)) -> dict:
        user_role = str(current_user.get("role", "")).lower()
        allowed = [r.lower() for r in allowed_roles]
        if user_role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"⛔ Access denied (Role Required: {', '.join(allowed_roles)})"
            )
        return current_user
    return role_checker
