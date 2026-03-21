"""
RESOLVIT - Production Hardened Email Service V4
Resend Primary with Gmail SMTP Fallback for local development.
"""
import os
import requests
import json
import traceback
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from typing import Optional
from database import get_db

# ── Config (Strict Environment Validation) ─────────────────────────
RESEND_API_KEY    = os.getenv("RESEND_API_KEY")
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "updates@resolvit-ai.online")
APP_BASE_URL      = os.getenv("APP_BASE_URL", "https://resolvit-ai.online")
EMAIL_ENABLED     = os.getenv("EMAIL_ENABLED", "true").lower() == "true"

# SMTP Fallback Settings (for local dev)
SMTP_HOST     = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT     = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER     = os.getenv("SMTP_USER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
SMTP_FROM     = os.getenv("SMTP_FROM", "RESOLVIT <noreply@resolvit.gov>")

OTP_EXPIRE_MINUTES = int(os.getenv("OTP_EXPIRE_MINUTES", "5"))
PLACEHOLDERS = ["your_key", "re_your_key", "test_key", "placeholder", "key_here", "your_email", "your_app_password"]

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

def _send_via_smtp(to_email: str, subject: str, html_content: str) -> bool:
    """Fallback: Send email via Gmail SMTP if Resend fails/missing."""
    if not SMTP_USER or not SMTP_PASSWORD or is_placeholder(SMTP_USER) or is_placeholder(SMTP_PASSWORD):
        print("[EMAIL-FAILURE] SMTP credentials missing/placeholder. Skipping fallback.")
        return False

    print(f"[EMAIL-TRACE] Attempting SMTP fallback via {SMTP_HOST}...")
    try:
        msg = MIMEMultipart()
        msg['From'] = SMTP_FROM
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(html_content, 'html'))

        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.send_message(msg)
        server.quit()
        print(f"[EMAIL-SUCCESS] SMTP delivery successful to {to_email}")
        return True
    except Exception as e:
        print(f"[EMAIL-FAILURE] SMTP fallback failed: {e}")
        return False

def send_email(to_email: str, subject: str, html_content: str, issue_id: Optional[str] = None) -> bool:
    """
    Core delivery function with Resend Primary and SMTP Fallback.
    """
    if not EMAIL_ENABLED:
        print(f"[EMAIL-TRACE] MOCK SEND (Email Disabled) -> To: {to_email}")
        return True

    # Try Resend First
    if not is_placeholder(RESEND_API_KEY):
        print(f"[EMAIL-TRACE] Starting Resend delivery to: {to_email}")
        payload = {
            "from": f"RESOLVIT <{RESEND_FROM_EMAIL}>",
            "to": [to_email],
            "subject": subject,
            "html": html_content
        }
        try:
            response = requests.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
                json=payload, timeout=10
            )
            if response.status_code in [200, 201, 202]:
                print(f"[EMAIL-SUCCESS] Resend accepted delivery for {to_email}")
                _log_email_attempt(to_email, subject, True, None, issue_id, response.text)
                return True
            else:
                print(f"[EMAIL-TRACE] Resend rejected: {response.text}")
        except Exception as e:
            print(f"[EMAIL-TRACE] Resend Exception: {e}")

    # Fallback to SMTP
    success = _send_via_smtp(to_email, subject, html_content)
    _log_email_attempt(to_email, subject, success, "SMTP Fallback Used" if success else "All providers failed", issue_id)
    return success

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
    </div>
    """
    return send_email(to_email, subject, html)

def send_issue_update_email(to_email: str, name: str, issue_data: dict) -> bool:
    """Missing function required by admin_routes.py."""
    print(f"[EMAIL-TRACE] Sending issue update to {to_email}")
    subject = f"Update on your report: {issue_data['title']}"
    html = f"""
    <div style="font-family: sans-serif; padding: 40px; border: 1px solid #eee; border-radius: 12px;">
        <h2 style="color: #6366f1;">Issue Update: {issue_data['status']}</h2>
        <p>Hello {name},</p>
        <p>Your reported issue <strong>{issue_data['title']}</strong> has been updated to <strong>{issue_data['status']}</strong>.</p>
        <p>Priority Score: {issue_data.get('priority_score', 'N/A')}</p>
        <hr/>
        <p style="font-size: 12px; color: #999;">RESOLVIT Civic Governance Platform</p>
    </div>
    """
    return send_email(to_email, subject, html, issue_id=issue_data['id'])
