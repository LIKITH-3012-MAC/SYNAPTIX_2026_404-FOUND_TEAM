from fastapi import APIRouter, HTTPException, status, Depends, Request, Query
from pydantic import BaseModel, EmailStr, Field
from datetime import datetime, timedelta, timezone
import os

from database import get_db
from models import MessageResponse, UserLogin, OAuthLogin, UserResponse
from auth import (
    hash_password, verify_password, create_access_token, get_current_user, 
    generate_reset_token, hash_token, generate_otp, create_signup_token,
    decode_token, PASSWORD_RESET_TOKEN_EXPIRE_MINUTES, APP_BASE_URL,
    OTP_EXPIRE_MINUTES
)
from services.email_service import (
    send_verification_otp_email, send_email, is_placeholder,
    RESEND_API_KEY, RESEND_FROM_EMAIL
)
from core.security import limiter

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


@router.post("/register", response_model=MessageResponse)
def register_legacy_alias(request: Request, body: SendOTPRequest):
    """
    POST /api/auth/register
    Legacy alias for send-signup-otp to maintain frontend compatibility.
    """
    return send_signup_otp(request, body)

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
@router.post("/complete-signup", status_code=200)
def complete_signup(payload: CompleteSignupRequest):
    """
    POST /api/auth/complete-signup
    1. Validate Signup Token
    2. Confirm OTP Verification State
    3. Create Actual User
    """
    print(f"[SIGNUP-TRACE] complete-signup called")
    print(f"[SIGNUP-TRACE] signup token received")
    
    try:
        token_data = decode_token(payload.signup_token)
        email = token_data.get("sub")
        if not email:
            print(f"[SIGNUP-TRACE] token decode failure")
            return {"success": False, "message": "Invalid token payload."}
        print(f"[SIGNUP-TRACE] token decode success")
        print(f"[SIGNUP-TRACE] email extracted from token")
    except Exception as e:
        print(f"[SIGNUP-TRACE] Token validation failure: {e}")
        return {"success": False, "message": "Invalid or expired signup session."}

    print(f"[SIGNUP-TRACE] username/full_name received")
    if len(payload.password) < 8:
        print(f"[SIGNUP-FAILURE] Password validation failed")
        return {"success": False, "message": "Password does not meet requirements."}
    print(f"[SIGNUP-TRACE] password validation passed")

    try:
        with get_db() as cursor:
            # Final Safety Check: Ensure this email was actually verified in the last 15 mins
            cursor.execute(
                "SELECT id FROM email_verification_otps WHERE email = %s AND verified = TRUE AND verified_at > NOW() - INTERVAL '15 minutes' LIMIT 1",
                (email,)
            )
            if not cursor.fetchone():
                print(f"[SIGNUP-FAILURE] Email verification session expired or not found")
                return {"success": False, "message": "Email verification session expired or not found."}

            # Check collision (username or email)
            cursor.execute("SELECT id FROM users WHERE email = %s OR username = %s LIMIT 1", (email, payload.username))
            if cursor.fetchone():
                print(f"[SIGNUP-TRACE] user already exists true")
                return {"success": False, "message": "Account already exists with this email or username."}
            print(f"[SIGNUP-TRACE] user already exists false")

            pwd_hash = hash_password(payload.password)
            cursor.execute(
                "INSERT INTO users (full_name, username, email, password_hash, role, auth_provider) VALUES (%s, %s, %s, %s, 'citizen', 'database') RETURNING id",
                (payload.full_name, payload.username, email, pwd_hash)
            )
            user_id = cursor.fetchone()["id"]
            print(f"[SIGNUP-TRACE] user row created")
            # The context manager automatically commits if no exception is raised
            print(f"[SIGNUP-TRACE] db commit success")
            
        print(f"[SIGNUP-TRACE] returning success response")
        return {
            "success": True,
            "message": "Account created successfully.",
            "user_id": str(user_id)
        }
    except Exception as e:
        print(f"[SIGNUP-FAILURE] exception details: {e}")
        return {
            "success": False,
            "message": "Unable to create account."
        }

