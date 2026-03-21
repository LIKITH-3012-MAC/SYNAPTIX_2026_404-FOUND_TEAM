"""
RESOLVIT - Email Service
Hardened production-grade email delivery using Resend Direct HTTP API.
Includes comprehensive auditing and fallback logic.
"""
import os
import requests
import json
import traceback
from datetime import datetime
from typing import Optional
from database import get_db

# ── Config ───────────────────────────────────────────────────
RESEND_API_KEY    = os.getenv("RESEND_API_KEY")
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "updates@resolvit-ai.online")
APP_BASE_URL      = os.getenv("APP_BASE_URL", "https://resolvit-ai.online")
EMAIL_ENABLED     = os.getenv("EMAIL_ENABLED", "true").lower() == "true"
SUPPORT_EMAIL     = os.getenv("SUPPORT_EMAIL", "support@resolvit-ai.online")

# ── Metrics / Expiry Config (Used by routes) ──────────────────
PASSWORD_RESET_TOKEN_EXPIRE_MINUTES = int(os.getenv("PASSWORD_RESET_TOKEN_EXPIRE_MINUTES", "30"))
OTP_EXPIRE_MINUTES = int(os.getenv("OTP_EXPIRE_MINUTES", "5"))


def _log_email_attempt(recipient: str, subject: str, success: bool, error: Optional[str] = None, issue_id: Optional[str] = None):
    """Internal helper to log all email attempts to the database audit table."""
    try:
        with get_db() as cursor:
            cursor.execute(
                """
                INSERT INTO email_audit_logs (issue_id, recipient, subject, email_sent, error_message)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (issue_id, recipient, subject, success, error)
            )
    except Exception as e:
        print(f"[CRITICAL-DB] Failed to log email audit to DB: {e}")


def send_email(to_email: str, subject: str, html_content: str, issue_id: Optional[str] = None) -> bool:
    """
    Sends a production-grade email using Resend API via Direct HTTP.
    This bypasses potential SDK environment issues and provides maximum control.
    """
    if not EMAIL_ENABLED:
        print(f"[EMAIL-MOCK] To: {to_email} | Subject: {subject}")
        return True

    if not RESEND_API_KEY or "placeholder" in RESEND_API_KEY.lower():
        error_msg = "RESEND_API_KEY is missing or invalid (placeholder detected)."
        print(f"[EMAIL-ERROR] {error_msg} Target: {to_email}")
        _log_email_attempt(to_email, subject, False, error_msg, issue_id)
        return False

    print(f"[EMAIL-TRACE] Attempting delivery to: {to_email}")
    
    payload = {
        "from": f"RESOLVIT <{RESEND_FROM_EMAIL}>",
        "to": [to_email],
        "subject": subject,
        "html": html_content
    }

    try:
        print(f"[EMAIL-TRACE] Executing Resend API request...")
        response = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json"
            },
            json=payload,
            timeout=15
        )

        if response.status_code in [200, 201, 202, 204]:
            print(f"[EMAIL-SUCCESS] API accepted delivery to {to_email}. ID: {response.text}")
            _log_email_attempt(to_email, subject, True, None, issue_id)
            return True
        else:
            error_detail = f"Resend API Error {response.status_code}: {response.text}"
            print(f"[EMAIL-FAILURE] {error_detail}")
            _log_email_attempt(to_email, subject, False, error_detail, issue_id)
            return False

    except requests.exceptions.Timeout:
        err = "Resend API request timed out after 15s."
        print(f"[EMAIL-FAILURE] {err}")
        _log_email_attempt(to_email, subject, False, err, issue_id)
        return False
    except Exception as e:
        err_msg = str(e)
        err_stack = traceback.format_exc()
        print(f"[EMAIL-CRITICAL-EXCEPTION]\n{err_stack}")
        _log_email_attempt(to_email, subject, False, err_msg, issue_id)
        return False


def send_signup_otp_email(to_email: str, otp: str) -> bool:
    """
    Send the 6-digit verification code for new user signups.
    Uses a premium, centered card design.
    """
    subject = f"{otp} is your RESOLVIT verification code"
    
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; }}
            .container {{ max-width: 500px; margin: 40px auto; background: #ffffff; border-radius: 24px; padding: 48px; border: 1px solid #e2e8f0; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.05); }}
            .logo {{ font-size: 24px; font-weight: 900; color: #6366f1; margin-bottom: 32px; letter-spacing: -1px; }}
            h1 {{ color: #1e293b; font-size: 24px; font-weight: 800; margin-bottom: 12px; }}
            p {{ color: #64748b; font-size: 16px; line-height: 1.6; margin-bottom: 32px; }}
            .otp-box {{ background: #f1f5f9; border-radius: 16px; padding: 24px; display: inline-block; margin-bottom: 32px; border: 1px solid #e2e8f0; }}
            .otp-code {{ font-family: 'Courier New', Courier, monospace; font-size: 42px; font-weight: 800; color: #1e1b4b; letter-spacing: 12px; margin-left:12px; }}
            .warning {{ background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.1); border-radius: 12px; padding: 16px; font-size: 13px; color: #b91c1c; }}
            .footer {{ margin-top: 40px; padding-top: 24px; border-top: 1px solid #f1f5f9; color: #94a3b8; font-size: 12px; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="logo">RESOLVIT</div>
            <h1>Verify your email</h1>
            <p>Use the 6-digit verification code below to complete your signup. For your security, this code will expire soon.</p>
            
            <div class="otp-box">
                <span class="otp-code">{otp}</span>
            </div>
            
            <div class="warning">
                <strong>Safety Warning:</strong> This code expires in {OTP_EXPIRE_MINUTES} minutes. Never share this code with anyone, including RESOLVIT staff.
            </div>
            
            <div class="footer">
                If you did not request this code, you can safely ignore this email.<br>
                © {datetime.now().year} RESOLVIT - Civic Governance Reimagined
            </div>
        </div>
    </body>
    </html>
    """
    return send_email(to_email, subject, html)


def send_password_reset_email(to_email: str, reset_token: str) -> bool:
    """
    Send a secure password reset link to the user.
    """
    reset_link = f"{APP_BASE_URL}/reset-password.html?token={reset_token}"
    subject = "Reset your RESOLVIT account password"
    
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; }}
            .card {{ max-width: 580px; margin: 0 auto; background: white; border-radius: 20px; padding: 40px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.03); }}
            .btn {{ display: inline-block; background: #6366f1; color: #ffffff !important; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: 700; font-size: 16px; margin: 24px 0; }}
            .footer {{ color: #94a3b8; font-size: 12px; margin-top: 32px; border-top: 1px solid #f1f5f9; padding-top: 24px; text-align: center; }}
        </style>
    </head>
    <body>
        <div class="card">
            <h1 style="color:#1e293b; font-size:22px; font-weight:800; margin-bottom:16px;">Password Reset Request</h1>
            <p style="color:#475569; font-size:16px; line-height:1.6;">We received a request to reset your password. Click the button below to secure your account with a new password.</p>
            
            <div style="text-align:center;">
                <a href="{reset_link}" class="btn">Reset Password</a>
            </div>
            
            <p style="color:#64748b; font-size:14px; text-align:center;">This link will expire in {PASSWORD_RESET_TOKEN_EXPIRE_MINUTES} minutes.</p>
            
            <div class="footer">
                If you did not request this, your account is safe and you can ignore this email.<br>
                RESOLVIT - Authority Accountability System
            </div>
        </div>
    </body>
    </html>
    """
    return send_email(to_email, subject, html)


def send_welcome_email(to_email: str, username: str) -> bool:
    """Sends a welcome email after successful signup."""
    subject = f"Welcome to RESOLVIT, {username}!"
    html = f"<h1>Welcome to RESOLVIT</h1><p>Hi {username}, your account is now active and verified.</p>"
    return send_email(to_email, subject, html)
