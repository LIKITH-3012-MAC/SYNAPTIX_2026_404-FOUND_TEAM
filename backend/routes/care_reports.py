import string
import random
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from typing import List
from datetime import datetime, timezone
from models import (
    ReportCreate, ReportResponse, ReportStatusUpdate, 
    ReportAssignNGO, ReportDispatchEmail, ReportNoteCreate, ReportResolve,
    UserResponse, UserRole, ReportStatus
)
from auth import require_roles, get_current_user
from database import get_db
from services.email_service import send_care_dispatch_email

router = APIRouter()

def generate_complaint_code():
    chars = string.ascii_uppercase + string.digits
    return 'RC-' + ''.join(random.choice(chars) for _ in range(8))

@router.post("/reports", response_model=ReportResponse, tags=["Care Reports"])
def create_report(payload: ReportCreate, current_user: dict = Depends(require_roles("citizen", "admin", "ngo_operator"))):
    try:
        with get_db() as cursor:
            code = generate_complaint_code()
            cursor.execute(
                """
                INSERT INTO reports (complaint_code, user_id, title, description, category, subcategory, location_text, district, ward, latitude, longitude, urgency_score, severity_level, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'submitted')
                RETURNING *;
                """,
                (code, current_user["sub"], payload.title, payload.description, payload.category, payload.subcategory, payload.location_text, payload.district, payload.ward, payload.latitude, payload.longitude, payload.urgency_score, payload.severity_level)
            )
            report = cursor.fetchone()
            
            # Log audit
            cursor.execute(
                "INSERT INTO care_audit_log (actor_user_id, actor_role, action_type, entity_type, entity_id) VALUES (%s, %s, %s, %s, %s)",
                (current_user["sub"], current_user["role"], "report_created", "report", report["id"])
            )
            return report
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/reports/mine", response_model=List[ReportResponse], tags=["Care Reports"])
def list_my_reports(current_user: dict = Depends(get_current_user)):
    try:
        with get_db() as cursor:
            cursor.execute("SELECT * FROM reports WHERE user_id = %s ORDER BY created_at DESC", (current_user["sub"],))
            return cursor.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/admin/reports", response_model=List[ReportResponse], tags=["Care Admin"])
def admin_list_reports(current_user: dict = Depends(require_roles("admin"))):
    try:
        with get_db() as cursor:
            cursor.execute("SELECT * FROM reports ORDER BY created_at DESC")
            return cursor.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ngo/reports", response_model=List[ReportResponse], tags=["Care NGO"])
def list_assigned_reports(current_user: dict = Depends(require_roles("ngo_operator"))):
    """NGO Operators can only see reports assigned to their organization."""
    try:
        with get_db() as cursor:
            cursor.execute("SELECT ngo_id FROM ngo_operators WHERE user_id = %s AND is_active = TRUE", (current_user["sub"],))
            op_data = cursor.fetchone()
            if not op_data:
                raise HTTPException(403, "Identity not linked to an active NGO")
            
            cursor.execute("SELECT * FROM reports WHERE assigned_ngo_id = %s ORDER BY created_at DESC", (op_data["ngo_id"],))
            return cursor.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/admin/reports/{report_id}", response_model=ReportResponse, tags=["Care Admin"])
def admin_get_report(report_id: str, current_user: dict = Depends(require_roles("admin"))):
    try:
        with get_db() as cursor:
            cursor.execute("SELECT * FROM reports WHERE id = %s", (report_id,))
            r = cursor.fetchone()
            if not r: raise HTTPException(404, "Report not found")
            return r
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))

