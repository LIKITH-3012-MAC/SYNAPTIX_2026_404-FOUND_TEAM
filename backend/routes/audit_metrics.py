"""
RESOLVIT - Audit & Metrics Routes

GET /api/audit/{issue_id}          - Full blockchain audit chain
GET /api/metrics/leaderboard       - Authority performance leaderboard
GET /api/metrics/summary           - Platform-wide stats
"""
from fastapi import APIRouter, HTTPException
from database import get_db
from services.blockchain import get_audit_chain, verify_chain_integrity

# ── Audit Router ──────────────────────────────────────────────
audit_router = APIRouter()

@audit_router.get("/{issue_id}")
def get_audit_log(issue_id: str):
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
def get_platform_summary():
    """Return platform-wide statistics for the dashboard."""
    with get_db() as cursor:
        cursor.execute(
            """
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
            """
        )
        stats = dict(cursor.fetchone())

        cursor.execute("SELECT COUNT(*) AS total_authorities FROM users WHERE role = 'authority' AND is_active = true")
        auth_count = cursor.fetchone()

        cursor.execute(
            """
            SELECT category, COUNT(*) AS count
            FROM issues
            GROUP BY category
            ORDER BY count DESC
            """
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
