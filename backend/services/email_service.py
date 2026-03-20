"""
RESOLVIT - Email Service
Handles sending emails including password reset notifications
"""
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional
from datetime import datetime
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


def send_issue_update_email(to_email: str, username: str, issue_data: dict) -> bool:
    """
    Send an update email to the citizen about their reported issue.
    """
    issue_id = issue_data.get("tracking_id") or issue_data.get("id", "N/A")
    title = issue_data.get("title", "Civic Issue")
    status = issue_data.get("status", "updated").replace("_", " ").title()
    category = issue_data.get("category", "General")
    note = issue_data.get("resolution_note") or "No additional notes provided."
    location = issue_data.get("address") or "Indexed Location"
    reported_date = issue_data.get("created_at", "N/A")
    updated_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Format tracking link if possible
    tracking_link = f"https://resolvit-ai.online/issue.html?id={issue_data.get('id')}"
    
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
                <p style="color: #64748b; margin: 0; font-size: 16px;">Hi {username}, there is an update on your complaint.</p>
            </div>
            
            <div style="background: #f1f5f9; border-radius: 12px; padding: 24px; margin-bottom: 32px; border-left: 4px solid #6366f1;">
                <h2 style="margin: 0 0 16px 0; font-size: 18px; color: #1e293b;">Issue Summary</h2>
                <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 6px 0; color: #64748b; width: 140px;"><strong>Tracking ID:</strong></td>
                        <td style="padding: 6px 0; color: #1e293b;">{issue_id}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 0; color: #64748b;"><strong>Current Status:</strong></td>
                        <td style="padding: 6px 0;"><span style="background: #6366f1; color: white; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 12px;">{status}</span></td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 0; color: #64748b;"><strong>Title:</strong></td>
                        <td style="padding: 6px 0; color: #1e293b;">{title}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 0; color: #64748b;"><strong>Category:</strong></td>
                        <td style="padding: 6px 0; color: #1e293b;">{category}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 0; color: #64748b;"><strong>Location:</strong></td>
                        <td style="padding: 6px 0; color: #1e293b;">{location}</td>
                    </tr>
                </table>
            </div>

            <div style="margin-bottom: 32px;">
                <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #1e293b;">Official Authority Note:</h3>
                <div style="background: #fdf2f2; border: 1px solid #fee2e2; border-radius: 8px; padding: 16px; font-size: 14px; line-height: 1.6; color: #475569;">
                    {note}
                </div>
            </div>

            <div style="text-align: center; margin-bottom: 32px;">
                <a href="{tracking_link}" style="display: inline-block; background: #6366f1; color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 700; font-size: 15px; box-shadow: 0 10px 15px -3px rgba(99,102,241,0.3);">Track Current Status</a>
            </div>

            <div style="border-top: 1px solid #f1f5f9; padding-top: 24px; text-align: center;">
                <p style="color: #94a3b8; font-size: 12px; margin: 0 0 8px 0;">
                    Reported on: {reported_date} | Updated at: {updated_date}
                </p>
                <p style="color: #64748b; font-size: 13px; font-weight: 600; margin: 0;">
                    RESOLVIT Admin Control Tower
                </p>
            </div>
        </div>
        <div style="text-align: center; margin-top: 24px; color: #94a3b8; font-size: 11px;">
            This is an automated governance alert. Please do not reply directly to this email.
        </div>
    </body>
    </html>
    """
    
    text_body = f"""
    RESOLVIT UPDATE: Complaint {issue_id}
    
    Hi {username},
    
    There is an update on your civic complaint.
    
    Summary:
    - ID: {issue_id}
    - Status: {status}
    - Title: {title}
    - Category: {category}
    - Location: {location}
    
    Official Note:
    {note}
    
    Track status here: {tracking_link}
    
    Reported on: {reported_date}
    Updated at: {updated_date}
    
    RESOLVIT Admin Control Tower
    """
    
    return send_email(to_email, subject, html_body, text_body)

