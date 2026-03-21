"""
RESOLVIT - Production Auth Routes V3
Strict diagnostic routes, [OTP-TRACE] logging, and Render-aware connectivity.
"""
from fastapi import APIRouter, HTTPException, status, Depends, Request
from pydantic import BaseModel, EmailStr, Field
from models import UserRegister, UserLogin, OAuthLogin, TokenResponse, UserResponse, MessageResponse
from database import get_db
from auth import (
    hash_password, verify_password, create_access_token, get_current_user, 
    generate_reset_token, hash_token, generate_otp, create_signup_token
)
from core.config import settings
from services.email_service import (
    send_verification_otp_email, send_email, is_placeholder,
    RESEND_API_KEY, RESEND_FROM_EMAIL, OTP_EXPIRE_MINUTES
)
from datetime import datetime, timedelta
from core.security import limiter
import os

router = APIRouter()

# ── Models ─────────────────────────────────────────────────────
class SendOTPRequest(BaseModel):
    email: EmailStr

class VerifyOTPRequest(BaseModel):
    email: EmailStr
    otp:   str = Field(..., min_length=6, max_length=6)

# ── Diagnostics (Strict User Requirements) ────────────────────

@router.get("/health")
def health_check():
    """GET /api/auth/health - Check service and email eligibility."""
    return {
        "success": True, 
        "service": "backend", 
        "env": os.getenv("ENV", "production"),
        "email_enabled": os.getenv("EMAIL_ENABLED", "true").lower() == "true"
    }


@router.get("/email-config-check")
def email_config_check():
    """GET /api/auth/email-config-check - Verify Resend state without leaks."""
    return {
        "has_resend_api_key": not is_placeholder(RESEND_API_KEY),
        "has_from_email": bool(RESEND_FROM_EMAIL),
        "from_email": RESEND_FROM_EMAIL,
        "is_placeholder_detected": is_placeholder(RESEND_API_KEY)
    }


@router.post("/test-email")
def test_email_delivery(body: dict):
    """POST /api/auth/test-email - Trigger an immediate real test email."""
    email = body.get("email", "").strip().lower()
    if not email:
        return {"success": False, "message": "Target email is required."}

    print(f"[EMAIL-TRACE] Manual test-email request received for: {email}")
    test_html = f"<h1>RESOLVIT Production Test</h1><p>Test executed at {datetime.now().isoformat()}</p>"
    
    success = send_email(email, "RESOLVIT Production Test", test_html)
    
    if success:
        return {"success": True, "message": "Test email sent successfully."}
    else:
        return {
            "success": False, 
            "message": "Test email failed.",
            "error": "Resend API rejected the request. Check Render logs for [EMAIL-FAILURE]."
        }

# ── Signup OTP Flow ───────────────────────────────────────────

