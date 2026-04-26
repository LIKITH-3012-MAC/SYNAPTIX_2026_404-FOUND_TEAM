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

def send_issue_update_email(background_tasks, to_email: str, name: str, issue_data: dict,
                            admin_note: Optional[str] = None, updated_by_name: Optional[str] = None):
    """
    Premium government-grade issue update email.
    Dispatches a richly-formatted update email to the citizen reporter
    with status transition, admin notes, AI insights, and resolution details.
    """
    status = str(issue_data.get('status', 'updated')).lower()
    title = issue_data.get('title', 'Your Issue')
    old_status = str(issue_data.get('old_status', '')).lower()

    # ── Dynamic Subject Lines ──
    subject_map = {
        'assigned':    f"📌 Resolvit Update: Your issue has been assigned — {title}",
        'in_progress': f"🔧 Resolvit Update: Work has started — {title}",
        'escalated':   f"🚨 Resolvit Alert: Your issue has been escalated — {title}",
        'resolved':    f"✅ Resolvit Resolution: {title}",
        'verified':    f"✔️ Resolvit Update: Your issue has been verified — {title}",
        'archived':    f"📁 Resolvit Update: Your issue has been archived — {title}",
    }
    subject = subject_map.get(status, f"⚖️ Resolvit Update: {title}")

    # ── Template Type for Audit ──
    template_map = {
        'resolved': 'issue_resolved',
        'escalated': 'issue_escalated',
        'assigned': 'issue_assigned',
    }
    template_name = template_map.get(status, 'issue_update')

    html = _build_issue_update_html(
        name=name,
        issue_data=issue_data,
        old_status=old_status,
        new_status=status,
        admin_note=admin_note,
        updated_by_name=updated_by_name
    )

    background_tasks.add_task(
        dispatch_email_task, to_email, subject, html,
        issue_id=str(issue_data.get('id', '')),
        template_name=template_name
    )


def _get_status_color(status: str) -> str:
    """Maps issue status to a hex color."""
    colors = {
        'reported': '#6366f1', 'verified': '#8b5cf6', 'assigned': '#3b82f6',
        'in_progress': '#f59e0b', 'escalated': '#ef4444', 'resolved': '#10b981',
        'archived': '#64748b', 'clustered': '#a855f7',
    }
    return colors.get(status.lower(), '#6366f1')


def _get_status_explanation(status: str) -> str:
    """Human-readable explanation of what a status means."""
    explanations = {
        'reported':    'Your issue has been received and logged into the system.',
        'verified':    'Your issue has been reviewed and verified as a valid civic report.',
        'assigned':    'The responsible authority/department has been notified and assigned.',
        'in_progress': 'Active work has started on resolving your reported issue.',
        'escalated':   'The issue has been escalated to a higher authority for priority resolution.',
        'resolved':    'Your reported issue has been marked as successfully resolved.',
        'archived':    'This issue has been archived after review or resolution.',
    }
    return explanations.get(status.lower(), 'Your issue status has been updated.')


