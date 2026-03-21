"""
RESOLVIT - Robust Database-Driven Auth Flow
Implements Step 1 (Send OTP), Step 2 (Verify OTP), and Step 3 (Complete Signup).
"""
from fastapi import APIRouter, HTTPException, status, Depends, Request
from pydantic import BaseModel, EmailStr, Field
from datetime import datetime, timedelta, timezone
import os

from database import get_db
from auth import (
    hash_password, verify_password, create_access_token, get_current_user, 
    generate_reset_token, hash_token, generate_otp, create_signup_token,
    decode_token
)
from services.email_service import (
    send_verification_otp_email, send_email, is_placeholder,
    RESEND_API_KEY, RESEND_FROM_EMAIL, OTP_EXPIRE_MINUTES
)
from core.security import limiter
from models import MessageResponse, UserLogin

router = APIRouter()

# ── Models ─────────────────────────────────────────────────────
class SendOTPRequest(BaseModel):
    email: EmailStr

class VerifyOTPRequest(BaseModel):
    email: EmailStr
    otp:   str = Field(..., min_length=6, max_length=6)

class CompleteSignupRequest(BaseModel):
    signup_token: str
    full_name:    str
    username:     str
    password:     str

# ── Diagnostics (Production Verification) ──────────────────────

@router.get("/health")
def health_check():
    """GET /api/auth/health - Check service and email status."""
    return {
        "success": True, 
        "service": "auth", 
        "resend_enabled": not is_placeholder(RESEND_API_KEY),
        "from_email": RESEND_FROM_EMAIL
    }

@router.get("/email-config-check")
def email_config_check():
    """GET /api/auth/email-config-check - Detailed Resend status."""
    return {
        "resend_api_key_set": not is_placeholder(RESEND_API_KEY),
        "from_email": RESEND_FROM_EMAIL,
        "is_production": os.getenv("RENDER") == "true"
    }

@router.post("/test-email")
def test_email_delivery(body: dict):
    """POST /api/auth/test-email - Trigger real test email."""
    email = body.get("email", "").strip().lower()
    if not email:
        return {"success": False, "message": "Email is required."}

    print(f"[EMAIL-TRACE] Manual test-email for: {email}")
    success = send_email(email, "RESOLVIT Production Test", "<h1>Test Success</h1><p>Resend is working.</p>")
    return {"success": success, "message": "Check Render logs for [EMAIL-FAILURE] if success=false."}

# ── Step 1: Send OTP ───────────────────────────────────────────
@router.post("/send-signup-otp", response_model=MessageResponse)
@limiter.limit("5/hour")
def send_signup_otp(request: Request, body: SendOTPRequest):
    """
    POST /api/auth/send-signup-otp
    1. Normalize Email
    2. Invalidate Old OTPs
    3. Generate & Store New Hash
    4. Send Branded Email
    """
    email = body.email.strip().lower()
    print(f"[EMAIL-TRACE] send-signup-otp called for: {email}")
    
    with get_db() as cursor:
        # Check collision first
        cursor.execute("SELECT id FROM users WHERE email = %s", (email,))
        if cursor.fetchone():
            print(f"[EMAIL-TRACE] Collision: Email {email} already exists.")
            raise HTTPException(status_code=400, detail="An account with this email already exists.")

        # Invalidate old active OTPs for this email
        cursor.execute(
            "UPDATE email_verification_otps SET invalidated_at = NOW(), invalidated_reason = 'new_request' "
            "WHERE email = %s AND verified = FALSE AND invalidated_at IS NULL",
            (email,)
        )

        # Generate OTP & Hash
        otp = generate_otp()
        otp_hash = hash_token(otp)
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRE_MINUTES)

        # Insert new record
        cursor.execute(
            """
            INSERT INTO email_verification_otps (email, otp_hash, expires_at, purpose, requested_ip, user_agent)
            VALUES (%s, %s, %s, 'signup', %s, %s) RETURNING id
            """,
            (email, otp_hash, expires_at, request.client.host, request.headers.get("user-agent"))
        )
        otp_record_id = cursor.fetchone()['id']
        print(f"[EMAIL-TRACE] otp generated and row {otp_record_id} inserted")

        # Send Email
        print(f"[EMAIL-TRACE] resend send started")
        success = send_verification_otp_email(email, otp)
        
        if not success:
            print(f"[EMAIL-FAILURE] resend failure for {email}")
            return {
                "success": False,
                "message": "Email delivery failed. Please check your email address."
            }
        
        print(f"[EMAIL-TRACE] resend success")
        return {
            "success": True,
            "message": "Verification code sent successfully to your email."
        }

