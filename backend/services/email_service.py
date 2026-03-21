"""
RESOLVIT - Production Hardened Email Service V3
Aggressive placeholder detection, environment-first config, and strict [EMAIL-TRACE] logging.
"""
import os
import requests
import json
import traceback
from datetime import datetime
from typing import Optional
from database import get_db

# ── Config (Strict Environment Validation) ─────────────────────────
RESEND_API_KEY    = os.getenv("RESEND_API_KEY")
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "updates@resolvit-ai.online")
APP_BASE_URL      = os.getenv("APP_BASE_URL", "https://resolvit-ai.online")
EMAIL_ENABLED     = os.getenv("EMAIL_ENABLED", "true").lower() == "true"

# Expiry Settings
OTP_EXPIRE_MINUTES = int(os.getenv("OTP_EXPIRE_MINUTES", "5"))

# Aggressive Placeholder Detection
PLACEHOLDERS = ["your_key", "re_your_key", "test_key", "placeholder", "key_here"]

def is_placeholder(key: Optional[str]) -> bool:
    if not key: return True
    k = key.lower()
    return any(p in k for p in PLACEHOLDERS)


def _log_email_attempt(recipient: str, subject: str, success: bool, error: Optional[str] = None, issue_id: Optional[str] = None, response_body: Optional[str] = None):
    """Persists every delivery attempt to the database for production auditing."""
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
    Core delivery function using Resend Direct HTTP API.
    Strictly uses: [EMAIL-TRACE], [EMAIL-SUCCESS], [EMAIL-FAILURE].
    """
    if not EMAIL_ENABLED:
        print(f"[EMAIL-TRACE] MOCK SEND (Email Disabled) -> To: {to_email} | Subject: {subject}")
        return True

    # 1. Validate API Key
    if is_placeholder(RESEND_API_KEY):
        error_msg = "RESEND_API_KEY is missing or invalid (placeholder detected)."
        print(f"[EMAIL-FAILURE] {error_msg} Target: {to_email}")
        _log_email_attempt(to_email, subject, False, error_msg, issue_id)
        return False

    print(f"[EMAIL-TRACE] Starting delivery to: {to_email}")
    print(f"[EMAIL-TRACE] Using sender: {RESEND_FROM_EMAIL}")
    print(f"[EMAIL-TRACE] RESEND_API_KEY present: {bool(RESEND_API_KEY)}")
    
    payload = {
        "from": f"RESOLVIT <{RESEND_FROM_EMAIL}>",
        "to": [to_email],
        "subject": subject,
        "html": html_content
    }

    try:
        print(f"[EMAIL-TRACE] Sending via Resend API...")
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
        
        print(f"[EMAIL-TRACE] Resend API response status: {status_code}")
        print(f"[EMAIL-TRACE] Resend API response body: {resp_text}")

        if status_code in [200, 201, 202, 204]:
            print(f"[EMAIL-SUCCESS] Delivery accepted for {to_email}.")
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
    """Sends the 6-digit OTP for user signup identity verification."""
    print(f"[OTP-TRACE] Preparing OTP email for: {to_email}")
    subject = f"{otp} is your RESOLVIT verification code"
    
    html = f"""
    <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 40px; border: 1px solid #eee; border-radius: 12px; text-align: center;">
        <h1 style="color: #6366f1; margin: 0 0 24px 0;">Verify your identity</h1>
        <p style="color: #666; font-size: 16px;">Use the code below to complete your RESOLVIT signup.</p>
        <div style="background: #f8fafc; padding: 24px; border-radius: 8px; margin: 32px 0;">
            <span style="font-size: 42px; font-weight: 800; color: #1e1b4b; letter-spacing: 12px; margin-left: 12px;">{otp}</span>
        </div>
        <p style="color: #999; font-size: 13px;">This code expires in {OTP_EXPIRE_MINUTES} minutes.</p>
    </div>
    """
    return send_email(to_email, subject, html)