@router.patch("/admin/reports/{report_id}/status", tags=["Care Admin"])
def update_report_status(report_id: str, payload: ReportStatusUpdate, current_user: dict = Depends(require_roles("admin"))):
    try:
        with get_db() as cursor:
            cursor.execute("SELECT status FROM reports WHERE id = %s", (report_id,))
            old_data = cursor.fetchone()
            if not old_data: raise HTTPException(404, "Not found")
            old_status = old_data["status"]
            
            cursor.execute("UPDATE reports SET status = %s, updated_at = NOW() WHERE id = %s RETURNING *", (payload.status, report_id))
            rep = cursor.fetchone()
            
            cursor.execute("INSERT INTO report_status_history (report_id, old_status, new_status, changed_by_user_id, changed_by_role, change_reason, note) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                           (report_id, old_status, payload.status, current_user["sub"], current_user["role"], payload.change_reason, payload.note))
            return {"success": True, "report": rep}
    except Exception as e: raise HTTPException(500, str(e))

@router.post("/admin/reports/{report_id}/assign-ngo", tags=["Care Admin"])
def assign_ngo(report_id: str, payload: ReportAssignNGO, current_user: dict = Depends(require_roles("admin"))):
    try:
        with get_db() as cursor:
            cursor.execute("UPDATE reports SET assigned_ngo_id = %s, assigned_admin_id = %s, status = 'ngo_assigned', updated_at = NOW() WHERE id = %s RETURNING *", 
                           (payload.ngo_id, current_user["sub"], report_id))
            rep = cursor.fetchone()
            if not rep: raise HTTPException(404, "Not found")
            
            cursor.execute("INSERT INTO ngo_assignment_log (report_id, ngo_id, assigned_by_admin_id, assignment_reason) VALUES (%s, %s, %s, %s)",
                           (report_id, payload.ngo_id, current_user["sub"], payload.assignment_reason))
            return rep
    except Exception as e: raise HTTPException(500, str(e))

@router.post("/admin/reports/{report_id}/resolve", tags=["Care Admin"])
def resolve_report(report_id: str, payload: ReportResolve, background_tasks: BackgroundTasks, current_user: dict = Depends(require_roles("admin"))):
    try:
        with get_db() as cursor:
            cursor.execute("UPDATE reports SET status = 'resolved', resolution_summary = %s, resolved_at = NOW(), updated_at = NOW() WHERE id = %s RETURNING *", 
                           (payload.resolution_summary, report_id))
            rep = cursor.fetchone()
            if not rep: raise HTTPException(404, "Not found")
            
            if payload.send_email:
                cursor.execute("SELECT email FROM users WHERE id = %s", (rep['user_id'],))
                user = cursor.fetchone()
                if user:
                    body = f"Your report {rep['complaint_code']} has been resolved. <br><br><b>Resolution Details:</b> {payload.resolution_summary}"
                    send_care_dispatch_email(background_tasks, user["email"], "Resolvit Care: Report Resolved", body, report_id)
                    
                    # 🔗 PERSIST in Care-specific dispatch log (Note: Background success is assumed for the audit log)
                    cursor.execute("""
                        INSERT INTO care_email_dispatch_log (report_id, recipient_email, template_name, subject, body_snapshot, dispatch_status, sent_by_admin_id)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """, (report_id, user["email"], "resolution", "Resolvit Care: Report Resolved", body, "sent", current_user["sub"]))
            return rep
    except Exception as e: raise HTTPException(500, str(e))

@router.post("/reports/{report_id}/notes", tags=["Care Reports"])
def add_report_note(report_id: str, payload: ReportNoteCreate, current_user: dict = Depends(get_current_user)):
    """Add an operational note. Visibility can be set to 'internal' or 'public'."""
    try:
        # Check permissions
        with get_db() as cursor:
            # Admins can note on anything
            # Citizens can only note on their own
            # NGO Operators can only note on assigned
            if current_user["role"] == 'admin':
                pass
            elif current_user["role"] == 'ngo_operator':
                cursor.execute("SELECT ngo_id FROM ngo_operators WHERE user_id = %s", (current_user["sub"],))
                op = cursor.fetchone()
                cursor.execute("SELECT assigned_ngo_id FROM reports WHERE id = %s", (report_id,))
                rep = cursor.fetchone()
                if not op or not rep or op["ngo_id"] != rep["assigned_ngo_id"]:
                    raise HTTPException(403, "Not authorized for this report")
            else:
                cursor.execute("SELECT user_id FROM reports WHERE id = %s", (report_id,))
                rep = cursor.fetchone()
                if not rep or str(rep["user_id"]) != current_user["sub"]:
                    raise HTTPException(403, "Not authorized")

            cursor.execute(
                """
                INSERT INTO report_notes (report_id, author_user_id, author_role, note_type, visibility_scope, body)
                VALUES (%s, %s, %s, %s, %s, %s) RETURNING *;
                """,
                (report_id, current_user["sub"], current_user["role"], payload.note_type, payload.visibility_scope, payload.body)
            )
            note = cursor.fetchone()
            
            cursor.execute(
                "INSERT INTO care_audit_log (actor_user_id, actor_role, action_type, entity_type, entity_id) VALUES (%s, %s, %s, %s, %s)",
                (current_user["sub"], current_user["role"], "note_added", "report", report_id)
            )
            return note
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))


