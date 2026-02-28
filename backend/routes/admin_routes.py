"""
RESOLVIT - Admin Routes v2
GET  /api/admin/users               - List all users (admin only)
GET  /api/admin/users/{id}          - Get user detail (admin only)
PATCH /api/admin/users/{id}/toggle  - Toggle user active/inactive (admin only)
GET  /api/admin/stats               - Platform stats
GET  /api/admin/dashboard           - Full control tower data (heatmap + escalations + dept perf)
GET  /api/admin/escalations         - Escalation monitor table
"""
from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import require_roles
from models import MessageResponse
from typing import Optional
from datetime import datetime, timezone

router = APIRouter(tags=["Admin"])


# ── List All Users ────────────────────────────────────────────
@router.get("/users")
def list_users(
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    current_user: dict = Depends(require_roles("admin"))
):
    conditions, params = [], []
    if role:
        conditions.append("role = %s"); params.append(role)
    if is_active is not None:
        conditions.append("is_active = %s")
        params.append(bool(is_active))
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    with get_db() as cursor:
        cursor.execute(
            f"SELECT id, username, email, role, full_name, department, is_active, created_at FROM users {where} ORDER BY created_at DESC",
            params
        )
        rows = cursor.fetchall()
    return [{**dict(r), "id": str(r["id"])} for r in rows]


# ── Get Single User ───────────────────────────────────────────
@router.get("/users/{user_id}")
def get_user(user_id: str, current_user: dict = Depends(require_roles("admin"))):
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
def toggle_user_active(user_id: str, current_user: dict = Depends(require_roles("admin"))):
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


# ── Admin Stats (quick summary) ───────────────────────────────
@router.get("/stats")
def get_admin_stats(current_user: dict = Depends(require_roles("admin"))):
    with get_db() as cursor:
        cursor.execute("""
            SELECT COUNT(*) AS total_users,
                   COUNT(*) FILTER (WHERE role='citizen')   AS citizens,
                   COUNT(*) FILTER (WHERE role='authority') AS authorities,
                   COUNT(*) FILTER (WHERE role='admin')     AS admins
            FROM users
        """)
        user_stats = dict(cursor.fetchone())

        cursor.execute("""
            SELECT COUNT(*) AS total_issues,
                   COUNT(*) FILTER (WHERE status='resolved')   AS resolved,
                   COUNT(*) FILTER (WHERE status='escalated')  AS escalated,
                   COUNT(*) FILTER (WHERE status='in_progress') AS in_progress,
                   COUNT(*) FILTER (WHERE sla_expires_at < NOW() AND status != 'resolved') AS sla_breached
            FROM issues
        """)
        issue_stats = dict(cursor.fetchone())

        cursor.execute("SELECT COUNT(*) AS total_clusters FROM issue_clusters")
        cluster_stats = dict(cursor.fetchone())

        cursor.execute("SELECT COUNT(*) AS total_audit_logs FROM audit_logs")
        audit_stats = dict(cursor.fetchone())

        cursor.execute("SELECT COALESCE(SUM(points), 0) AS total_credits_awarded FROM civic_credits")
        credit_stats = dict(cursor.fetchone())

    return {
        "users": user_stats,
        "issues": issue_stats,
        "clusters": cluster_stats,
        "audit_logs": audit_stats,
        "credits": {"total_awarded": int(credit_stats["total_credits_awarded"])}
    }


# ── Admin Dashboard (full control tower data) ─────────────────
@router.get("/dashboard")
def get_admin_dashboard(current_user: dict = Depends(require_roles("admin"))):
    """Full control tower: heatmap markers, category distribution, civic stats."""
    with get_db() as cursor:
        # Heatmap markers: all unresolved issues with coordinates
        cursor.execute("""
            SELECT i.id, i.title, i.category, i.status, i.priority_score,
                   i.latitude, i.longitude, i.urgency, i.escalation_level,
                   i.sla_expires_at, i.upvotes, i.report_count,
                   u.username AS reporter_name
            FROM issues i
            LEFT JOIN users u ON i.reporter_id = u.id
            WHERE i.latitude IS NOT NULL AND i.longitude IS NOT NULL
            ORDER BY i.priority_score DESC
            LIMIT 200
        """)
        issues = cursor.fetchall()

        # Category distribution
        cursor.execute("""
            SELECT category, COUNT(*) AS count,
                   COUNT(*) FILTER (WHERE status='resolved') AS resolved
            FROM issues
            GROUP BY category
            ORDER BY count DESC
        """)
        categories = cursor.fetchall()

        # Department performance
        cursor.execute("""
            SELECT u.id, u.username, u.full_name, u.department,
                   am.total_assigned, am.total_resolved, am.total_escalated,
                   am.resolution_rate, am.avg_resolution_time, am.performance_score,
                   am.avg_response_time
            FROM authority_metrics am
            JOIN users u ON am.authority_id = u.id
            ORDER BY am.performance_score DESC
        """)
        dept_perf = cursor.fetchall()

        # Civic engagement
        cursor.execute("""
            SELECT COUNT(DISTINCT user_id) AS active_citizens,
                   COALESCE(SUM(points), 0) AS total_points_awarded,
                   COUNT(*) FILTER (WHERE action_type='report_issue') AS total_reports
            FROM civic_credits
        """)
        engagement = dict(cursor.fetchone())

    now_ts = datetime.now(timezone.utc)

    def _fmt_issue(r):
        d = dict(r)
        d["id"] = str(d["id"])
        sla = d.get("sla_expires_at")
        if sla and hasattr(sla, "tzinfo"):
            if sla.tzinfo is None:
                sla = sla.replace(tzinfo=timezone.utc)
            d["sla_expires_at"] = sla.isoformat()
            d["sla_breached"] = bool(sla < now_ts)
        else:
            d["sla_expires_at"] = str(sla) if sla else None
            d["sla_breached"] = False
        return d

    return {
        "heatmap_issues": [_fmt_issue(r) for r in issues],
        "category_distribution": [dict(r) for r in categories],
        "department_performance": [
            {**dict(r), "id": str(r["id"])} for r in dept_perf
        ],
        "civic_engagement": {
            "active_citizens": int(engagement["active_citizens"] or 0),
            "total_points_awarded": int(engagement["total_points_awarded"] or 0),
            "total_reports": int(engagement["total_reports"] or 0),
        }
    }