def _build_issue_update_html(name: str, issue_data: dict, old_status: str = '',
                              new_status: str = '', admin_note: Optional[str] = None,
                              updated_by_name: Optional[str] = None) -> str:
    """
    Build a premium, government-grade HTML email for issue updates.
    Light-background, card-based, mobile-responsive, Gmail/Outlook safe.
    All CSS is inline. Unicode-safe for multilingual content.
    """
    FRONTEND_URL = os.getenv("FRONTEND_URL", os.getenv("APP_BASE_URL", "https://www.resolvit-ai.online"))
    issue_id = str(issue_data.get('id', ''))
    tracking_id = issue_data.get('tracking_id', issue_id[:8].upper() if issue_id else '—')
    title = issue_data.get('title', 'Civic Report')
    category = issue_data.get('category', '—')
    address = issue_data.get('address') or issue_data.get('location_text', '—')
    created_at = str(issue_data.get('created_at', '—'))[:19].replace('T', ' ')
    updated_at = str(issue_data.get('updated_at', '—'))[:19].replace('T', ' ')

    old_color = _get_status_color(old_status)
    new_color = _get_status_color(new_status)
    explanation = _get_status_explanation(new_status)

    # ── Admin Note Section ──
    admin_note_html = ''
    if admin_note and admin_note.strip():
        admin_note_html = f'''
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
            <tr><td style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:24px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr><td style="font-size:15px;font-weight:700;color:#92400e;padding-bottom:8px;">📝 Message from {updated_by_name or 'Admin / Authority'}</td></tr>
                    <tr><td style="font-size:14px;color:#78350f;line-height:1.7;">{admin_note}</td></tr>
                </table>
            </td></tr>
        </table>
        '''

    # ── AI Intelligence Section ──
    ai_html = ''
    priority_score = issue_data.get('priority_score')
    if priority_score is not None and float(priority_score) > 0:
        urgency = issue_data.get('urgency', '—')
        impact = issue_data.get('impact_scale', '—')
        breach_risk = issue_data.get('breach_risk', 0)
        risk_pct = round(float(breach_risk) * 100) if breach_risk else 0
        sla_breached = issue_data.get('sla_breached', False)
        sla_label = '🔴 BREACHED' if sla_breached else '🟢 On Track'

        ai_html = f'''
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
            <tr><td style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:24px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr><td style="font-size:15px;font-weight:700;color:#0c4a6e;padding-bottom:12px;">🧠 Resolvit AI Insight</td></tr>
                    <tr><td>
                        <table width="100%" cellpadding="0" cellspacing="0" border="0">
                            <tr>
                                <td width="50%" style="padding:6px 0;font-size:13px;color:#475569;">Priority Score</td>
                                <td width="50%" style="padding:6px 0;font-size:14px;font-weight:700;color:#0f172a;">{int(float(priority_score))} / 100</td>
                            </tr>
                            <tr>
                                <td style="padding:6px 0;font-size:13px;color:#475569;">Urgency Level</td>
                                <td style="padding:6px 0;font-size:14px;font-weight:700;color:#0f172a;">{urgency} / 5</td>
                            </tr>
                            <tr>
                                <td style="padding:6px 0;font-size:13px;color:#475569;">Impact Scale</td>
                                <td style="padding:6px 0;font-size:14px;font-weight:700;color:#0f172a;">{impact}</td>
                            </tr>
                            <tr>
                                <td style="padding:6px 0;font-size:13px;color:#475569;">Breach Risk</td>
                                <td style="padding:6px 0;font-size:14px;font-weight:700;color:#0f172a;">{risk_pct}%</td>
                            </tr>
                            <tr>
                                <td style="padding:6px 0;font-size:13px;color:#475569;">SLA Status</td>
                                <td style="padding:6px 0;font-size:14px;font-weight:700;color:#0f172a;">{sla_label}</td>
                            </tr>
                        </table>
                    </td></tr>
                    <tr><td style="padding-top:10px;font-size:12px;color:#64748b;font-style:italic;">Prioritised using AI analysis of urgency, civic impact, safety risk, and SLA compliance.</td></tr>
                </table>
            </td></tr>
        </table>
        '''

    # ── Resolution Section ──
    resolution_html = ''
    if new_status == 'resolved':
        resolution_note = issue_data.get('resolution_note') or admin_note or 'Resolved by the assigned authority.'
        resolved_at = str(issue_data.get('resolved_at', updated_at))[:19].replace('T', ' ')
        resolution_html = f'''
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
            <tr><td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:24px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr><td style="font-size:15px;font-weight:700;color:#166534;padding-bottom:10px;">✅ Issue Resolution Summary</td></tr>
                    <tr>
                        <td style="font-size:13px;color:#475569;padding:4px 0;">Resolution Note</td>
                    </tr>
                    <tr>
                        <td style="font-size:14px;color:#0f172a;line-height:1.6;padding-bottom:10px;">{resolution_note}</td>
                    </tr>
                    <tr>
                        <td style="font-size:13px;color:#475569;padding:4px 0;">Resolved On</td>
                    </tr>
                    <tr>
                        <td style="font-size:14px;font-weight:600;color:#0f172a;">{resolved_at}</td>
                    </tr>
                    <tr><td style="padding-top:14px;font-size:13px;color:#16a34a;font-weight:500;">Thank you for using Resolvit. Your report helped improve civic accountability.</td></tr>
                </table>
            </td></tr>
        </table>
        '''

    # ── Location Section ──
    location_html = ''
    lat = issue_data.get('latitude')
    lng = issue_data.get('longitude')
    if address and address != '—':
        coords_line = f'<tr><td style="font-size:12px;color:#94a3b8;padding-top:4px;">{lat}, {lng}</td></tr>' if lat and lng else ''
        location_html = f'''
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
            <tr><td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr><td style="font-size:14px;font-weight:700;color:#334155;padding-bottom:6px;">📍 Issue Location</td></tr>
                    <tr><td style="font-size:14px;color:#0f172a;line-height:1.5;">{address}</td></tr>
                    {coords_line}
                </table>
            </td></tr>
        </table>
        '''

    # ── Status Transition ──
    old_badge = ''
    if old_status and old_status != new_status:
        old_badge = f'''
            <span style="display:inline-block;background:{old_color};color:#fff;padding:6px 16px;border-radius:6px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">{old_status.replace('_',' ')}</span>
            <span style="display:inline-block;padding:0 10px;font-size:18px;color:#94a3b8;">→</span>
        '''

    # ── Assigned Authority ──
    authority_line = ''
    auth_name = issue_data.get('authority_full_name') or issue_data.get('authority_name')
    auth_dept = issue_data.get('authority_department')
    if auth_name:
        dept_str = f' ({auth_dept})' if auth_dept else ''
        authority_line = f'''
        <tr>
            <td style="padding:10px 0;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9;">Assigned To</td>
            <td style="padding:10px 0;font-size:14px;font-weight:600;color:#0f172a;text-align:right;border-bottom:1px solid #f1f5f9;">{auth_name}{dept_str}</td>
        </tr>
        '''

    # ── Updated By ──
    updated_by_line = ''
    if updated_by_name:
        updated_by_line = f'''
        <tr>
            <td style="padding:10px 0;font-size:13px;color:#64748b;">Updated By</td>
            <td style="padding:10px 0;font-size:14px;font-weight:600;color:#0f172a;text-align:right;">{updated_by_name}</td>
        </tr>
        '''

    # ── FULL EMAIL HTML ──
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Resolvit Issue Update</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">