@router.get("/reset-admin-demo")
def reset_admin_demo():
    """
    TEMPORARY: Restores the production admin account.
    """
    with get_db() as cursor:
        pwd_hash = hash_password("Admin@123")
        cursor.execute(
            "UPDATE users SET password_hash = %s, auth_provider = 'database' WHERE role = 'admin'",
            (pwd_hash,)
        )
    return {
        "success": True,
        "message": "Admin account successfully reset to Admin@123 with database auth provider."
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


@router.post("/oauth-login", response_model=dict)
def oauth_login(payload: OAuthLogin):
    """
    POST /api/auth/oauth-login
    Syncs Auth0 (Google/GitHub/Twitter) users with the local database.
    """
    email = payload.email.strip().lower()
    print(f"[AUTH-TRACE] OAuth login attempt for: {email} (Provider: {payload.provider})")

    with get_db() as cursor:
        # 1. Try to find by provider_id
        cursor.execute(
            "SELECT id, email, role, username, department, is_suspended FROM users WHERE auth_provider_id = %s",
            (payload.provider_id,)
        )
        user = cursor.fetchone()

        # 2. If not found, try by email (handle account linking)
        if not user:
            cursor.execute(
                "SELECT id, email, role, username, department, is_suspended, auth_provider FROM users WHERE email = %s",
                (email,)
            )
            user = cursor.fetchone()
            
            if user:
                # Update existing user to use this OAuth provider
                cursor.execute(
                    "UPDATE users SET auth_provider = %s, auth_provider_id = %s, profile_picture = %s WHERE id = %s",
                    (payload.provider, payload.provider_id, payload.picture, user["id"])
                )
                print(f"[AUTH-TRACE] Linked existing user {email} to OAuth {payload.provider}")
            else:
                # 3. Create new OAuth user
                username = payload.name.replace(" ", "_").lower()[:60]
                # Ensure unique username
                cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
                if cursor.fetchone():
                    username = f"{username}_{generate_otp()[:4]}"

                cursor.execute(
                    """
                    INSERT INTO users (full_name, username, email, auth_provider, auth_provider_id, profile_picture, role)
                    VALUES (%s, %s, %s, %s, %s, %s, 'citizen') RETURNING id, role, username, email, department, is_suspended
                    """,
                    (payload.name, username, email, payload.provider, payload.provider_id, payload.picture)
                )
                user = cursor.fetchone()
                print(f"[AUTH-TRACE] Created new OAuth user {email}")

    if user["is_suspended"]:
        raise HTTPException(status_code=403, detail="Your account has been suspended.")

    # Generate JWT
    access_token = create_access_token(
        user_id=str(user["id"]),
        role=user["role"],
        email=user["email"],
        department=user.get("department")
    )

    return {
        "success": True,
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": str(user["id"]),
        "username": user["username"],
        "role": user["role"],
        "department": user.get("department")
    }


@router.get("/me", response_model=UserResponse)
def get_me(current_user: dict = Depends(get_current_user)):
    """
    GET /api/auth/me
    Returns current user profile.
    """
    user_id = current_user["sub"]
    with get_db() as cursor:
        cursor.execute(
            """
            SELECT id, username, email, role, full_name, department, 
                   auth_provider, profile_picture, trust_score, points_cache, 
                   rank, is_suspended, created_at
            FROM users WHERE id = %s
            """,
            (user_id,)
        )
        row = cursor.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="User not found.")

    item = dict(row)
    item["id"] = str(item["id"])
    return item


# ── Password Reset Flow ──────────────────────────────────────


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token:    str
    password: str


