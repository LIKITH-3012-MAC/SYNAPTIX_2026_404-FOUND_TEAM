"""
RESOLVIT - Admin Routes
GET  /api/admin/users            - List all users (admin only)
GET  /api/admin/users/{id}       - Get user detail (admin only)
PATCH /api/admin/users/{id}      - Toggle user active/inactive (admin only)
GET  /api/admin/stats            - Full platform stats (admin only)
DELETE /api/admin/issues/{id}    - Hard delete issue (admin only)
"""
from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import require_roles
from models import UserResponse, MessageResponse
from typing import Optional

router = APIRouter(tags=["Admin"])


# ── List All Users ────────────────────────────────────────────
@router.get("/users")
def list_users(
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    current_user: dict = Depends(require_roles("admin"))
):
    """Return paginated user list (admin only)."""
    conditions: list = []
    params: list = []

    if role:
        conditions.append("role = %s")
        params.append(role)
    if is_active is not None:
        conditions.append("is_active = %s")
        params.append(is_active)  # psycopg2 handles Python bool → PostgreSQL boolean

    where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with get_db() as cursor:
        cursor.execute(
            f"SELECT id, username, email, role, full_name, department, is_active, created_at FROM users {where_clause} ORDER BY created_at DESC",
            params
        )
        rows = cursor.fetchall()

    return [
        {
            **dict(r),
            "id": str(r["id"])
        }
        for r in rows
    ]


# ── Get Single User ───────────────────────────────────────────
@router.get("/users/{user_id}")
def get_user(
    user_id: str,
    current_user: dict = Depends(require_roles("admin"))
):
    """Get full details of a user (admin only)."""
    with get_db() as cursor:
        cursor.execute(
            "SELECT id, username, email, role, full_name, department, is_active, created_at FROM users WHERE id = %s",
            (user_id,)
        )
        user = cursor.fetchone()

    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return {**dict(user), "id": str(user["id"])}


# ── Toggle User Active ────────────────────────────────────────
@router.patch("/users/{user_id}/toggle")
def toggle_user_active(
    user_id: str,
    current_user: dict = Depends(require_roles("admin"))
):
    """Enable or disable a user account (admin only)."""
    with get_db() as cursor:
        cursor.execute(
            "UPDATE users SET is_active = NOT is_active WHERE id = %s RETURNING id, username, is_active",
            (user_id,)
        )
        updated = cursor.fetchone()

    if not updated:
        raise HTTPException(status_code=404, detail="User not found.")
    return {
        "message": f"User {updated['username']} is now {'active' if updated['is_active'] else 'disabled'}.",
        "user_id": str(updated["id"]),
        "is_active": updated["is_active"]
    }


# ── Admin Stats ───────────────────────────────────────────────
@router.get("/stats")
def get_admin_stats(current_user: dict = Depends(require_roles("admin"))):
    """Return comprehensive admin dashboard stats."""
    with get_db() as cursor:
        cursor.execute("SELECT COUNT(*) AS total_users, COUNT(*) FILTER (WHERE role='citizen') AS citizens, COUNT(*) FILTER (WHERE role='authority') AS authorities, COUNT(*) FILTER (WHERE role='admin') AS admins FROM users")
        user_stats = dict(cursor.fetchone())

        cursor.execute("SELECT COUNT(*) AS total_issues, COUNT(*) FILTER (WHERE status='resolved') AS resolved, COUNT(*) FILTER (WHERE status='escalated') AS escalated FROM issues")
        issue_stats = dict(cursor.fetchone())

        cursor.execute("SELECT COUNT(*) AS total_clusters FROM issue_clusters")
        cluster_stats = dict(cursor.fetchone())

        cursor.execute("SELECT COUNT(*) AS total_audit_logs FROM audit_logs")
        audit_stats = dict(cursor.fetchone())

    return {
        "users": user_stats,
        "issues": issue_stats,
        "clusters": cluster_stats,
        "audit_logs": audit_stats
    }
