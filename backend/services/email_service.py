"""
RESOLVIT - Email Service
Handles sending emails including password reset notifications
"""
import os
import resend
from typing import Optional
from datetime import datetime
import logging
from database import get_db

logger = logging.getLogger(__name__)

# Email configuration from environment
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_FROM = os.getenv("RESEND_FROM_EMAIL", "RESOLVIT <updates@resolvit-ai.online>")
EMAIL_ENABLED = os.getenv("EMAIL_ENABLED", "false").lower() == "true"

# Initialize Resend
if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY


def _log_email_to_db(issue_id: Optional[str], recipient: str, subject: str, success: bool, error: Optional[str] = None):
    """Log email attempt to the database for auditing."""
    try:
        with get_db() as cursor:
            cursor.execute(
                """
                INSERT INTO email_audit_logs (issue_id, email_sent, recipient, subject, error_message)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (issue_id, success, recipient, subject, error)
            )
    except Exception as e:
        logger.error(f"Failed to log email to audit table: {str(e)}")


def send_email(to_email: str, subject: str, html_body: str, issue_id: Optional[str] = None) -> bool:
    """
    Send an email via Resend API.
    """
    if not EMAIL_ENABLED or not RESEND_API_KEY:
        logger.warning(f"Email not enabled or API key missing. Would send to {to_email}: {subject}")
        return False
    
    try:
        params = {
            "from": RESEND_FROM,
            "to": [to_email],
            "subject": subject,
            "html": html_body,
        }
        
        r = resend.Emails.send(params)
        success = bool(r.get("id"))
        
        if success:
            logger.info(f"Email sent successfully to {to_email} (ID: {r['id']})")
            _log_email_to_db(issue_id, to_email, subject, True)
            return True
        else:
            logger.error(f"Resend returned unexpected response: {r}")
            _log_email_to_db(issue_id, to_email, subject, False, "Unexpected API response")
            return False
            
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Failed to send email to {to_email} via Resend: {error_msg}")
        _log_email_to_db(issue_id, to_email, subject, False, error_msg)
        return False


def send_password_reset_email(to_email: str, reset_token: str, username: str) -> bool:
    """
    Send a password reset email to the user.
    """
    reset_link = f"https://resolvit-ai.online/reset-password.html?token={reset_token}"
    
    # For local development
    if os.getenv("RENDER") is None:
        reset_link = f"http://localhost:5500/frontend/reset-password.html?token={reset_token}"
    
    subject = "🔐 Reset Your RESOLVIT Password"
    
    html_body = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset - RESOLVIT</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5; padding: 20px;">
        <div style="max-width: 500px; margin: 0 auto; background: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 24px;">
                <div style="font-size: 48px; margin-bottom: 16px;">🔐</div>
                <h1 style="color: #1E3A8A; margin: 0 0 8px 0; font-size: 24px;">Reset Your Password</h1>
                <p style="color: #64748b; margin: 0;">Hi {username}, we received a request to reset your password.</p>
            </div>
            
            <div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                <p style="color: #334155; margin: 0 0 16px 0;">Click the button below to create a new password:</p>
                <a href="{reset_link}" style="display: inline-block; background: #1E3A8A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; text-align: center;">Reset Password</a>
            </div>
            
            <p style="color: #94a3b8; font-size: 14px; margin: 0 0 8px 0;">
                This link will expire in 30 minutes for your security.
            </p>
            
            <p style="color: #94a3b8; font-size: 14px; margin: 0 0 16px 0;">
                If you didn't request a password reset, you can safely ignore this email.
            </p>
            
            <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center;">
                <p style="color: #94a3b8; font-size: 12px; margin: 0;">
                    © 2024 RESOLVIT - Civic Resolution Platform
                </p>
            </div>
        </div>
    </body>
    </html>
    """
    
    return send_email(to_email, subject, html_body)


def send_welcome_email(to_email: str, username: str, role: str) -> bool:
    """
    Send a welcome email to new users.
    """
    role_display = {
        "citizen": "Citizen",
        "authority": "Authority", 
        "admin": "Administrator"
    }.get(role, "User")
    
    subject = f"Welcome to RESOLVIT, {username}!"
    
    html_body = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome - RESOLVIT</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5; padding: 20px;">
        <div style="max-width: 500px; margin: 0 auto; background: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 24px;">
                <div style="font-size: 48px; margin-bottom: 16px;">⚖️</div>
                <h1 style="color: #1E3A8A; margin: 0 0 8px 0; font-size: 24px;">Welcome to RESOLVIT!</h1>
                <p style="color: #64748b; margin: 0;">Hi {username}, your account has been created successfully.</p>
            </div>
            
            <div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                <p style="color: #334155; margin: 0 0 8px 0;"><strong>Account Details:</strong></p>
                <ul style="color: #334155; margin: 0; padding-left: 20px;">
                    <li>Username: {username}</li>
                    <li>Role: {role_display}</li>
                    <li>Email: {to_email}</li>
                </ul>
            </div>
            
            <p style="color: #64748b; margin: 0 0 16px 0;">
                You can now report civic issues and track their resolution. Together, we can make our city better!
            </p>
            
            <div style="text-align: center;">
                <a href="https://resolvit-ai.online/dashboard.html" style="display: inline-block; background: #1E3A8A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600;">Go to Dashboard</a>
            </div>
            
            <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; margin-top: 24px;">
                <p style="color: #94a3b8; font-size: 12px; margin: 0;">
                    © 2024 RESOLVIT - Civic Resolution Platform
                </p>
            </div>
        </div>
    </body>
    </html>
    """
    
    return send_email(to_email, subject, html_body)


def send_issue_update_email(to_email: str, username: str, issue_data: dict) -> bool:
    """
    Send an update email to the citizen about their reported issue.
    """
    issue_id = issue_data.get("id", "N/A")
    title = issue_data.get("title", "Civic Issue")
    prev_status = issue_data.get("old_status", "N/A").replace("_", " ").title()
    new_status = issue_data.get("status", "N/A").replace("_", " ").title()
    category = issue_data.get("category", "General")
    note = issue_data.get("resolution_note") or issue_data.get("note") or "No additional notes provided."
    location = issue_data.get("address") or f"{issue_data.get('latitude')}, {issue_data.get('longitude')}"
    reported_date = issue_data.get("created_at", "N/A")
    updated_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Format tracking link
    tracking_link = f"https://resolvit-ai.online/dashboard"
    
    subject = f"Update on your RESOLVIT complaint - {issue_id}"
    
    html_body = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Issue Update - RESOLVIT</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); border: 1px solid #e2e8f0;">
            <div style="text-align: center; margin-bottom: 32px;">
                <div style="font-size: 48px; margin-bottom: 16px;">⚖️</div>
                <h1 style="color: #6366f1; margin: 0 0 8px 0; font-size: 26px; font-weight: 800;">RESOLVIT Update</h1>
                <p style="color: #64748b; margin: 0; font-size: 16px;">Hello {username},</p>
                <p style="color: #64748b; margin: 0; font-size: 16px;">Your reported issue has been updated.</p>
            </div>
            
            <div style="background: #f1f5f9; border-radius: 12px; padding: 24px; margin-bottom: 32px; border-left: 4px solid #6366f1;">
                <h2 style="margin: 0 0 16px 0; font-size: 18px; color: #1e293b;">Issue Summary</h2>
                <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 6px 0; color: #64748b; width: 140px;"><strong>Issue ID:</strong></td>
                        <td style="padding: 6px 0; color: #1e293b;">{issue_id}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 0; color: #64748b;"><strong>Title:</strong></td>
                        <td style="padding: 6px 0; color: #1e293b;">{title}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 0; color: #64748b;"><strong>Category:</strong></td>
                        <td style="padding: 6px 0; color: #1e293b;">{category}</td>
                    </tr>
                </table>
            </div>

            <div style="margin-bottom: 32px;">
                <table style="width: 100%; font-size: 15px; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 12px; background: #fee2e2; border-radius: 8px 0 0 8px; width: 50%; text-align: center;">
                            <div style="color: #991b1b; font-size: 12px; font-weight: 700; margin-bottom: 4px;">PREVIOUS STATUS</div>
                            <div style="color: #b91c1c; font-weight: 800;">{prev_status}</div>
                        </td>
                        <td style="padding: 12px; background: #dcfce7; border-radius: 0 8px 8px 0; width: 50%; text-align: center;">
                            <div style="color: #166534; font-size: 12px; font-weight: 700; margin-bottom: 4px;">NEW STATUS</div>
                            <div style="color: #15803d; font-weight: 800;">{new_status}</div>
                        </td>
                    </tr>
                </table>
            </div>

            <div style="margin-bottom: 32px;">
                <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #1e293b;">Admin Note:</h3>
                <div style="background: #fdf2f2; border: 1px solid #fee2e2; border-radius: 8px; padding: 16px; font-size: 14px; line-height: 1.6; color: #475569;">
                    {note}
                </div>
            </div>

            <div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 32px; font-size: 13px;">
                <div style="margin-bottom: 8px;"><strong style="color: #64748b;">Location:</strong> <span style="color: #1e293b;">{location}</span></div>
                <div style="margin-bottom: 8px;"><strong style="color: #64748b;">Reported On:</strong> <span style="color: #1e293b;">{reported_date}</span></div>
                <div><strong style="color: #64748b;">Last Updated:</strong> <span style="color: #1e293b;">{updated_date}</span></div>
            </div>

            <div style="text-align: center; margin-bottom: 32px;">
                <p style="color: #64748b; font-size: 14px; margin-bottom: 16px;">Track your issue:</p>
                <a href="{tracking_link}" style="display: inline-block; background: #6366f1; color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 700; font-size: 15px; box-shadow: 0 10px 15px -3px rgba(99,102,241,0.3);">Go to dashboard</a>
            </div>

            <div style="border-top: 1px solid #f1f5f9; padding-top: 24px; text-align: center;">
                <p style="color: #64748b; font-size: 14px; margin: 0 0 8px 0;">
                    Thank you,<br>
                    <strong>RESOLVIT Team</strong>
                </p>
            </div>
        </div>
        <div style="text-align: center; margin-top: 24px; color: #94a3b8; font-size: 11px;">
            This is an automated governance alert. Please do not reply directly to this email.
        </div>
    </body>
    </html>
    """
    
    return send_email(to_email, subject, html_body, issue_id=issue_id)

