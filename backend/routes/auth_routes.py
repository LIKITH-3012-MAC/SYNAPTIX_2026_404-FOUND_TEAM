"""
RESOLVIT - Auth Routes
POST /api/auth/register
POST /api/auth/login
POST /api/auth/oauth-login
GET  /api/auth/me
POST /api/auth/forgot-password
POST /api/auth/reset-password
"""
from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, EmailStr, Field
from models import UserRegister, UserLogin, OAuthLogin, TokenResponse, UserResponse, MessageResponse
from database import get_db
from auth import hash_password, verify_password, create_access_token, get_current_user, create_password_reset_token, verify_password_reset_token
from services.email_service import send_password_reset_email
from core.security import limiter
import uuid
import secrets
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
        email=user["email"],
        department=user.get("department")
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "role": user["role"],
        "user_id": str(user["id"]),
        "username": user["username"],
        "department": user.get("department")
    }


@router.post("/oauth-login", response_model=TokenResponse)
def oauth_login(payload: OAuthLogin):
    """
    Authenticate via OAuth provider (Google via Auth0).
    If the user exists, log them in.
    If not, auto-register as a citizen and log in.
    """
    with get_db() as cursor:
        cursor.execute(
            "SELECT id, username, email, role, is_active, department FROM users WHERE email = %s",
            (payload.email,)
        )
        user = cursor.fetchone()

    if user:
        # Existing user — log them in
        if not user["is_active"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is disabled. Contact administrator."
            )

        # Sync latest profile metadata
        with get_db() as cursor:
            cursor.execute(
                "UPDATE users SET profile_picture = %s, full_name = %s WHERE id = %s",
                (payload.picture, payload.name, user["id"])
            )

        token = create_access_token(
            user_id=str(user["id"]),
            role=user["role"],
            email=user["email"],
            department=user.get("department")
        )

        return {
            "access_token": token,
            "token_type": "bearer",
            "role": user["role"],
            "user_id": str(user["id"]),
            "username": user["username"],
            "department": user.get("department")
        }
    else:
        # New user — auto-register as citizen
        user_id = str(uuid.uuid4())
        username = payload.name.replace(" ", "_").lower()[:64]
        random_password = secrets.token_urlsafe(32)

        with get_db() as cursor:
            # Check if username already taken
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            if cursor.fetchone():
                username = f"{username}_{secrets.token_hex(3)}"

            cursor.execute(
                """
                INSERT INTO users (id, username, email, password_hash, role, full_name, auth_provider, profile_picture)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, username, email, role, department
                """,
                (
                    user_id,
                    username,
                    payload.email,
                    hash_password(random_password),
                    "citizen",
                    payload.name,
                    payload.provider,
                    payload.picture
                )
            )
            new_user = dict(cursor.fetchone())

        token = create_access_token(
            user_id=str(new_user["id"]),
            role=new_user["role"],
            email=new_user["email"]
        )

        return {
            "access_token": token,
            "token_type": "bearer",
            "role": new_user["role"],
            "user_id": str(new_user["id"]),
            "username": new_user["username"],
            "department": None
        }


@router.get("/me", response_model=UserResponse)
def get_me(current_user: dict = Depends(get_current_user)):
    """Return details of the currently authenticated user."""
    with get_db() as cursor:
        cursor.execute(
            """SELECT id, username, email, role, full_name, department, profile_picture, 
               points_cache, trust_score, rank, created_at, auth_provider 
               FROM users WHERE id = %s""",
            (current_user["sub"],)
        )
        user = cursor.fetchone()

    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    return {**dict(user), "id": str(user["id"])}


@router.get("/profile")
def get_unified_profile(current_user: dict = Depends(get_current_user)):
    """Unified endpoint for high-fidelity profile intelligence."""
    user_id = current_user["sub"]
    
    with get_db() as cursor:
        # 1. Basic Info
        cursor.execute(
            """SELECT id, username, email, role, full_name, department, profile_picture, 
               points_cache, trust_score, rank, created_at FROM users WHERE id = %s""",
            (user_id,)
        )
        user = cursor.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Identity not found")
        
        # 2. Issues Stats
        cursor.execute("SELECT COUNT(*) as count FROM issues WHERE reporter_id = %s", (user_id,))
        reported_count = cursor.fetchone()["count"]
        
        cursor.execute("SELECT COUNT(*) as count FROM issues WHERE reporter_id = %s AND status = 'resolved'", (user_id,))
        resolved_count = cursor.fetchone()["count"]
        
        # 3. Global Stats (Heuristic for production feel)
        user_points = user["points_cache"] or 0
        cursor.execute("SELECT COUNT(*) + 1 as global_rank FROM users WHERE points_cache > %s AND role = 'citizen'", (user_points,))
        global_rank = cursor.fetchone()["global_rank"]

    return {
        "user": {**dict(user), "id": str(user["id"])},
        "stats": {
            "total_points": user_points,
            "rank": global_rank,
            "issues_count": reported_count,
            "issues_resolved": resolved_count,
            "trust_score": user["trust_score"]
        },
        "badges": ["Citizen", user["rank"] or "Beginner"]
    }


@router.get("/issues")
def get_user_issues(current_user: dict = Depends(get_current_user)):
    """Fetch all issues reported by the authenticated user."""
    user_id = current_user["sub"]
    with get_db() as cursor:
        cursor.execute(
            """SELECT id, tracking_id, title, status, category, urgency, created_at 
               FROM issues WHERE reporter_id = %s ORDER BY created_at DESC""",
            (user_id,)
        )
        rows = cursor.fetchall()
    
    return [ {**dict(r), "id": str(r["id"])} for r in rows ]


@router.get("/activity")
def get_user_activity(current_user: dict = Depends(get_current_user)):
    """Fetch recent activity timeline for the user."""
    user_id = current_user["sub"]
    with get_db() as cursor:
        cursor.execute(
            """SELECT action, credits_delta, note, created_at 
               FROM citizen_activity WHERE user_id = %s ORDER BY created_at DESC LIMIT 20""",
            (user_id,)
        )
        rows = cursor.fetchall()
    
    return [ {**dict(r), "created_at": r["created_at"].isoformat()} for r in rows ]


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
