"""
RESOLVIT - Production-Grade Email Service
Strict Resend implementation. Fail-fast. No fallbacks.
"""
import os
import requests
import traceback
from typing import Optional
from database import get_db

# ── Config (Strict Environment Validation) ─────────────────────────
RESEND_API_KEY    = os.getenv("RESEND_API_KEY")
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "updates@resolvit-ai.online")
EMAIL_ENABLED     = os.getenv("EMAIL_ENABLED", "true").lower() == "true"

# Expiry Settings
OTP_EXPIRE_MINUTES = int(os.getenv("OTP_EXPIRE_MINUTES", "5"))

# Aggressive Placeholder Detection
PLACEHOLDERS = ["your_key", "re_your_key", "test_key", "placeholder", "key_here", "your_email", "your_app_password"]

def is_placeholder(key: Optional[str]) -> bool:
    if not key: return True
    k = key.lower()
    return any(p in k for p in PLACEHOLDERS)

def _log_email_attempt(recipient: str, subject: str, success: bool, error: Optional[str] = None, issue_id: Optional[str] = None, response_body: Optional[str] = None):
    """Persists every delivery attempt to the database."""
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
    Core delivery function using Resend. 
    Strictly follows production requirements: No fallbacks. Fail-fast.
    """
    if not EMAIL_ENABLED:
        print(f"[EMAIL-TRACE] MOCK SEND (Disabled) -> To: {to_email}")
        return True

    # 1. Strict API Key Validation
    if not RESEND_API_KEY or is_placeholder(RESEND_API_KEY):
        err = "Invalid RESEND_API_KEY"
        print(f"[EMAIL-FAILURE] {err}")
        _log_email_attempt(to_email, subject, False, err, issue_id)
        return False

    print(f"[EMAIL-TRACE] email target: {to_email}")
    print(f"[EMAIL-TRACE] resend key present: True")
    print(f"[EMAIL-TRACE] sending email")

    payload = {
        "from": f"RESOLVIT <{RESEND_FROM_EMAIL}>",
        "to": [to_email],
        "subject": subject,
        "html": html_content
    }

    try:
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
        
        print(f"[EMAIL-TRACE] resend response: {resp_text}")

        if status_code in [200, 201, 202, 204]:
            print(f"[EMAIL-SUCCESS] Delivered to {to_email}")
            _log_email_attempt(to_email, subject, True, None, issue_id, resp_text)
            return True
        else:
            err_msg = f"resend error {status_code}: {resp_text}"
            print(f"[EMAIL-FAILURE] {err_msg}")
            _log_email_attempt(to_email, subject, False, err_msg, issue_id, resp_text)
            return False

    except Exception as e:
        err_msg = f"Exception during send: {str(e)}"
        print(f"[EMAIL-FAILURE] {err_msg}")
        _log_email_attempt(to_email, subject, False, str(e), issue_id)
        return False

def send_verification_otp_email(to_email: str, otp: str) -> bool:
    print(f"[OTP-TRACE] Sending OTP {otp} to {to_email}")
    subject = f"{otp} is your RESOLVIT verification code"
    html = f"""
    <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 40px; border: 1px solid #eee; border-radius: 12px; text-align: center;">
        <h1 style="color: #6366f1; margin: 0 0 24px 0;">Verify your identity</h1>
        <p style="color: #666; font-size: 16px;">Use the code below to complete your RESOLVIT signup.</p>
        <div style="background: #f8fafc; padding: 24px; border-radius: 8px; margin: 32px 0;">
            <span style="font-size: 42px; font-weight: 800; color: #1e1b4b; letter-spacing: 12px; margin-left: 12px;">{otp}</span>
        </div>
        <p style="color: #999; font-size: 13px;">This code expires in {OTP_EXPIRE_MINUTES} minutes.</p>
        <p style="color: #ef4444; font-size: 13px; font-weight: bold;">Do not share this code with anyone.</p>
    </div>
    """
    return send_email(to_email, subject, html)

def send_issue_update_email(to_email: str, name: str, issue_data: dict) -> bool:
    subject = f"Update on your report: {issue_data['title']}"
    html = f"<div><h2>Issue Update: {issue_data['status']}</h2><p>Hello {name}, your issue {issue_data['title']} is now {issue_data['status']}.</p></div>"
    return send_email(to_email, subject, html, issue_id=issue_data['id'])