<!-- Wrapper -->
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:32px 16px;">
<tr><td align="center">

<!-- Container -->
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

    <!-- ═══ HEADER ═══ -->
    <tr><td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:36px 40px;text-align:center;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:3px;text-transform:uppercase;">⚖️ RESOLVIT</td></tr>
            <tr><td style="font-size:13px;color:rgba(255,255,255,0.8);padding-top:6px;letter-spacing:1px;">Civic Resolution Intelligence</td></tr>
        </table>
    </td></tr>

    <!-- ═══ SUBTITLE BAR ═══ -->
    <tr><td style="background:#4338ca;padding:14px 40px;text-align:center;">
        <span style="font-size:13px;color:rgba(255,255,255,0.9);font-weight:500;">Your reported issue has received an official update</span>
    </td></tr>

    <!-- ═══ BODY ═══ -->
    <tr><td style="padding:40px;">

        <!-- Greeting -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
            <tr><td style="font-size:18px;font-weight:700;color:#0f172a;">Hi {name},</td></tr>
            <tr><td style="font-size:14px;color:#475569;line-height:1.7;padding-top:10px;">
                Your reported issue has been updated by the Resolvit admin/authority team. We are keeping you informed so you can track every step from complaint to completion.
            </td></tr>
        </table>

        <!-- ═══ ISSUE SUMMARY CARD ═══ -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
            <tr><td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr><td colspan="2" style="font-size:16px;font-weight:800;color:#0f172a;padding-bottom:16px;border-bottom:2px solid #e2e8f0;">{title}</td></tr>
                    <tr>
                        <td style="padding:10px 0;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9;">Issue ID</td>
                        <td style="padding:10px 0;font-size:13px;font-weight:700;color:#6366f1;text-align:right;font-family:monospace;border-bottom:1px solid #f1f5f9;">#{tracking_id}</td>
                    </tr>
                    <tr>
                        <td style="padding:10px 0;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9;">Category</td>
                        <td style="padding:10px 0;font-size:14px;font-weight:600;color:#0f172a;text-align:right;border-bottom:1px solid #f1f5f9;">{category}</td>
                    </tr>
                    <tr>
                        <td style="padding:10px 0;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9;">Reported On</td>
                        <td style="padding:10px 0;font-size:14px;color:#0f172a;text-align:right;border-bottom:1px solid #f1f5f9;">{created_at}</td>
                    </tr>
                    <tr>
                        <td style="padding:10px 0;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9;">Last Updated</td>
                        <td style="padding:10px 0;font-size:14px;color:#0f172a;text-align:right;border-bottom:1px solid #f1f5f9;">{updated_at}</td>
                    </tr>
                    {authority_line}
                    {updated_by_line}
                </table>
            </td></tr>
        </table>

        <!-- ═══ STATUS TRANSITION ═══ -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
            <tr><td style="background:#fafafa;border:1px solid #e2e8f0;border-radius:12px;padding:24px;text-align:center;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr><td style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;padding-bottom:14px;">Status Transition</td></tr>
                    <tr><td style="padding-bottom:16px;">
                        {old_badge}
                        <span style="display:inline-block;background:{new_color};color:#fff;padding:6px 16px;border-radius:6px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">{new_status.replace('_',' ')}</span>
                    </td></tr>
                    <tr><td style="font-size:13px;color:#475569;line-height:1.6;">{explanation}</td></tr>
                </table>
            </td></tr>
        </table>

        <!-- ═══ ADMIN NOTE ═══ -->
        {admin_note_html}

        <!-- ═══ AI INTELLIGENCE ═══ -->
        {ai_html}

        <!-- ═══ LOCATION ═══ -->
        {location_html}

        <!-- ═══ RESOLUTION ═══ -->
        {resolution_html}

        <!-- ═══ CTA BUTTONS ═══ -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;margin-bottom:8px;">
            <tr>
                <td align="center" style="padding-bottom:12px;">
                    <a href="{FRONTEND_URL}/issue.html?id={issue_id}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;letter-spacing:0.3px;">Track Your Issue</a>
                </td>
            </tr>
            <tr>
                <td align="center">
                    <a href="{FRONTEND_URL}/dashboard.html" style="display:inline-block;background:#f1f5f9;color:#4f46e5;padding:12px 28px;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px;border:1px solid #e2e8f0;">Open Dashboard</a>
                </td>
            </tr>
        </table>

    </td></tr>

    <!-- ═══ FOOTER ═══ -->
    <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:28px 40px;text-align:center;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="font-size:12px;color:#94a3b8;line-height:1.8;">
                This is an automated governance notification from Resolvit.<br>
                Please do not reply directly to this email.
            </td></tr>
            <tr><td style="padding-top:12px;font-size:11px;color:#cbd5e1;">
                <strong style="color:#64748b;">RESOLVIT</strong> — From Complaint to Completion.<br>
                Civic technology for accountable action.
            </td></tr>
            <tr><td style="padding-top:10px;font-size:11px;color:#cbd5e1;">
                &copy; 2026 RESOLVIT AI. Digital Civic Intelligence Stack.
            </td></tr>
        </table>
    </td></tr>

</table>
<!-- /Container -->

</td></tr>
</table>
<!-- /Wrapper -->

</body>
</html>'''

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