@router.get("/reports/{report_id}/history", tags=["Care Reports"])
def get_report_history(report_id: str, current_user: dict = Depends(get_current_user)):
    """Retrieve full audit trail and status evolution for a report."""
    try:
        with get_db() as cursor:
            # Visibility check (same logic as detail view)
            cursor.execute("SELECT * FROM report_status_history WHERE report_id = %s ORDER BY created_at DESC", (report_id,))
            history = cursor.fetchall()
            cursor.execute("SELECT * FROM report_notes WHERE report_id = %s ORDER BY created_at DESC", (report_id,))
            notes = cursor.fetchall()
            
            # Filter notes for Citizens
            if current_user["role"] == 'citizen':
                notes = [n for n in notes if n["visibility_scope"] == "public"]
                
            return {
                "status_history": history,
                "notes": notes
            }
    except Exception as e: raise HTTPException(500, str(e))


@router.get("/map-data", tags=["Care Intelligence"])
def get_care_map_data(current_user: dict = Depends(get_current_user)):
    """Fetch geo-points for real-time GIS dashboard. Enforce visibility based on role."""
    try:
        with get_db() as cursor:
            if current_user["role"] == 'admin':
                cursor.execute("SELECT id, latitude, longitude, status, urgency_score, complaint_code, title FROM reports WHERE latitude IS NOT NULL")
            elif current_user["role"] == 'ngo_operator':
                cursor.execute("SELECT ngo_id FROM ngo_operators WHERE user_id = %s", (current_user["sub"],))
                op = cursor.fetchone()
                if not op: return []
                cursor.execute("SELECT id, latitude, longitude, status, urgency_score, complaint_code, title FROM reports WHERE assigned_ngo_id = %s AND latitude IS NOT NULL", (op["ngo_id"],))
            else:
                # Citizens see public aggregated data (or their own)
                cursor.execute("SELECT id, latitude, longitude, status, urgency_score, complaint_code, title FROM reports WHERE latitude IS NOT NULL")
            
            return cursor.fetchall()
    except Exception as e: raise HTTPException(500, str(e))


# ═══════════════════════════════════════════════════════════════════
# BROADCAST ALERTS
# ═══════════════════════════════════════════════════════════════════

from models import BroadcastAlertCreate, BroadcastAlertResponse, VolunteerCreate, VolunteerResponse

@router.post("/admin/broadcasts", tags=["Care Admin"])
def create_broadcast(payload: BroadcastAlertCreate, current_user: dict = Depends(require_roles("admin"))):
    """Admin creates a broadcast alert stored in DB."""
    try:
        with get_db() as cursor:
            cursor.execute(
                """
                INSERT INTO broadcast_alerts (title, message, severity, target_region, target_role, created_by_admin_id)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING *;
                """,
                (payload.title, payload.message, payload.severity, payload.target_region, payload.target_role, current_user["sub"])
            )
            broadcast = cursor.fetchone()
            
            # Audit log
            cursor.execute(
                "INSERT INTO care_audit_log (actor_user_id, actor_role, action_type, entity_type, entity_id) VALUES (%s, %s, %s, %s, %s)",
                (current_user["sub"], current_user["role"], "broadcast_sent", "broadcast_alert", broadcast["id"])
            )
            return {"success": True, "broadcast": broadcast}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/admin/broadcasts", tags=["Care Admin"])
def list_broadcasts(current_user: dict = Depends(require_roles("admin"))):
    """List all broadcast alerts ordered by most recent."""
    try:
        with get_db() as cursor:
            cursor.execute("SELECT * FROM broadcast_alerts ORDER BY created_at DESC LIMIT 50")
            return cursor.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════
# VOLUNTEER MANAGEMENT
# ═══════════════════════════════════════════════════════════════════

@router.get("/volunteers", tags=["Care Volunteers"])
def list_volunteers(
    skills: str = None,
    languages: str = None,
    region: str = None,
    status_filter: str = None,
    current_user: dict = Depends(get_current_user)
):
    """Search/filter volunteers from DB. Accessible to admin and ngo_operator."""
    try:
        with get_db() as cursor:
            conditions = []
            params = []
            
            if skills:
                conditions.append("v.skills ILIKE %s")
                params.append(f"%{skills}%")
            if languages:
                conditions.append("v.languages ILIKE %s")
                params.append(f"%{languages}%")
            if region:
                conditions.append("v.current_region ILIKE %s")
                params.append(f"%{region}%")
            if status_filter:
                conditions.append("v.availability_status = %s")
                params.append(status_filter)
            
            where_clause = ""
            if conditions:
                where_clause = "WHERE " + " AND ".join(conditions)
            
            cursor.execute(f"""
                SELECT v.*, n.name as ngo_name 
                FROM volunteers v
                LEFT JOIN ngos n ON v.ngo_id = n.id
                {where_clause}
                ORDER BY v.created_at DESC
                LIMIT 100
            """, tuple(params))
            return cursor.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/admin/volunteers", tags=["Care Admin"])
