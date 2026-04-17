"""
RESOLVIT - Admin Routes
Specialized operations for managing citizens and authorities.
"""
from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks
import json
from typing import Optional, List, Any
from datetime import datetime
import logging
from models import UserResponse, MessageResponse, DataResponse
from database import get_db
from auth import require_roles
from services.email_service import send_issue_update_email, get_email_health_stats, dispatch_email_task
from pydantic import BaseModel

router = APIRouter()

@router.get("/citizens", response_model=DataResponse[List[UserResponse]])
def list_citizens(
    search: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    current_admin: dict = Depends(require_roles("admin"))
):
    """Retrieve all citizens with search and pagination."""
    params: List[Any] = []
    where_clause = "WHERE role = 'citizen'"
    
    if search:
        where_clause += " AND (username ILIKE %s OR email ILIKE %s OR full_name ILIKE %s)"
        search_term = f"%{search}%"
        params.extend([search_term, search_term, search_term])
        
    query = f"""
        SELECT id, username, email, role, full_name, department, 
               auth_provider, profile_picture, trust_score, points_cache, 
               rank, is_suspended, created_at
        FROM users 
        {where_clause}
        ORDER BY created_at DESC
        LIMIT %s OFFSET %s
    """
    params.append(limit)
    params.append(offset)
    
    with get_db() as cursor:
        cursor.execute(query, params)
        rows = cursor.fetchall()
        
    results = []
    for r in rows:
        item = dict(r)
        item["id"] = str(item["id"])
        results.append(item)
    return {
        "success": True,
        "data": results
    }

@router.get("/citizens/{user_id}", response_model=DataResponse[UserResponse])
def get_citizen_detail(user_id: str, current_admin: dict = Depends(require_roles("admin"))):
    """Get detailed profile for a specific citizen."""
    with get_db() as cursor:
        cursor.execute(
            """
            SELECT id, username, email, role, full_name, department, 
                   auth_provider, profile_picture, trust_score, points_cache, 
                   rank, is_suspended, created_at
            FROM users WHERE id = %s
            """,
            (user_id,)
        )
        row = cursor.fetchone()
        
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
        
    item = dict(row)
    item["id"] = str(item["id"])
    return {
        "success": True,
        "data": item
    }

class CreditPayload(BaseModel):
    delta: int
    note: str

@router.post("/citizens/{user_id}/credits", response_model=MessageResponse)
def adjust_credits(user_id: str, payload: CreditPayload, current_admin: dict = Depends(require_roles("admin"))):
    """Grant or deduct civic credits."""
    with get_db() as cursor:
        # Update user
        cursor.execute(
            "UPDATE users SET points_cache = points_cache + %s WHERE id = %s",
            (payload.delta, user_id)
        )
        # Record activity
        cursor.execute(
            """
            INSERT INTO citizen_activity (user_id, action, credits_delta, note)
            VALUES (%s, 'admin_adjustment', %s, %s)
            """,
            (user_id, payload.delta, payload.note)
        )
    return {
        "success": True,
        "message": f"Successfully adjusted credits by {payload.delta}"
    }

@router.post("/citizens/{user_id}/suspend", response_model=MessageResponse)
def suspend_user(user_id: str, suspend: bool = True, current_admin: dict = Depends(require_roles("admin"))):
    """Suspend or unsuspend a user account."""
    with get_db() as cursor:
        cursor.execute("UPDATE users SET is_suspended = %s, is_active = %s WHERE id = %s", (suspend, not suspend, user_id))
        # Log action
        cursor.execute(
            "INSERT INTO admin_audit_logs (admin_id, entity_type, entity_id, action, new_value) VALUES (%s, 'user', %s, %s, %s)",
            (current_admin["sub"], user_id, "suspension_toggle", suspend)
        )
    return {
        "success": True,
        "message": f"User {'suspended' if suspend else 'unsuspended'} successfully"
    }

@router.get("/audit_logs", response_model=DataResponse[list])
def get_audit_logs(
    entity_type: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    current_admin: dict = Depends(require_roles("admin"))
):
    """Retrieve system-wide admin audit logs."""
    params: List[Any] = []
    where_clause = ""
    if entity_type:
        where_clause = "WHERE l.entity_type = %s"
        params.append(entity_type)
        
    query = f"""
        SELECT l.*, u.username as admin_username
        FROM admin_audit_logs l
        LEFT JOIN users u ON l.admin_id = u.id
        {{where_clause}}
        ORDER BY l.created_at DESC
        LIMIT %s OFFSET %s
    """
    params.append(limit)
    params.append(offset)
    
    with get_db() as cursor:
        cursor.execute(query, params)
        rows = cursor.fetchall()
        
    results = []
    for r in rows:
        item = dict(r)
        item["id"] = str(item["id"])
        if item.get("admin_id"): item["admin_id"] = str(item["admin_id"])
        if item.get("entity_id"): item["entity_id"] = str(item["entity_id"])
        if item.get("created_at") and hasattr(item["created_at"], "isoformat"):
            item["created_at"] = str(item["created_at"].isoformat())
        results.append(item)
    return {
        "success": True,
        "data": results
    }

