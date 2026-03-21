"""
RESOLVIT - Email Service
Handles sending emails including password reset notifications
"""
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# Email configuration from environment
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "RESOLVIT <noreply@resolvit.gov>")

# Fallback mode when SMTP is not configured
EMAIL_ENABLED = bool(SMTP_USER and SMTP_PASSWORD)


def send_email(to_email: str, subject: str, html_body: str, text_body: Optional[str] = None) -> bool:
    """
    Send an email to the specified recipient.
    
    Args:
        to_email: Recipient email address
        subject: Email subject line
        html_body: HTML content of the email
        text_body: Plain text fallback (optionals)
    
    Returns:
        True if email was sent successfully, False otherwise
    """
    if not EMAIL_ENABLED:
        logger.warning(f"Email not enabled. Would send to {to_email}: {subject}")
        # Log the email content for debugging
        logger.debug(f"Email content: {html_body}")
        return False
    
    try:
        # Create message
        msg = MIMEMultipart('alternative')
        msg['From'] = SMTP_FROM
        msg['To'] = to_email
        msg['Subject'] = subject
        
        # Attach plain text and HTML parts
        if text_body:
            msg.attach(MIMEText(text_body, 'plain'))
        msg.attach(MIMEText(html_body, 'html'))
        
        # Connect to SMTP server and send
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_FROM, to_email, msg.as_string())
        
        logger.info(f"Email sent successfully to {to_email}")
        return True
    
    except Exception as e:
        logger.error(f"Failed to send email to {to_email}: {str(e)}")
        return False


def send_password_reset_email(to_email: str, reset_token: str, username: str) -> bool:
    """
    Send a password reset email to the user.
    
    Args:
        to_email: User's email address
        reset_token: JWT token for password reset
        username: User's username
    
    Returns:
        True if email was sent successfully, False otherwise
    """
    # In production, this would be your actual domain
    reset_link = f"https://synaptix.vercel.app/reset-password.html?token={reset_token}"
    
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
    
    text_body = f"""
    Reset Your RESOLVIT Password
    
    Hi {username},
    
    We received a request to reset your password.
    
    Click the link below to create a new password:
    {reset_link}
    
    This link will expire in 30 minutes for your security.
    
    If you didn't request a password reset, you can safely ignore this email.
    
    © 2024 RESOLVIT - Civic Resolution Platform
    """
    
    return send_email(to_email, subject, html_body, text_body)


def send_welcome_email(to_email: str, username: str, role: str) -> bool:
    """
    Send a welcome email to new users.
    
    Args:
        to_email: User's email address
        username: User's username
        role: User's role (citizen, authority, admin)
    
    Returns:
        True if email was sent successfully, False otherwise
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
                <a href="https://synaptix.vercel.app/dashboard.html" style="display: inline-block; background: #1E3A8A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600;">Go to Dashboard</a>
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