@router.post("/send-signup-otp", response_model=MessageResponse)
@limiter.limit("5/hour")
def send_signup_otp(request: Request, body: dict):
    """
    POST /api/auth/send-signup-otp
    Step 1: Generate OTP, Hash, Store, and Call Resend.
    """
    email = body.get("email", "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
        
    print(f"[EMAIL-TRACE] send-signup-otp called")
    
    with get_db() as cursor:
        # Check collision
        cursor.execute("SELECT id FROM users WHERE email = %s", (email,))
        if cursor.fetchone():
            print(f"[OTP-TRACE] Collision: Email {email} already exists.")
            raise HTTPException(status_code=400, detail="An account with this email already exists.")

        # Prepare OTP
        otp = generate_otp()
        otp_hash = hash_token(otp)
        expires_at = datetime.utcnow() + timedelta(minutes=OTP_EXPIRE_MINUTES)
        
        print(f"[EMAIL-TRACE] otp generated: {otp}")
        print(f"[EMAIL-TRACE] email target: {email}")
        print(f"[EMAIL-TRACE] resend key present: {not is_placeholder(RESEND_API_KEY)}")

        # Invalidate old unused codes
        cursor.execute(
            "UPDATE email_verification_otps SET invalidated_at = NOW(), invalidated_reason = 'new_request' "
            "WHERE email = %s AND verified = FALSE AND invalidated_at IS NULL",
            (email,)
        )

        # Record new attempt
        cursor.execute(
            """
            INSERT INTO email_verification_otps (email, otp_hash, expires_at, purpose, requested_ip, user_agent)
            VALUES (%s, %s, %s, 'signup', %s, %s)
            """,
            (email, otp_hash, expires_at, request.client.host, request.headers.get("user-agent"))
        )
        
        print(f"[EMAIL-TRACE] sending email")
        success = send_verification_otp_email(email, otp)
        
        if not success:
            print(f"[EMAIL-FAILURE] resend error for {email}.")
            return {
                "success": False,
                "message": "Unable to deliver verification code. Please check your email address."
            }

    return {
        "success": True,
        "message": "Verification code sent successfully."
    }


@router.post("/verify-signup-otp")
def verify_signup_otp(payload: VerifyOTPRequest):
    """POST /api/auth/verify-signup-otp - Step 2: Validate OTP."""
    email = payload.email.strip().lower()
    otp_input = payload.otp
    
    print(f"[OTP-TRACE] verify-signup-otp called for: {email}")
    
    with get_db() as cursor:
        cursor.execute(
            "SELECT id, otp_hash, expires_at, attempt_count, max_attempts FROM email_verification_otps "
            "WHERE email = %s AND verified = FALSE AND invalidated_at IS NULL ORDER BY created_at DESC LIMIT 1",
            (email,)
        )
        row = cursor.fetchone()
        
        if not row:
            return {"success": False, "message": "No active verification request found."}
        
        # Increment attempt counter
        cursor.execute(
            "UPDATE email_verification_otps SET attempt_count = attempt_count + 1 WHERE id = %s",
            (row["id"],)
        )
        
        if row["attempt_count"] + 1 > row["max_attempts"]:
            cursor.execute(
                "UPDATE email_verification_otps SET invalidated_at = NOW(), invalidated_reason = 'too_many_attempts' WHERE id = %s",
                (row["id"],)
            )
            return {"success": False, "message": "Too many failed attempts. Please request a new code."}
        
        if row["expires_at"] < datetime.utcnow():
            return {"success": False, "message": "Verification code has expired."}

        # Verify SHA256 Hash
        current_hash = hash_token(otp_input)
        if current_hash != row["otp_hash"]:
            return {"success": False, "message": "Invalid verification code."}

        # Success!
        cursor.execute(
            "UPDATE email_verification_otps SET verified = TRUE, verified_at = NOW() WHERE id = %s",
            (row["id"],)
        )
        
        signup_token = create_signup_token(email)
        return {"success": True, "signup_token": signup_token, "message": "Email verified successfully."}


@router.post("/complete-signup", status_code=201)
def complete_signup(payload: dict):
    """POST /api/auth/complete-signup - Final step: Create the actual user record."""
    print(f"[SIGNUP-TRACE] complete-signup called")
    
    signup_token = payload.get("signup_token")
    full_name = payload.get("full_name")
    username = payload.get("username")
    password = payload.get("password")
    
    if not signup_token:
        raise HTTPException(status_code=400, detail="Signup token is missing")

    from auth import decode_token
    try:
        token_data = decode_token(signup_token)
        email = token_data.get("sub")
        if not email:
            raise HTTPException(status_code=400, detail="Invalid token payload")
    except Exception as e:
        print(f"[SIGNUP-TRACE] Token validation failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid or expired signup token")

    with get_db() as cursor:
        cursor.execute("SELECT id FROM users WHERE email = %s", (email,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="User already registered")

        pwd_hash = hash_password(password)
        cursor.execute(
            "INSERT INTO users (full_name, username, email, password_hash, role) VALUES (%s, %s, %s, %s, 'citizen') RETURNING id",
            (full_name, username, email, pwd_hash)
        )
        user_id = cursor.fetchone()["id"]
        
    return {
        "id": str(user_id),
        "full_name": full_name,
        "username": username,
        "email": email,
        "role": "citizen",
        "created_at": datetime.now().isoformat()
    }
