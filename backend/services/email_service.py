import os
import requests
import json
import time
import traceback
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
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

# ── Logic: Background Dispatch & Retries ─────────────────────────

def _log_email_attempt(log_id: Optional[str], recipient: str, subject: str, status: str, 
                        success: bool = False, error: Optional[str] = None, 
                        issue_id: Optional[str] = None, response_body: Optional[str] = None,
                        template_name: Optional[str] = None, retry_count: int = 0):
    """
    Creates or updates an email audit log record.
    If log_id is provided, updates existing record. Otherwise inserts.
    """
    try:
        with get_db() as cursor:
            resend_msg_id = None
            if response_body:
                try:
                    data = json.loads(response_body)
                    resend_msg_id = data.get("id")
                except: pass

            if log_id:
                # UPDATE
                cursor.execute(
                    """
                    UPDATE email_audit_logs 
                    SET status = %s, email_sent = %s, error_message = %s, 
                        response_body = %s, resend_message_id = %s, 
                        retry_count = %s, failed_at = %s
                    WHERE id = %s
                    """,
                    (status, success, error, response_body, resend_msg_id, 
                     retry_count, (datetime.now(timezone.utc) if not success and status == 'failed' else None), log_id)
                )
                return log_id
            else:
                # INSERT
                cursor.execute(
                    """
                    INSERT INTO email_audit_logs (issue_id, recipient, subject, email_sent, status, error_message, response_body, template_name, retry_count, resend_message_id)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (issue_id, recipient, subject, success, status, error, response_body, template_name, retry_count, resend_msg_id)
                )
                return cursor.fetchone()["id"]
    except Exception as e:
        print(f"[CRITICAL-DB] Failed to log email audit: {e}")
        return None

def dispatch_email_task(to_email: str, subject: str, html_content: str, 
                        issue_id: Optional[str] = None, template_name: Optional[str] = None):
    """
    THE BACKGROUND WORKER.
    Handles delivery with Exponential Backoff (1s, 3s, 5s).
    """
    if not EMAIL_ENABLED:
        print(f"[EMAIL-MOCK] {subject} -> {to_email}")
        return

    # Initial Log Entry
    log_id = _log_email_attempt(None, to_email, subject, "pending", template_name=template_name, issue_id=issue_id)
    
    # Validation
    if not RESEND_API_KEY or is_placeholder(RESEND_API_KEY):
        _log_email_attempt(log_id, to_email, subject, "failed", error="Invalid RESEND_API_KEY", issue_id=issue_id)
        return

    max_retries = 3
    backoff_seconds = [1, 3, 5]
    
    payload = {
        "from": f"RESOLVIT <{RESEND_FROM_EMAIL}>",
        "to": [to_email],
        "subject": subject,
        "html": html_content
    }

    for attempt in range(max_retries + 1):
        if attempt > 0:
            print(f"[EMAIL-RETRY] Attempt {attempt} for {to_email} after {backoff_seconds[attempt-1]}s")
            time.sleep(backoff_seconds[attempt-1])
            _log_email_attempt(log_id, to_email, subject, "retrying", retry_count=attempt, issue_id=issue_id)

        try:
            response = requests.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {RESEND_API_KEY}",
                    "Content-Type": "application/json"
                },
                json=payload,
                timeout=12
            )
            
            resp_text = response.text
            if response.status_code in [200, 201, 202, 204]:
                print(f"[EMAIL-SUCCESS] Sent to {to_email}")
                _log_email_attempt(log_id, to_email, subject, "sent", success=True, response_body=resp_text, retry_count=attempt, issue_id=issue_id)
                return # SUCCESS
            else:
                last_err = f"HTTP {response.status_code}: {resp_text}"
                print(f"[EMAIL-FAILURE] {last_err}")
                # Continue loop to next retry
        except Exception as e:
            last_err = str(e)
            print(f"[EMAIL-ERROR] {last_err}")
            # Continue loop to next retry

    # If we are here, all attempts failed
    _log_email_attempt(log_id, to_email, subject, "failed", error=last_err, retry_count=attempt, issue_id=issue_id)

# ── Templates & Wrappers ─────────────────────────

def send_verification_otp_email(background_tasks, to_email: str, otp: str):
    """Non-blocking OTP send."""
    subject = f"Your RESOLVIT Verification Code: {otp}"
    html = _get_premium_shell(
        title="Verify your identity",
        body=f"""
            Use the secure verification code below to complete your registration on the <span style="color: #818cf8; font-weight:600;">RESOLVIT</span> Civic Governance Platform.
            <div style="margin: 32px 0; padding: 24px; background: rgba(255, 255, 255, 0.05); border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.1); text-align: center;">
                <div style="font-family: monospace; font-size: 48px; font-weight: 800; color: #818cf8; letter-spacing: 0.1em;">{otp}</div>
            </div>
            <p style="font-size: 14px; opacity: 0.8;">This code will expire in <strong>{OTP_EXPIRE_MINUTES} minutes</strong>.</p>
            <p style="color: #f43f5e; font-size: 13px; margin-top: 24px; font-weight: 500;">Do not share this code. Our security staff will never ask for it.</p>
        """
    )
    background_tasks.add_task(dispatch_email_task, to_email, subject, html, template_name="otp")

def send_issue_update_email(background_tasks, to_email: str, name: str, issue_data: dict):
    """Standardized Premium Issue Update."""
    status_label = issue_data['status'].upper()
    status_color = "#10b981" if status_label == "RESOLVED" else "#6366f1"
    
    subject = f"RESOLVIT Update: {issue_data['title']}"
    html = _get_premium_shell(
        title="Operation Update",
        body=f"""
            Hello {name},<br><br>
            There is a system update regarding your report: <strong>{issue_data['title']}</strong>.<br><br>
            <div style="display:inline-block; padding: 10px 20px; background: {status_color}; color:#fff; border-radius: 6px; font-weight:bold; font-size:14px;">
                STATUS: {status_label}
            </div>
            <br><br>
            <p style="font-size: 15px; color: #cbd5e1; line-height: 1.6;">
                The relevant department has been engaged. You can monitor the live resolution thread and SLA status via your personal command dashboard.
            </p>
            <p style="font-size: 13px; color: #94a3b8; margin-top: 20px; font-style: italic;">
                Ref ID: {issue_data['id']}
            </p>
        """
    )
    background_tasks.add_task(dispatch_email_task, to_email, subject, html, issue_id=issue_data['id'], template_name="issue_update")

def send_care_dispatch_email(background_tasks, to_email: str, subject: str, message_body: str, report_id: str):
    """Branded Care/Humanitarian notification."""
    html = _get_premium_shell(
        title="Care Dispatch Update",
        body=f"""
            {message_body}
            <br><br>
            <p style="font-size:13px; color:#94a3b8; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; margin-top:20px;">
                This is an official communication from the <strong>Resolvit Care</strong> operational team.
            </p>
        """
    )
    background_tasks.add_task(dispatch_email_task, to_email, subject, html, issue_id=report_id, template_name="care_update")

def _get_premium_shell(title: str, body: str) -> str:
    """Helper to maintain Elite-Standard visual identity across all communication."""
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body {{ background-color: #0f172a; margin: 0; padding: 0; font-family: 'Inter', system-ui, sans-serif; }}
            .container {{ max-width: 600px; margin: 40px auto; background-color: #1e293b; border-radius: 16px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.1); }}
            .header {{ padding: 30px; text-align: center; background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); }}
            .header h1 {{ margin: 0; color: #ffffff; font-size: 24px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; }}
            .content {{ padding: 40px; color: #f1f5f9; }}
            .footer {{ padding: 25px; background-color: #0f172a; text-align: center; color: #64748b; font-size: 13px; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header"><h1>RESOLVIT</h1></div>
            <div class="content">
                <h2 style="color: #ffffff; margin-top: 0; font-size: 20px;">{title}</h2>
                <div style="line-height: 1.7; font-size: 16px; color: #cbd5e1;">{body}</div>
            </div>
            <div class="footer">
                &copy; 2026 RESOLVIT AI. Digital Civic Intelligence Stack.
            </div>
        </div>
    </body>
    </html>
    """

def get_email_health_stats() -> Dict[str, Any]:
    """Retrieves delivery intelligence for the Admin dashboard."""
    try:
        with get_db() as cursor:
            cursor.execute("""
                SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE status = 'sent') as sent,
                    COUNT(*) FILTER (WHERE status = 'failed') as failed,
                    COUNT(*) FILTER (WHERE status = 'retrying') as retrying,
                    AVG(retry_count) as avg_retries
                FROM email_audit_logs 
                WHERE created_at > NOW() - INTERVAL '24 hours'
            """)
            return dict(cursor.fetchone())
    except: return {"error": "Stats unavailable"}

# LEGACY COMPATIBILITY - Wraps for direct calling if needed (sync)
def send_email(to_email: str, subject: str, html_content: str, issue_id: Optional[str] = None) -> bool:
    """Synchronous fallback for legacy or non-FastAPI paths."""
    print(f"[EMAIL-LEGACY] Dispatching {subject} sync")
    dispatch_email_task(to_email, subject, html_content, issue_id=issue_id, template_name="legacy")
    return True


# ── Welcome Email Service ─────────────────────────────────────────

APP_BASE_URL = os.getenv("APP_BASE_URL", "https://www.resolvit-ai.online")


def should_send_welcome_email(user_id: str) -> bool:
    """
    Atomically check and claim the welcome email slot.
    Uses UPDATE ... WHERE to prevent race conditions from concurrent logins.
    Returns True if this call won the slot (email should be sent).
    Returns False if already sent or claimed by another process.
    """
    try:
        with get_db() as cursor:
            cursor.execute(
                """
                UPDATE users 
                SET welcome_email_status = 'sending'
                WHERE id = %s 
                  AND welcome_email_sent = FALSE 
                  AND welcome_email_status IN ('pending', 'failed')
                RETURNING id
                """,
                (user_id,)
            )
            claimed = cursor.fetchone()
            if claimed:
                print(f"[WELCOME-EMAIL] Slot claimed for user {user_id}")
                return True
            else:
                print(f"[WELCOME-EMAIL] Already sent/claimed for user {user_id}, skipping")
                return False
    except Exception as e:
        print(f"[WELCOME-EMAIL] Error checking eligibility: {e}")
        return False


def mark_welcome_email_sent(user_id: str, message_id: Optional[str] = None):
    """Mark user record as having received the welcome email."""
    try:
        with get_db() as cursor:
            cursor.execute(
                """
                UPDATE users 
                SET welcome_email_sent = TRUE, 
                    welcome_email_sent_at = NOW(), 
                    welcome_email_message_id = %s,
                    welcome_email_status = 'sent'
                WHERE id = %s
                """,
                (message_id, user_id)
            )
        print(f"[WELCOME-EMAIL] Marked sent for user {user_id} (msg_id: {message_id})")
    except Exception as e:
        print(f"[CRITICAL-DB] Failed to mark welcome email sent: {e}")


def mark_welcome_email_failed(user_id: str, error: str):
    """Mark welcome email as failed so it can be retried later."""
    try:
        with get_db() as cursor:
            cursor.execute(
                """
                UPDATE users 
                SET welcome_email_status = 'failed'
                WHERE id = %s
                """,
                (user_id,)
            )
        print(f"[WELCOME-EMAIL] Marked failed for user {user_id}: {error}")
    except Exception as e:
        print(f"[CRITICAL-DB] Failed to mark welcome email failed: {e}")


def _build_welcome_html(user_name: str, provider: str = "database") -> str:
    """Build the premium branded welcome email HTML."""
    provider_line = ""
    if provider and provider != "database":
        provider_display = provider.replace("_", " ").replace("-", " ").title()
        provider_line = f'<p style="font-size: 14px; color: #a78bfa; margin-top: 16px;">Your account was created securely using <strong>{provider_display}</strong> authentication.</p>'
    else:
        provider_line = '<p style="font-size: 14px; color: #a78bfa; margin-top: 16px;">Your account was created using secure Resolvit login.</p>'

    dashboard_url = f"{APP_BASE_URL}/dashboard.html"

    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {{ background-color: #0f172a; margin: 0; padding: 0; font-family: 'Inter', system-ui, -apple-system, sans-serif; }}
            .container {{ max-width: 600px; margin: 40px auto; background-color: #1e293b; border-radius: 16px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.08); }}
            .header {{ padding: 40px 0; text-align: center; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%); }}
            .header h1 {{ margin: 0; color: #ffffff; font-size: 28px; font-weight: 800; text-transform: uppercase; letter-spacing: 3px; }}
            .header p {{ margin: 8px 0 0; color: rgba(255,255,255,0.8); font-size: 14px; font-weight: 400; }}
            .content {{ padding: 48px 40px; color: #e2e8f0; }}
            .greeting {{ font-size: 22px; font-weight: 700; color: #ffffff; margin: 0 0 20px; }}
            .body-text {{ font-size: 16px; line-height: 1.7; color: #cbd5e1; margin-bottom: 28px; }}
            .features {{ background: rgba(255, 255, 255, 0.03); border-radius: 12px; padding: 24px; border: 1px solid rgba(255, 255, 255, 0.06); margin-bottom: 28px; }}
            .feature-item {{ padding: 10px 0; font-size: 15px; color: #e2e8f0; line-height: 1.5; }}
            .feature-icon {{ margin-right: 10px; }}
            .care-box {{ background: linear-gradient(135deg, rgba(168, 85, 247, 0.08), rgba(99, 102, 241, 0.08)); border-radius: 12px; padding: 20px 24px; border: 1px solid rgba(168, 85, 247, 0.15); margin-bottom: 28px; }}
            .care-title {{ font-size: 16px; font-weight: 700; color: #c084fc; margin: 0 0 8px; }}
            .care-text {{ font-size: 14px; color: #cbd5e1; line-height: 1.6; margin: 0; }}
            .cta-btn {{ display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: #ffffff; padding: 16px 36px; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 15px; margin: 24px 0; box-shadow: 0 8px 20px rgba(99, 102, 241, 0.3); }}
            .closing {{ font-size: 15px; color: #94a3b8; line-height: 1.6; margin-top: 24px; }}
            .footer {{ padding: 28px 40px; background-color: #0f172a; text-align: center; color: #475569; font-size: 13px; line-height: 1.5; border-top: 1px solid rgba(255, 255, 255, 0.05); }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>RESOLVIT</h1>
                <p>AI-Powered Civic Intelligence Platform</p>
            </div>
            <div class="content">
                <h2 class="greeting">Hi {user_name},</h2>
                <p class="body-text">
                    Welcome to <strong style="color: #818cf8;">Resolvit AI</strong> &mdash; your AI-powered civic issue resolution platform.
                    We're thrilled to have you on board.
                </p>
                <p class="body-text">
                    Resolvit helps citizens report local issues, track progress, receive real-time updates, and stay connected until problems are resolved.
                </p>
                <div class="features">
                    <div class="feature-item"><span class="feature-icon">&#x2705;</span> Report civic issues easily</div>
                    <div class="feature-item"><span class="feature-icon">&#x1F50D;</span> Track complaint progress in real-time</div>
                    <div class="feature-item"><span class="feature-icon">&#x1F4EC;</span> Receive status updates via email</div>
                    <div class="feature-item"><span class="feature-icon">&#x1F916;</span> Use Resolvit AI Copilot for smarter reporting</div>
                    <div class="feature-item"><span class="feature-icon">&#x1F6E1;</span> Stay connected through a secure verified account</div>
                </div>
                <div class="care-box">
                    <p class="care-title">&#x1F49C; Resolvit Care</p>
                    <p class="care-text">
                        Resolvit Care extends this mission by connecting citizens, NGOs, volunteers, and administrators to respond faster to community needs and social support cases.
                    </p>
                </div>
                {provider_line}
                <div style="text-align: center;">
                    <a href="{dashboard_url}" class="cta-btn">Open Resolvit Dashboard</a>
                </div>
                <p class="closing">
                    We're glad to have you with us.<br><br>
                    Regards,<br>
                    <strong style="color: #e2e8f0;">Team Resolvit</strong>
                </p>
            </div>
            <div class="footer">
                &copy; 2026 RESOLVIT AI. Digital Civic Intelligence Stack.<br>
                This is a one-time welcome email. You will not receive it again.
            </div>
        </div>
    </body>
    </html>
    """


def dispatch_welcome_email_task(user_id: str, to_email: str, user_name: str, provider: str = "database"):
    """
    THE WELCOME EMAIL BACKGROUND WORKER.
    Sends the welcome email via Resend with full audit trail and duplicate prevention.
    Called as a background task from auth routes.
    """
    print(f"[WELCOME-EMAIL] dispatch_welcome_email_task started for {to_email} (user_id: {user_id}, provider: {provider})")

    if not EMAIL_ENABLED:
        print(f"[WELCOME-EMAIL-MOCK] Welcome email to {to_email} (EMAIL_ENABLED=false)")
        mark_welcome_email_sent(user_id, "mock-disabled")
        return

    # Validate API key
    if not RESEND_API_KEY or is_placeholder(RESEND_API_KEY):
        error_msg = "Invalid RESEND_API_KEY"
        _log_email_attempt(None, to_email, "Welcome to Resolvit AI 🚀", "failed", error=error_msg, template_name="welcome")
        mark_welcome_email_failed(user_id, error_msg)
        return

    subject = "Welcome to Resolvit AI 🚀"
    html = _build_welcome_html(user_name, provider)

    # Create initial audit log
    log_id = _log_email_attempt(None, to_email, subject, "pending", template_name="welcome")

    payload = {
        "from": f"RESOLVIT <{RESEND_FROM_EMAIL}>",
        "to": [to_email],
        "subject": subject,
        "html": html
    }

    max_retries = 3
    backoff_seconds = [1, 3, 5]
    last_err = "Unknown error"

    for attempt in range(max_retries + 1):
        if attempt > 0:
            print(f"[WELCOME-EMAIL-RETRY] Attempt {attempt} for {to_email} after {backoff_seconds[attempt-1]}s")
            time.sleep(backoff_seconds[attempt - 1])
            _log_email_attempt(log_id, to_email, subject, "retrying", retry_count=attempt)

        try:
            import requests as req_lib
            response = req_lib.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {RESEND_API_KEY}",
                    "Content-Type": "application/json"
                },
                json=payload,
                timeout=12
            )

            resp_text = response.text
            if response.status_code in [200, 201, 202, 204]:
                # Extract Resend message ID
                resend_msg_id = None
                try:
                    resend_msg_id = json.loads(resp_text).get("id")
                except:
                    pass

                print(f"[WELCOME-EMAIL-SUCCESS] Sent to {to_email} (resend_id: {resend_msg_id})")
                _log_email_attempt(log_id, to_email, subject, "sent", success=True, response_body=resp_text, retry_count=attempt)
                mark_welcome_email_sent(user_id, resend_msg_id)
                return  # SUCCESS

            else:
                last_err = f"HTTP {response.status_code}: {resp_text}"
                print(f"[WELCOME-EMAIL-FAILURE] {last_err}")
                # 4xx errors (except 429) should not be retried
                if 400 <= response.status_code < 500 and response.status_code != 429:
                    _log_email_attempt(log_id, to_email, subject, "failed", error=last_err, retry_count=attempt)
                    mark_welcome_email_failed(user_id, last_err)
                    return

        except Exception as e:
            last_err = str(e)
            print(f"[WELCOME-EMAIL-ERROR] {last_err}")

    # All attempts exhausted
    _log_email_attempt(log_id, to_email, subject, "failed", error=last_err, retry_count=max_retries)
    mark_welcome_email_failed(user_id, last_err)


def trigger_welcome_email(background_tasks, user_id: str, email: str, name: str, provider: str = "database"):
    """
    Public API: Called from auth routes after user creation.
    Checks eligibility atomically, then dispatches the email as a background task.
    Login response is NOT blocked.
    """
    if not should_send_welcome_email(user_id):
        return  # Already sent or claimed

    print(f"[WELCOME-EMAIL] Scheduling background dispatch for {email}")
    background_tasks.add_task(dispatch_welcome_email_task, str(user_id), email, name, provider)
