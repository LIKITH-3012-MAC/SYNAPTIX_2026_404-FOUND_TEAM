"""
RESOLVIT - Auth Routes
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/forgot-password
POST /api/auth/reset-password
"""
from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, EmailStr, Field
from models import UserRegister, UserLogin, TokenResponse, UserResponse, MessageResponse
from database import get_db
from auth import hash_password, verify_password, create_access_token, get_current_user, create_password_reset_token, verify_password_reset_token
from services.email_service import send_password_reset_email
from core.security import limiter
import uuid
from fastapi import Request

router = APIRouter()


@router.post("/register", response_model=UserResponse, status_code=201)
def register(payload: UserRegister):
    """Register a new citizen, authority, or admin account."""
    with get_db() as cursor:
        # Check for duplicates
        cursor.execute(
            "SELECT id FROM users WHERE email = %s OR username = %s",
            (payload.email, payload.username)
        )
        if cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A user with this email or username already exists."
            )

        user_id = str(uuid.uuid4())
        cursor.execute(
            """
            INSERT INTO users (id, username, email, password_hash, role, full_name, department)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id, username, email, role, full_name, department, created_at
            """,
            (
                user_id,
                payload.username,
                payload.email,
                hash_password(payload.password),
                payload.role.value,
                payload.full_name,
                payload.department
            )
        )
        user = dict(cursor.fetchone())

    # Initialize authority metrics row
    if payload.role.value == "authority":
        with get_db() as cursor:
            cursor.execute(
                "INSERT INTO authority_metrics (authority_id) VALUES (%s) ON CONFLICT DO NOTHING",
                (user_id,)
            )

    return {**user, "id": str(user["id"])}


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def login(payload: UserLogin, request: Request):
    """Authenticate and return a JWT token."""
    with get_db() as cursor:
        cursor.execute(
            "SELECT id, username, email, password_hash, role, is_active FROM users WHERE email = %s",
            (payload.email,)
        )
        user = cursor.fetchone()

    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password."
        )

    if not user["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled. Contact administrator."
        )

    token = create_access_token(
        user_id=str(user["id"]),
        role=user["role"],
        email=user["email"]
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "role": user["role"],
        "user_id": str(user["id"]),
        "username": user["username"]
    }


@router.get("/me", response_model=UserResponse)
def get_me(current_user: dict = Depends(get_current_user)):
    """Return details of the currently authenticated user."""
    with get_db() as cursor:
        cursor.execute(
            "SELECT id, username, email, role, full_name, department, created_at FROM users WHERE id = %s",
            (current_user["sub"],)
        )
        user = cursor.fetchone()

    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    return {**dict(user), "id": str(user["id"])}


# ── PASSWORD RESET ROUTES ─────────────────────────────────────
class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(..., min_length=8, max_length=128)


@router.post("/forgot-password", response_model=MessageResponse)
def forgot_password(payload: ForgotPasswordRequest):
    """
    Request a password reset. If the email exists, send a reset link.
    This endpoint always returns success to prevent email enumeration.
    """
    with get_db() as cursor:
        cursor.execute(
            "SELECT id, username, email FROM users WHERE email = %s",
            (payload.email,)
        )
        user = cursor.fetchone()

    # Always return success to prevent email enumeration
    # If the email exists, send the reset link
    if user:
        reset_token = create_password_reset_token(payload.email)
        username = user["username"]
        
        # Try to send the email (will work if SMTP is configured)
        send_password_reset_email(payload.email, reset_token, username)
    
    return {
        "message": "If an account with that email exists, a password reset link has been sent."
    }


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(payload: ResetPasswordRequest):
    """
    Reset the password using the token sent to the user's email.
    """
    # Verify the token
    email = verify_password_reset_token(payload.token)
    
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired password reset token."
        )

    # Find the user by email
    with get_db() as cursor:
        cursor.execute(
            "SELECT id, username, email FROM users WHERE email = %s",
            (email,)
        )
        user = cursor.fetchone()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )

    # Update the password with the new hashed password
    new_hash = hash_password(payload.new_password)
    
    with get_db() as cursor:
        cursor.execute(
            "UPDATE users SET password_hash = %s, updated_at = NOW() WHERE id = %s",
            (new_hash, user["id"])
        )

    return {"message": "Password has been reset successfully. You can now login with your new password."}