@router.post("/forgot-password", response_model=MessageResponse)
def forgot_password(payload: ForgotPasswordRequest):
    """
    POST /api/auth/forgot-password
    1. Check user exists
    2. Generate reset token
    3. Store hashed token in DB
    4. Send email with branded HTML template
    """
    email = payload.email.strip().lower()
    print(f"[AUTH-TRACE] Forgot password requested for: {email}")

    with get_db() as cursor:
        cursor.execute("SELECT id, full_name, username FROM users WHERE email = %s AND auth_provider = 'database'", (email,))
        user = cursor.fetchone()
        
        if not user:
            # Silent fail for security, but log it
            print(f"[AUTH-TRACE] Password reset attempt for non-existent or OAuth user: {email}")
            return {"success": True, "message": "If an account exists, a reset link has been sent."}

        token = generate_reset_token()
        token_hash = hash_token(token)
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=PASSWORD_RESET_TOKEN_EXPIRE_MINUTES)

        cursor.execute(
            "INSERT INTO password_reset_tokens (user_id, email_snapshot, token_hash, expires_at) VALUES (%s, %s, %s, %s)",
            (user["id"], email, token_hash, expires_at)
        )

        reset_link = f"{APP_BASE_URL}/reset-password.html?token={token}"
        
        # Cyber-Premium Branded HTML email
        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body {{ background-color: #0f172a; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }}
                .container {{ max-width: 600px; margin: 40px auto; background-color: #1e293b; border-radius: 16px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.1); }}
                .header {{ padding: 40px 0; text-align: center; background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); }}
                .header h1 {{ margin: 0; color: #ffffff; font-size: 28px; font-weight: 800; text-transform: uppercase; }}
                .content {{ padding: 48px 40px; text-align: center; color: #f1f5f9; }}
                .btn {{ display: inline-block; background-color: #6366f1; color: #ffffff; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 30px 0; }}
                .footer {{ padding: 32px 40px; background-color: #0f172a; text-align: center; color: #94a3b8; font-size: 14px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header"><h1>RESOLVIT</h1></div>
                <div class="content">
                    <h2 style="color: #ffffff;">Reset Your Password</h2>
                    <p>Hello {user['full_name'] or user['username']},</p>
                    <p>We received a request to reset your RESOLVIT account password. Use the secure link below to proceed:</p>
                    <a href="{reset_link}" class="btn">RESET PASSWORD</a>
                    <p style="font-size: 14px; color: #94a3b8;">This link will expire in {PASSWORD_RESET_TOKEN_EXPIRE_MINUTES} minutes.</p>
                </div>
                <div class="footer">
                    <p>&copy; 2026 RESOLVIT. Digital Accountability Platform.</p>
                </div>
            </div>
        </body>
        </html>
        """
        success = send_email(email, "Reset Your RESOLVIT Password", html)
        
        return {
            "success": success,
            "message": "If an account exists, a reset link has been sent."
        }


@router.get("/verify-reset-token", response_model=MessageResponse)
def verify_reset_token(token: str = Query(...)):
    """
    GET /api/auth/verify-reset-token
    Validates the password reset token before showing the UI.
    """
    token_hash = hash_token(token)
    with get_db() as cursor:
        cursor.execute(
            "SELECT id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = %s",
            (token_hash,)
        )
        row = cursor.fetchone()

        if not row:
            return {"success": False, "message": "Invalid reset token."}
        
        if row["used_at"]:
            return {"success": False, "message": "This token has already been used."}
        
        if row["expires_at"] < datetime.now(timezone.utc):
            return {"success": False, "message": "This token has expired."}

    return {"success": True, "message": "Token is valid."}


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(payload: ResetPasswordRequest):
    """
    POST /api/auth/reset-password
    1. Verify token
    2. Hash new password
    3. Update user table
    4. Invalidate token
    """
    token_hash = hash_token(payload.token)
    
    with get_db() as cursor:
        cursor.execute(
            "SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = %s",
            (token_hash,)
        )
        token_row = cursor.fetchone()

        if not token_row or token_row["used_at"] or token_row["expires_at"] < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Invalid or expired reset token.")

        # Update password
        new_pwd_hash = hash_password(payload.password)
        cursor.execute(
            "UPDATE users SET password_hash = %s, updated_at = NOW() WHERE id = %s",
            (new_pwd_hash, token_row["user_id"])
        )

        # Mark token as used
        cursor.execute(
            "UPDATE password_reset_tokens SET used_at = NOW() WHERE id = %s",
            (token_row["id"],)
        )

    return {"success": True, "message": "Password has been reset successfully."}