# ── Escalation Monitor ────────────────────────────────────────
@router.get("/escalations")
def get_escalation_monitor(current_user: dict = Depends(require_roles("admin"))):
    """Escalation monitor table for admin control tower."""
    with get_db() as cursor:
        cursor.execute("""
            SELECT i.id, i.title, i.category, i.status, i.priority_score,
                   i.escalation_level, i.sla_expires_at,
                   EXTRACT(EPOCH FROM (NOW() - i.sla_expires_at))/3600 AS hours_overdue,
                   u_auth.username AS authority_name,
                   u_auth.department AS department,
                   u_rep.username AS reporter_name,
                   e.reason AS last_escalation_reason,
                   e.escalated_at AS last_escalated_at
            FROM issues i
            LEFT JOIN users u_auth ON i.assigned_authority_id = u_auth.id
            LEFT JOIN users u_rep  ON i.reporter_id = u_rep.id
            LEFT JOIN LATERAL (
                SELECT reason, escalated_at FROM escalations
                WHERE issue_id = i.id
                ORDER BY escalated_at DESC LIMIT 1
            ) e ON TRUE
            WHERE i.status NOT IN ('resolved')
              AND (i.status = 'escalated' OR (i.sla_expires_at IS NOT NULL AND i.sla_expires_at < NOW()))
            ORDER BY i.escalation_level DESC, i.priority_score DESC
        """)
        rows = cursor.fetchall()

    result = []
    for r in rows:
        d = dict(r)
        d["id"] = str(d["id"])
        sla = d.get("sla_expires_at")
        if sla:
            if hasattr(sla, "isoformat"):
                d["sla_expires_at"] = sla.isoformat()
        last_esc = d.get("last_escalated_at")
        if last_esc and hasattr(last_esc, "isoformat"):
            d["last_escalated_at"] = last_esc.isoformat()
        d["hours_overdue"] = round(float(d.get("hours_overdue") or 0.0), 1)
        result.append(d)
    return result


# ── Governance Health Index ───────────────────────────────────
@router.get("/governance_health")
def get_governance_health(current_user: dict = Depends(require_roles("admin"))):
    """Compute and return real-time Governance Health Index (0–100)."""
    from services.pressure import compute_governance_health
    return compute_governance_health()


# ── Anomaly Board ─────────────────────────────────────────────
@router.get("/anomalies")
def get_anomalies(current_user: dict = Depends(require_roles("admin"))):
    """Return detected performance anomalies for admin oversight."""
    with get_db() as cursor:
        cursor.execute("""
            SELECT a.id, a.anomaly_type, a.description, a.severity,
                   a.detected_at, a.resolved,
                   u.username AS officer_username, u.full_name AS officer_name,
                   u.department AS department
            FROM anomalies a
            LEFT JOIN users u ON a.authority_id = u.id
            ORDER BY a.detected_at DESC
            LIMIT 50
        """)
        rows = cursor.fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["id"] = str(d["id"])
        det = d.get("detected_at")
        if det and hasattr(det, "isoformat"):
            d["detected_at"] = det.isoformat()
        result.append(d)
    return result


# ── Top Pressure Issues ───────────────────────────────────────
@router.get("/pressure_data")
def get_pressure_data(current_user: dict = Depends(require_roles("admin"))):
    """Return top issues by governance pressure score with trend indicators."""
    with get_db() as cursor:
        cursor.execute("""
            SELECT i.id, i.title, i.category, i.status, i.priority_score,
                   i.pressure_score, i.escalation_level, i.report_count, i.upvotes,
                   i.sla_expires_at, i.latitude, i.longitude,
                   u.department, u.username AS authority_name
            FROM issues i
            LEFT JOIN users u ON i.assigned_authority_id = u.id
            WHERE i.is_simulated = FALSE
              AND i.status != 'resolved'
            ORDER BY i.pressure_score DESC NULLS LAST
            LIMIT 20
        """)
        rows = cursor.fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["id"] = str(d["id"])
        sla = d.get("sla_expires_at")
        if sla and hasattr(sla, "isoformat"):
            d["sla_expires_at"] = sla.isoformat()
        ps = float(d.get("pressure_score") or 0)
        d["pressure_label"] = (
            "🔴 Public Attention Risk" if ps >= 200 else
            "🟠 Elevated Pressure" if ps >= 100 else
            "🟡 Monitoring" if ps >= 50 else
            "🟢 Stable"
        )
        result.append(d)
    return result

