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
from auth import require_roles as require_role, get_current_user
from database import get_db
from services.email_service import send_care_dispatch_email

router = APIRouter()

def generate_complaint_code():
    chars = string.ascii_uppercase + string.digits
    return 'RC-' + ''.join(random.choice(chars) for _ in range(8))

@router.post("/reports", response_model=ReportResponse, tags=["Care Reports"])
def create_report(payload: ReportCreate, current_user: UserResponse = Depends(require_role([UserRole.citizen, UserRole.admin, UserRole.ngo_operator]))):
    try:
        with get_db() as cursor:
            code = generate_complaint_code()
            cursor.execute(
                """
                INSERT INTO reports (complaint_code, user_id, title, description, category, subcategory, location_text, district, ward, latitude, longitude, urgency_score, severity_level, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'submitted')
                RETURNING *;
                """,
                (code, current_user.id, payload.title, payload.description, payload.category, payload.subcategory, payload.location_text, payload.district, payload.ward, payload.latitude, payload.longitude, payload.urgency_score, payload.severity_level)
            )
            report = cursor.fetchone()
            
            # Log audit
            cursor.execute(
                "INSERT INTO care_audit_log (actor_user_id, actor_role, action_type, entity_type, entity_id) VALUES (%s, %s, %s, %s, %s)",
                (current_user.id, current_user.role, "report_created", "report", report["id"])
            )
            return report
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/reports/mine", response_model=List[ReportResponse], tags=["Care Reports"])
def list_my_reports(current_user: UserResponse = Depends(get_current_user)):
    try:
        with get_db() as cursor:
            cursor.execute("SELECT * FROM reports WHERE user_id = %s ORDER BY created_at DESC", (current_user.id,))
            return cursor.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/admin/reports", response_model=List[ReportResponse], tags=["Care Admin"])
def admin_list_reports(current_user: UserResponse = Depends(require_role([UserRole.admin]))):
    try:
        with get_db() as cursor:
            cursor.execute("SELECT * FROM reports ORDER BY created_at DESC")
            return cursor.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ngo/reports", response_model=List[ReportResponse], tags=["Care NGO"])
def list_assigned_reports(current_user: UserResponse = Depends(require_role([UserRole.ngo_operator]))):
    """NGO Operators can only see reports assigned to their organization."""
    try:
        with get_db() as cursor:
            cursor.execute("SELECT ngo_id FROM ngo_operators WHERE user_id = %s AND is_active = TRUE", (current_user.id,))
            op_data = cursor.fetchone()
            if not op_data:
                raise HTTPException(403, "Identity not linked to an active NGO")
            
            cursor.execute("SELECT * FROM reports WHERE assigned_ngo_id = %s ORDER BY created_at DESC", (op_data["ngo_id"],))
            return cursor.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/admin/reports/{report_id}", response_model=ReportResponse, tags=["Care Admin"])
def admin_get_report(report_id: str, current_user: UserResponse = Depends(require_role([UserRole.admin]))):
    try:
        with get_db() as cursor:
            cursor.execute("SELECT * FROM reports WHERE id = %s", (report_id,))
            r = cursor.fetchone()
            if not r: raise HTTPException(404, "Report not found")
            return r
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))

