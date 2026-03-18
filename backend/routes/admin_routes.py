"""
RESOLVIT - Admin Routes
Specialized operations for managing citizens and authorities.
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional, Any
from models import UserResponse, MessageResponse
from database import get_db
from auth import require_roles
from pydantic import BaseModel
from datetime import datetime

router = APIRouter()

@router.get("/citizens", response_model=List[UserResponse])
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
    return results

@router.get("/citizens/{user_id}", response_model=UserResponse)
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
    return item

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
    return {"message": f"Successfully adjusted credits by {payload.delta}"}

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
    return {"message": f"User {'suspended' if suspend else 'unsuspended'} successfully"}

@router.get("/audit_logs", response_model=list)
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
        {where_clause}
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
        if item.get("created_at") and isinstance(item["created_at"], datetime):
            item["created_at"] = item["created_at"].isoformat()
        results.append(item)
    return results

@router.get("/stats", response_model=dict)
def get_admin_stats_full(current_admin: dict = Depends(require_roles("admin"))):
    """Core operational metrics for the Control Tower."""
    with get_db() as cursor:
        # 1. Issue Counts
        cursor.execute("SELECT COUNT(*) as total, SUM(CASE WHEN status='escalated' THEN 1 ELSE 0 END) as escalated FROM issues")
        row = cursor.fetchone()
        
        # 2. SLA Breaches
        cursor.execute("SELECT COUNT(*) FROM issues WHERE sla_expires_at < NOW() AND status != 'resolved'")
        sla_breaches = cursor.fetchone()[0]
        
        # 3. User Counts
        cursor.execute("SELECT COUNT(*) FROM users")
        total_users = cursor.fetchone()[0]
        
        # 4. Credits Awarded
        cursor.execute("SELECT SUM(credits_delta) FROM citizen_activity")
        c_row = cursor.fetchone()
        total_credits = c_row[0] if c_row and c_row[0] else 0

    return {
        "status": "online",
        "issues": {
            "total_issues": row["total"] or 0,
            "escalated": row["escalated"] or 0,
            "sla_breached": sla_breaches or 0
        },
        "users": {
            "total": total_users or 0
        },
        "credits": {
            "total_awarded": total_credits
        }
    }