@router.get("/stats", response_model=DataResponse[dict])
def get_admin_stats_full(current_admin: dict = Depends(require_roles("admin"))):
    """Core operational metrics for the Control Tower."""
    with get_db() as cursor:
        # 1. Issue Counts
        cursor.execute("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status='escalated' THEN 1 ELSE 0 END) as escalated,
                SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) as resolved
            FROM issues
        """)
        row = cursor.fetchone()
        total_issues = row["total"] or 0
        escalated_count = row["escalated"] or 0
        resolved_count = row["resolved"] or 0
        
        # 2. SLA Breaches
        cursor.execute("SELECT COUNT(*) as count FROM issues WHERE sla_expires_at < NOW() AND status != 'resolved'")
        sla_breaches = cursor.fetchone()["count"] or 0
        
        # 3. User Counts
        cursor.execute("SELECT COUNT(*) as count FROM users")
        total_users = cursor.fetchone()["count"] or 0
        
        # 4. Credits Awarded
        cursor.execute("SELECT COALESCE(SUM(credits_delta), 0) as sum FROM citizen_activity")
        total_credits = cursor.fetchone()["sum"] or 0

    return {
        "success": True,
        "data": {
            "issues": {
                "total_issues": total_issues,
                "escalated": escalated_count,
                "resolved": resolved_count,
                "sla_breached": sla_breaches
            },
            "users": {
                "total": total_users
            },
            "credits": {
                "total_awarded": total_credits
            }
        }
    }


@router.get("/email-health", response_model=DataResponse[dict])
def get_email_health(current_admin: dict = Depends(require_roles("admin"))):
    """Retrieves real-time email delivery statistics and health metrics."""
    return {
        "success": True,
        "data": get_email_health_stats()
    }

@router.get("/authorities", response_model=DataResponse[List[dict]])
def list_authorities():
    """Directory of all active authorities/departments."""
    with get_db() as cursor:
        cursor.execute("SELECT id, username, full_name, department FROM users WHERE role = 'authority' AND is_active = TRUE")
        rows = cursor.fetchall()
    
    results = []
    for r in rows:
        item = dict(r)
        item["id"] = str(item["id"])
        results.append(item)
    return {
        "success": True,
        "data": results
    }

from services.pressure import compute_governance_health

@router.get("/leaderboard", response_model=DataResponse[list])
def get_admin_leaderboard():
    """Ranked leaderboard of all citizens based on civic credits."""
    with get_db() as cursor:
        cursor.execute(
            """
            SELECT id, full_name, username, points_cache 
            FROM users 
            WHERE role = 'citizen' 
            ORDER BY points_cache DESC 
            LIMIT 20
            """
        )
        rows = cursor.fetchall()
    
    results = []
    for i, r in enumerate(rows):
        results.append({
            "rank": i + 1,
            "user_id": str(r["id"]),
            "name": r["full_name"] or r["username"],
            "credits": int(r["points_cache"] or 0)
        })
    return {
        "success": True,
        "data": results
    }

@router.get("/dashboard", response_model=DataResponse[dict])
def get_admin_dashboard(current_admin: dict = Depends(require_roles("admin"))):
    """Aggregate data for the Control Tower main view."""
    with get_db() as cursor:
        # 1. Heatmap Issues
        cursor.execute("""
            SELECT id, title, category, latitude, longitude, priority_score, status, is_simulated
            FROM issues WHERE status != 'resolved' AND status != 'archived'
        """)
        heatmap = [dict(r) for r in cursor.fetchall()]
        for h in heatmap: h["id"] = str(h["id"])

        # 2. Dept Performance
        cursor.execute("""
            SELECT u.department, AVG(am.performance_score) as avg_score, 
                   COUNT(am.id) as officer_count, SUM(am.total_resolved) as resolved
            FROM authority_metrics am
            JOIN users u ON am.authority_id = u.id
            GROUP BY u.department
        """)
        dept_perf = [dict(r) for r in cursor.fetchall()]

        # 3. Category distribution
        cursor.execute("SELECT category, COUNT(*) as count FROM issues GROUP BY category")
        cat_dist = [dict(r) for r in cursor.fetchall()]

    return {
        "success": True,
        "data": {
            "heatmap_issues": heatmap,
            "department_performance": dept_perf,
            "category_distribution": cat_dist,
            "civic_engagement": {
                "total_reports": len(heatmap),
                "participation_index": 85.4 # Heuristic for now
            }
        }
    }

@router.get("/escalations", response_model=DataResponse[list])
def get_admin_escalations(current_admin: dict = Depends(require_roles("admin"))):
    """Fetch all escalated issues requiring oversight."""
    with get_db() as cursor:
        cursor.execute("""
            SELECT i.id, i.title, i.category, i.escalation_level, i.priority_score, 
                   u.username as authority_name, u.department,
                   EXTRACT(EPOCH FROM (NOW() - i.sla_expires_at))/3600 as hours_overdue
            FROM issues i
            LEFT JOIN users u ON i.assigned_authority_id = u.id
            WHERE i.status = 'escalated'
            ORDER BY i.priority_score DESC
        """)
        rows = cursor.fetchall()
    
    results = []
    for r in rows:
        item = dict(r)
        item["id"] = str(item["id"])
        item["hours_overdue"] = float(max(0, round(float(item["hours_overdue"] or 0), 1)))
        results.append(item)
    data = results
    return {
        "success": True,
        "data": data
    }

@router.get("/governance_health", response_model=DataResponse[dict])
def get_admin_gov_health(current_admin: dict = Depends(require_roles("admin"))):
    """Compute and return the system-wide health index."""
    return {
        "success": True,
        "data": compute_governance_health()
    }

@router.get("/pressure_board", response_model=DataResponse[list])
def get_pressure_board(current_admin: dict = Depends(require_roles("admin"))):
    """Top issues ranked by Governance Pressure Score."""
    with get_db() as cursor:
        cursor.execute("""
            SELECT id, title, category, pressure_score, report_count, urgency, status
            FROM issues 
            WHERE status != 'resolved'
            ORDER BY pressure_score DESC
            LIMIT 10
        """)
        rows = cursor.fetchall()
    return {
        "success": True,
        "data": [{**dict(r), "id": str(r["id"])} for r in rows]
    }

@router.get("/anomalies", response_model=DataResponse[list])
def get_admin_anomalies(current_admin: dict = Depends(require_roles("admin"))):
    """List detected system/officer anomalies."""
    with get_db() as cursor:
        cursor.execute("""
            SELECT a.*, u.username as authority_name, u.department
            FROM anomalies a
            JOIN users u ON a.authority_id = u.id
            WHERE a.is_resolved = FALSE
            ORDER BY a.created_at DESC
        """)
        rows = cursor.fetchall()
    return {
        "success": True,
        "data": [{**dict(r), "id": str(r["id"]), "authority_id": str(r["authority_id"])} for r in rows]
    }


@router.post("/issues/{issue_id}/email", response_model=MessageResponse)
def email_citizen(issue_id: str, background_tasks: BackgroundTasks, current_admin: dict = Depends(require_roles("admin", "authority"))):
    """Trigger a status update email to the reporter."""
    with get_db() as cursor:
        # Fetch issue and reporter email
        cursor.execute(
            """
            SELECT i.*, u.email as reporter_email, u.full_name as reporter_name, u.username as reporter_username
            FROM issues i
            JOIN users u ON i.reporter_id = u.id
            WHERE i.id = %s
            """,
            (issue_id,)
        )
        row = cursor.fetchone()
        
    if not row:
        raise HTTPException(status_code=404, detail="Issue not found")
        
    issue_data = dict(row)
    # Convert datetime objects to string for service
    for key in ["created_at", "updated_at", "resolved_at", "sla_expires_at", "sla_due_at"]:
        if issue_data.get(key) and hasattr(issue_data[key], "isoformat"):
            issue_data[key] = str(issue_data[key].isoformat())
            
    to_email = issue_data["reporter_email"]
    username = issue_data["reporter_name"] or issue_data["reporter_username"]
    
    send_issue_update_email(background_tasks, to_email, username, issue_data)
    
    # Log the email action in admin audit (actual dispatch status logged in email_audit_logs)
    with get_db() as cursor:
        cursor.execute(
            "INSERT INTO admin_audit_logs (admin_id, entity_type, entity_id, action, new_value) VALUES (%s, 'issue', %s, 'email_sent', %s)",
            (current_admin["sub"], issue_id, json.dumps({"to": to_email, "status": "sent"}))
        )
        
    return {
        "success": True,
        "message": "Email notification dispatched successfully"
    }
