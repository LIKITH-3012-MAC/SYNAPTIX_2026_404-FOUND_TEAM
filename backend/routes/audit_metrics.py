"""
RESOLVIT - Audit & Metrics Routes

GET /api/audit/{issue_id}          - Full blockchain audit chain
GET /api/metrics/leaderboard       - Authority performance leaderboard
GET /api/metrics/summary           - Platform-wide stats
"""
from fastapi import APIRouter, HTTPException
from database import get_db
from auth import get_current_user
from fastapi import APIRouter, HTTPException, Depends
from services.blockchain import get_audit_chain, verify_chain_integrity

# ── Audit Router ──────────────────────────────────────────────
audit_router = APIRouter()

@audit_router.get("/{issue_id}")
def get_audit_log(
    issue_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Return the full immutable blockchain audit log for an issue.
    Each entry is SHA-256 chained to the previous.
    """
    # Verify the issue exists
    with get_db() as cursor:
        cursor.execute("SELECT id, title FROM issues WHERE id = %s", (issue_id,))
        issue = cursor.fetchone()

    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found.")

    role = current_user.get("role")
    user_dept = current_user.get("department")

    # Access Control: Citizens only see audit logs for their own issues
    if role not in ("admin", "authority"):
        cursor.execute("SELECT reporter_id FROM issues WHERE id = %s", (issue_id,))
        issue_owner = cursor.fetchone()
        if issue_owner and str(issue_owner["reporter_id"]) != current_user["sub"]:
            raise HTTPException(status_code=403, detail="Access denied. You can only view audit logs for your own issues.")

    chain = get_audit_chain(issue_id)
    integrity = verify_chain_integrity(issue_id)

    return {
        "issue_id":   issue_id,
        "issue_title": issue["title"],
        "chain_valid": integrity["valid"],
        "total_blocks": integrity["blocks"],
        "tampered_at": integrity.get("tampered_at"),
        "audit_chain": [
            {
                **{k: str(v) if hasattr(v, 'isoformat') else v for k, v in entry.items()},
                "id":       str(entry.get("id", "")),
                "issue_id": str(entry.get("issue_id", "")),
            }
            for entry in chain
        ]
    }


# ── Metrics Router ────────────────────────────────────────────
metrics_router = APIRouter()

@metrics_router.get("/leaderboard")
def get_leaderboard():
    """Return authority performance leaderboard ranked by performance score."""
    with get_db() as cursor:
        cursor.execute(
            """
            SELECT
                am.*,
                u.username,
                u.full_name,
                u.department,
                u.email
            FROM authority_metrics am
            JOIN users u ON am.authority_id = u.id
            ORDER BY am.performance_score DESC
            LIMIT 50
            """
        )
        rows = cursor.fetchall()

    return [
        {
            **{k: str(v) if k in ("authority_id",) else v for k, v in dict(r).items()},
            "rank": i + 1
        }
        for i, r in enumerate(rows)
    ]


@metrics_router.get("/summary")
def get_platform_summary(current_user: dict = Depends(get_current_user)):
    """Return platform-wide statistics for the dashboard."""
    role = current_user.get("role")
    user_dept = current_user.get("department")

    where_clause = ""
    params = []

    if role == "admin" or role == "authority":
        # Officials see everything
        where_clause = ""
        params = []
    else:
        # Citizens see only their own stats
        where_clause = "WHERE reporter_id = %s"
        params = [current_user["sub"]]

    with get_db() as cursor:
        cursor.execute(
            f"""
            SELECT
                COUNT(*)                                            AS total_issues,
                COUNT(*) FILTER (WHERE status = 'resolved')        AS resolved_issues,
                COUNT(*) FILTER (WHERE status = 'escalated')       AS escalated_issues,
                COUNT(*) FILTER (WHERE status IN ('reported','verified','assigned','in_progress')) AS active_issues,
                AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600)
                    FILTER (WHERE status = 'resolved' AND resolved_at IS NOT NULL) AS avg_resolution_hours,
                COUNT(DISTINCT reporter_id)                         AS unique_reporters,
                SUM(impact_scale)                                   AS total_people_impacted
            FROM issues
            {where_clause}
            """,
            params
        )
        stats = dict(cursor.fetchone())

        auth_query = "SELECT COUNT(*) AS total_authorities FROM users WHERE role = 'authority' AND is_active = true"
        if role == "authority" and user_dept:
            auth_query += " AND department = %s"
        
        cursor.execute(auth_query, params if "department = %s" in auth_query else [])
        auth_count = cursor.fetchone()

        cursor.execute(
            f"""
            SELECT category, COUNT(*) AS count
            FROM issues
            {where_clause}
            GROUP BY category
            ORDER BY count DESC
            """,
            params
        )
        by_category = [dict(r) for r in cursor.fetchall()]

    return {
        "total_issues":           stats["total_issues"] or 0,
        "resolved_issues":        stats["resolved_issues"] or 0,
        "escalated_issues":       stats["escalated_issues"] or 0,
        "active_issues":          stats["active_issues"] or 0,
        "avg_resolution_hours":   round(float(stats["avg_resolution_hours"] or 0), 1),
        "unique_reporters":       stats["unique_reporters"] or 0,
        "total_people_impacted":  stats["total_people_impacted"] or 0,
        "active_authorities":     auth_count["total_authorities"] or 0,
        "by_category":            by_category
    }