# ── Step 2: Verify OTP ─────────────────────────────────────────
@router.post("/verify-signup-otp")
def verify_signup_otp(payload: VerifyOTPRequest):
    """
    POST /api/auth/verify-signup-otp
    1. Normalize Email
    2. Fetch Latest Active OTP
    3. Hash & Compare
    4. Guard Attempts/Expiry
    5. Return Signup Token
    """
    email = payload.email.strip().lower()
    otp_input = payload.otp.strip()
    
    print(f"[OTP-TRACE] verify-signup-otp called for: {email}")
    
    with get_db() as cursor:
        # Fetch latest active record
        cursor.execute(
            "SELECT id, otp_hash, expires_at, attempt_count, max_attempts, verified, invalidated_at FROM email_verification_otps "
            "WHERE email = %s AND verified = FALSE AND invalidated_at IS NULL ORDER BY created_at DESC LIMIT 1",
            (email,)
        )
        row = cursor.fetchone()
        
        if not row:
            print(f"[OTP-TRACE] latest active record found: false")
            return {"success": False, "message": "No active verification code found."}
        
        otp_id = row['id']
        print(f"[OTP-TRACE] latest active record found: true (ID: {otp_id})")
        print(f"[OTP-TRACE] expires_at: {row['expires_at']}")
        print(f"[OTP-TRACE] attempt_count: {row['attempt_count']}")

        # Guard: Expiry
        if row["expires_at"] < datetime.now(timezone.utc):
            print(f"[OTP-TRACE] record id {otp_id} is expired")
            cursor.execute("UPDATE email_verification_otps SET invalidated_at = NOW(), invalidated_reason = 'expired' WHERE id = %s", (otp_id,))
            return {"success": False, "message": "Verification code has expired."}

        # Guard: Attempt Limit
        if row["attempt_count"] >= row["max_attempts"]:
            print(f"[OTP-TRACE] record id {otp_id} exceeded max attempts")
            cursor.execute("UPDATE email_verification_otps SET invalidated_at = NOW(), invalidated_reason = 'too_many_attempts' WHERE id = %s", (otp_id,))
            return {"success": False, "message": "Too many failed attempts. Please request a new code."}

        # Guard: Hash Comparison
        input_hash = hash_token(otp_input)
        if input_hash != row["otp_hash"]:
            print(f"[OTP-TRACE] hash comparison failure for id {otp_id}")
            cursor.execute("UPDATE email_verification_otps SET attempt_count = attempt_count + 1 WHERE id = %s", (otp_id,))
            return {"success": False, "message": "Invalid verification code."}

        # Success!
        print(f"[OTP-TRACE] hash comparison success for id {otp_id}")
        print(f"[OTP-TRACE] otp marked verified")
        cursor.execute(
            "UPDATE email_verification_otps SET verified = TRUE, verified_at = NOW() WHERE id = %s",
            (otp_id,)
        )
        
        signup_token = create_signup_token(email)
        return {
            "success": True, 
            "message": "OTP verified successfully.",
            "signup_token": signup_token
        }

# ── Step 3: Complete Signup ────────────────────────────────────
@router.post("/complete-signup", status_code=201)
def complete_signup(payload: CompleteSignupRequest):
    """
    POST /api/auth/complete-signup
    1. Validate Signup Token
    2. Confirm OTP Verification State
    3. Create Actual User
    """
    print(f"[SIGNUP-TRACE] complete-signup called")
    
    try:
        token_data = decode_token(payload.signup_token)
        email = token_data.get("sub")
        if not email:
            raise HTTPException(status_code=400, detail="Invalid token payload")
    except Exception as e:
        print(f"[SIGNUP-TRACE] Token validation failure: {e}")
        raise HTTPException(status_code=401, detail="Invalid or expired signup session")

    with get_db() as cursor:
        # Final Safety Check: Ensure this email was actually verified in the last 15 mins
        cursor.execute(
            "SELECT id FROM email_verification_otps WHERE email = %s AND verified = TRUE AND verified_at > NOW() - INTERVAL '15 minutes' LIMIT 1",
            (email,)
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=403, detail="Email verification session expired or not found.")

        # Check collision again (just in case)
        cursor.execute("SELECT id FROM users WHERE email = %s", (email,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="Account already created.")

        pwd_hash = hash_password(payload.password)
        cursor.execute(
            "INSERT INTO users (full_name, username, email, password_hash, role) VALUES (%s, %s, %s, %s, 'citizen') RETURNING id",
            (payload.full_name, payload.username, email, pwd_hash)
        )
        user_id = cursor.fetchone()["id"]
        print(f"[SIGNUP-TRACE] account created for {email}")
        
    return {
        "success": True,
        "message": "Account created successfully.",
        "user_id": str(user_id)
    }

# ── Standard Auth ──────────────────────────────────────────────

@router.post("/login", response_model=dict)
@limiter.limit("10/minute")
def login(request: Request, payload: UserLogin):
    """
    POST /api/auth/login
    Standard database-driven login using bcrypt and JWT.
    (Used alongside Auth0 for hybrid local/cloud auth).
    """
    email = payload.email.strip().lower()
    print(f"[AUTH-TRACE] Login attempt for: {email}")

    with get_db() as cursor:
        cursor.execute(
            """
            SELECT id, email, password_hash, role, username, department, is_suspended, auth_provider
            FROM users WHERE email = %s
            """,
            (email,)
        )
        user = cursor.fetchone()

    if not user:
        print(f"[AUTH-TRACE] User {email} not found.")
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if user["is_suspended"]:
        print(f"[AUTH-TRACE] User {email} is suspended.")
        raise HTTPException(status_code=403, detail="Your account has been suspended.")

    if user["auth_provider"] != "database":
        print(f"[AUTH-TRACE] User {email} uses {user['auth_provider']} (not database).")
        raise HTTPException(
            status_code=400, 
            detail=f"Please sign in using your {user['auth_provider']} account."
        )

    if not verify_password(payload.password, user["password_hash"]):
        print(f"[AUTH-TRACE] Password mismatch for {email}.")
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    # Success!
    print(f"[AUTH-TRACE] Login success for {email} (ID: {user['id']})")
    access_token = create_access_token(
        user_id=str(user["id"]),
        role=user["role"],
        email=user["email"],
        department=user["department"]
    )

    return {
        "success": True,
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": str(user["id"]),
            "username": user["username"],
            "email": user["email"],
            "role": user["role"],
            "department": user["department"]
        }
    }