@router.patch("/admin/reports/{report_id}/status", tags=["Care Admin"])
def update_report_status(report_id: str, payload: ReportStatusUpdate, current_user: UserResponse = Depends(require_role([UserRole.admin]))):
    try:
        with get_db() as cursor:
            cursor.execute("SELECT status FROM reports WHERE id = %s", (report_id,))
            old_data = cursor.fetchone()
            if not old_data: raise HTTPException(404, "Not found")
            old_status = old_data["status"]
            
            cursor.execute("UPDATE reports SET status = %s, updated_at = NOW() WHERE id = %s RETURNING *", (payload.status, report_id))
            rep = cursor.fetchone()
            
            cursor.execute("INSERT INTO report_status_history (report_id, old_status, new_status, changed_by_user_id, changed_by_role, change_reason, note) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                           (report_id, old_status, payload.status, current_user.id, current_user.role, payload.change_reason, payload.note))
            return {"success": True, "report": rep}
    except Exception as e: raise HTTPException(500, str(e))

@router.post("/admin/reports/{report_id}/assign-ngo", tags=["Care Admin"])
def assign_ngo(report_id: str, payload: ReportAssignNGO, current_user: UserResponse = Depends(require_role([UserRole.admin]))):
    try:
        with get_db() as cursor:
            cursor.execute("UPDATE reports SET assigned_ngo_id = %s, assigned_admin_id = %s, status = 'ngo_assigned', updated_at = NOW() WHERE id = %s RETURNING *", 
                           (payload.ngo_id, current_user.id, report_id))
            rep = cursor.fetchone()
            if not rep: raise HTTPException(404, "Not found")
            
            cursor.execute("INSERT INTO ngo_assignment_log (report_id, ngo_id, assigned_by_admin_id, assignment_reason) VALUES (%s, %s, %s, %s)",
                           (report_id, payload.ngo_id, current_user.id, payload.assignment_reason))
            return rep
    except Exception as e: raise HTTPException(500, str(e))

@router.post("/admin/reports/{report_id}/resolve", tags=["Care Admin"])
def resolve_report(report_id: str, payload: ReportResolve, background_tasks: BackgroundTasks, current_user: UserResponse = Depends(require_role([UserRole.admin]))):
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
                    """, (report_id, user["email"], "resolution", "Resolvit Care: Report Resolved", body, "sent", current_user.id))
            return rep
    except Exception as e: raise HTTPException(500, str(e))

@router.post("/reports/{report_id}/notes", tags=["Care Reports"])
def add_report_note(report_id: str, payload: ReportNoteCreate, current_user: UserResponse = Depends(get_current_user)):
    """Add an operational note. Visibility can be set to 'internal' or 'public'."""
    try:
        # Check permissions
        with get_db() as cursor:
            # Admins can note on anything
            # Citizens can only note on their own
            # NGO Operators can only note on assigned
            if current_user.role == UserRole.admin:
                pass
            elif current_user.role == UserRole.ngo_operator:
                cursor.execute("SELECT ngo_id FROM ngo_operators WHERE user_id = %s", (current_user.id,))
                op = cursor.fetchone()
                cursor.execute("SELECT assigned_ngo_id FROM reports WHERE id = %s", (report_id,))
                rep = cursor.fetchone()
                if not op or not rep or op["ngo_id"] != rep["assigned_ngo_id"]:
                    raise HTTPException(403, "Not authorized for this report")
            else:
                cursor.execute("SELECT user_id FROM reports WHERE id = %s", (report_id,))
                rep = cursor.fetchone()
                if not rep or rep["user_id"] != current_user.id:
                    raise HTTPException(403, "Not authorized")

            cursor.execute(
                """
                INSERT INTO report_notes (report_id, author_user_id, author_role, note_type, visibility_scope, body)
                VALUES (%s, %s, %s, %s, %s, %s) RETURNING *;
                """,
                (report_id, current_user.id, current_user.role, payload.note_type, payload.visibility_scope, payload.body)
            )
            note = cursor.fetchone()
            
            cursor.execute(
                "INSERT INTO care_audit_log (actor_user_id, actor_role, action_type, entity_type, entity_id) VALUES (%s, %s, %s, %s, %s)",
                (current_user.id, current_user.role, "note_added", "report", report_id)
            )
            return note
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))


@router.get("/reports/{report_id}/history", tags=["Care Reports"])
def get_report_history(report_id: str, current_user: UserResponse = Depends(get_current_user)):
    """Retrieve full audit trail and status evolution for a report."""
    try:
        with get_db() as cursor:
            # Visibility check (same logic as detail view)
            cursor.execute("SELECT * FROM report_status_history WHERE report_id = %s ORDER BY created_at DESC", (report_id,))
            history = cursor.fetchall()
            cursor.execute("SELECT * FROM report_notes WHERE report_id = %s ORDER BY created_at DESC", (report_id,))
            notes = cursor.fetchall()
            
            # Filter notes for Citizens
            if current_user.role == UserRole.citizen:
                notes = [n for n in notes if n["visibility_scope"] == "public"]
                
            return {
                "status_history": history,
                "notes": notes
            }
    except Exception as e: raise HTTPException(500, str(e))


@router.get("/map-data", tags=["Care Intelligence"])
def get_care_map_data(current_user: UserResponse = Depends(get_current_user)):
    """Fetch geo-points for real-time GIS dashboard. Enforce visibility based on role."""
    try:
        with get_db() as cursor:
            if current_user.role == UserRole.admin:
                cursor.execute("SELECT id, latitude, longitude, status, urgency_score, complaint_code, title FROM reports WHERE latitude IS NOT NULL")
            elif current_user.role == UserRole.ngo_operator:
                cursor.execute("SELECT ngo_id FROM ngo_operators WHERE user_id = %s", (current_user.id,))
                op = cursor.fetchone()
                if not op: return []
                cursor.execute("SELECT id, latitude, longitude, status, urgency_score, complaint_code, title FROM reports WHERE assigned_ngo_id = %s AND latitude IS NOT NULL", (op["ngo_id"],))
            else:
                # Citizens see public aggregated data (or their own)
                cursor.execute("SELECT id, latitude, longitude, status, urgency_score, complaint_code, title FROM reports WHERE latitude IS NOT NULL")
            
            return cursor.fetchall()
    except Exception as e: raise HTTPException(500, str(e))

