"""
RESOLVIT - Hardened Email Service V2
Strict environment validation, direct HTTP API, and detailed audit logging.
"""
import os
import requests
import json
import traceback
from datetime import datetime
from typing import Optional
from database import get_db

# ── Config (Strict Environment) ────────────────────────────────
RESEND_API_KEY    = os.getenv("RESEND_API_KEY")
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "updates@resolvit-ai.online")
APP_BASE_URL      = os.getenv("APP_BASE_URL", "https://resolvit-ai.online")
EMAIL_ENABLED     = os.getenv("EMAIL_ENABLED", "true").lower() == "true"

# Expiry Settings
OTP_EXPIRE_MINUTES = int(os.getenv("OTP_EXPIRE_MINUTES", "5"))
PASSWORD_RESET_TOKEN_EXPIRE_MINUTES = int(os.getenv("PASSWORD_RESET_TOKEN_EXPIRE_MINUTES", "30"))


def _log_email_attempt(recipient: str, subject: str, success: bool, error: Optional[str] = None, issue_id: Optional[str] = None, response_body: str = None):
    """Internal helper to log all email attempts to the database audit table."""
    try:
        with get_db() as cursor:
            cursor.execute(
                """
                INSERT INTO email_audit_logs (issue_id, recipient, subject, email_sent, error_message, response_body)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (issue_id, recipient, subject, success, error, response_body)
            )
    except Exception as e:
        print(f"[CRITICAL-DB] Failed to log email audit: {e}")


def send_email(to_email: str, subject: str, html_content: str, issue_id: Optional[str] = None) -> bool:
    """
    Sends an email via Resend Direct HTTP API.
    Strictly logs every step with [EMAIL-TRACE], [EMAIL-SUCCESS], [EMAIL-FAILURE].
    """
    if not EMAIL_ENABLED:
        print(f"[EMAIL-MOCK] To: {to_email} | Subject: {subject}")
        return True

    if not RESEND_API_KEY or "your_key" in RESEND_API_KEY.lower():
        err = "RESEND_API_KEY is missing or invalid (placeholder detected)."
        print(f"[EMAIL-FAILURE] {err} Target: {to_email}")
        _log_email_attempt(to_email, subject, False, err, issue_id)
        return False

    print(f"[EMAIL-TRACE] Start send process to {to_email}")
    
    payload = {
        "from": f"RESOLVIT <{RESEND_FROM_EMAIL}>",
        "to": [to_email],
        "subject": subject,
        "html": html_content
    }

    try:
        print(f"[EMAIL-TRACE] Calling Resend API...")
        response = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json"
            },
            json=payload,
            timeout=15
        )

        status_code = response.status_code
        resp_text = response.text
        
        print(f"[EMAIL-TRACE] Resend API Response Status: {status_code}")
        print(f"[EMAIL-TRACE] Resend API Response Body: {resp_text}")

        if status_code in [200, 201, 202, 204]:
            print(f"[EMAIL-SUCCESS] Sent to {to_email}. Response: {resp_text}")
            _log_email_attempt(to_email, subject, True, None, issue_id, resp_text)
            return True
        else:
            err_msg = f"Resend API Error {status_code}: {resp_text}"
            print(f"[EMAIL-FAILURE] {err_msg}")
            _log_email_attempt(to_email, subject, False, err_msg, issue_id, resp_text)
            return False

    except requests.exceptions.Timeout:
        err = "Resend API connection timed out (15s)."
        print(f"[EMAIL-FAILURE] {err}")
        _log_email_attempt(to_email, subject, False, err, issue_id)
        return False
    except Exception as e:
        err_stack = traceback.format_exc()
        print(f"[EMAIL-FAILURE] Exception during send: {str(e)}")
        print(f"[EMAIL-TRACE] Full Stack Trace:\n{err_stack}")
        _log_email_attempt(to_email, subject, False, str(e), issue_id)
        return False


def send_verification_otp_email(to_email: str, otp: str) -> bool:
    """Sends the 6-digit verification code for signups."""
    print(f"[OTP-TRACE] Preparing OTP email for {to_email}")
    subject = f"{otp} is your RESOLVIT verification code"
    
    html = f"""
    <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; border: 1px solid #eee; padding: 40px; border-radius: 12px; text-align: center;">
        <h1 style="color: #6366f1; margin-bottom: 24px;">Verify your identity</h1>
        <p style="color: #666; font-size: 16px;">Use the code below to complete your RESOLVIT signup.</p>
        <div style="background: #f8fafc; padding: 24px; border-radius: 8px; margin: 32px 0;">
            <span style="font-size: 42px; font-weight: 800; color: #1e1b4b; letter-spacing: 12px; margin-left:12px;">{otp}</span>
        </div>
        <p style="color: #999; font-size: 13px;">This code expires in {OTP_EXPIRE_MINUTES} minutes.</p>
    </div>
    """
    return send_email(to_email, subject, html)


def send_password_reset_email(to_email: str, reset_token: str) -> bool:
    """Sends a password reset link."""
    reset_link = f"{APP_BASE_URL}/reset-password.html?token={reset_token}"
    subject = "Reset your RESOLVIT password"
    html = f"<h1>Reset Password</h1><p>Click <a href='{reset_link}'>here</a> to reset your password.</p>"
    return send_email(to_email, subject, html)


def send_welcome_email(to_email: str, username: str) -> bool:
    """Sends a welcome email."""
    subject = "Welcome to RESOLVIT!"
    html = f"<h1>Welcome {username}!</h1><p>Your account is now active.</p>"
    return send_email(to_email, subject, html)