def create_volunteer(payload: VolunteerCreate, current_user: dict = Depends(require_roles("admin"))):
    """Admin creates a volunteer record in DB."""
    try:
        with get_db() as cursor:
            cursor.execute(
                """
                INSERT INTO volunteers (full_name, email, phone, skills, languages, current_region, ngo_id, availability_status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *;
                """,
                (payload.full_name, payload.email, payload.phone, payload.skills, payload.languages, 
                 payload.current_region, payload.ngo_id, payload.availability_status)
            )
            vol = cursor.fetchone()
            
            cursor.execute(
                "INSERT INTO care_audit_log (actor_user_id, actor_role, action_type, entity_type, entity_id) VALUES (%s, %s, %s, %s, %s)",
                (current_user["sub"], current_user["role"], "volunteer_created", "volunteer", vol["id"])
            )
            return {"success": True, "volunteer": vol}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ═══════════════════════════════════════════════════════════════════
# CARE OVERVIEW STATS (DB-BACKED)
# ═══════════════════════════════════════════════════════════════════

@router.get("/admin/overview", tags=["Care Admin"])
def care_overview(current_user: dict = Depends(require_roles("admin"))):
    """Real-time DB-backed overview stats for the Care dashboard."""
    try:
        with get_db() as cursor:
            # Active incidents
            cursor.execute("SELECT COUNT(*) as count FROM reports WHERE status NOT IN ('resolved', 'closed')")
            active_incidents = cursor.fetchone()["count"] or 0
            
            # NGOs connected
            cursor.execute("SELECT COUNT(*) as count FROM ngos WHERE is_active = TRUE")
            ngos_connected = cursor.fetchone()["count"] or 0
            
            # Volunteers available
            cursor.execute("SELECT COUNT(*) as count FROM volunteers WHERE availability_status = 'available'")
            volunteers_available = cursor.fetchone()["count"] or 0
            
            # Lives impacted (resolved reports count as impact)
            cursor.execute("SELECT COUNT(*) as count FROM reports WHERE status = 'resolved'")
            lives_impacted = cursor.fetchone()["count"] or 0
            
            # Recent activity (last 10 audit events)
            cursor.execute("""
                SELECT cal.*, u.username as actor_name 
                FROM care_audit_log cal
                LEFT JOIN users u ON cal.actor_user_id = u.id
                ORDER BY cal.created_at DESC 
                LIMIT 10
            """)
            recent_activity = cursor.fetchall()
            
            return {
                "active_incidents": active_incidents,
                "ngos_connected": ngos_connected,
                "volunteers_available": volunteers_available,
                "lives_impacted": lives_impacted,
                "recent_activity": recent_activity
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════
# OPS TIMELINE
# ═══════════════════════════════════════════════════════════════════

@router.get("/admin/timeline", tags=["Care Admin"])
def ops_timeline(current_user: dict = Depends(require_roles("admin"))):
    """Merged timeline of audits, status changes, and broadcasts."""
    try:
        with get_db() as cursor:
            # Merge care_audit_log + broadcast_alerts into unified timeline
            cursor.execute("""
                (
                    SELECT 'audit' as event_type, cal.action_type as title, 
                           cal.entity_type as subtitle, u.username as actor,
                           cal.created_at
                    FROM care_audit_log cal
                    LEFT JOIN users u ON cal.actor_user_id = u.id
                    ORDER BY cal.created_at DESC LIMIT 20
                )
                UNION ALL
                (
                    SELECT 'broadcast' as event_type, ba.title as title, 
                           ba.severity as subtitle, u.username as actor,
                           ba.created_at
                    FROM broadcast_alerts ba
                    LEFT JOIN users u ON ba.created_by_admin_id = u.id
                    ORDER BY ba.created_at DESC LIMIT 10
                )
                ORDER BY created_at DESC
                LIMIT 30
            """)
            return cursor.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
