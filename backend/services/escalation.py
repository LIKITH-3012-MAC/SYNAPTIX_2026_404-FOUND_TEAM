"""
RESOLVIT - Escalation Engine
Background scheduler that auto-escalates stale issues and logs events.
"""
import os
from datetime import datetime, timezone
from database import get_db
from services.blockchain import log_event

ESCALATION_THRESHOLD_DAYS = int(os.getenv("ESCALATION_DAYS", "7"))


def run_escalation_check():
    """
    Runs every hour via APScheduler.
    Auto-escalates issues unresolved beyond the SLA threshold.
    """
    print(f"[Escalation] Running escalation check at {datetime.utcnow().isoformat()}")

    with get_db() as cursor:
        # Find issues that have exceeded the SLA and aren't already resolved/escalated
        cursor.execute(
            """
            SELECT id, title, description, assigned_authority_id, status
            FROM issues
            WHERE status NOT IN ('resolved', 'escalated')
              AND created_at < NOW() - INTERVAL '%s days'
            """,
            (ESCALATION_THRESHOLD_DAYS,)
        )
        stale_issues = cursor.fetchall()

        escalated_count = 0
        for issue in stale_issues:
            issue_id   = str(issue["id"])
            old_status = issue["status"]

            # 1. Update issue status to escalated
            cursor.execute(
                "UPDATE issues SET status = 'escalated', updated_at = NOW() WHERE id = %s",
                (issue_id,)
            )

            # 2. Log escalation event
            cursor.execute(
                """
                INSERT INTO escalations (issue_id, reason, previous_status)
                VALUES (%s, %s, %s)
                """,
                (
                    issue_id,
                    f"Auto-escalated: unresolved for more than {ESCALATION_THRESHOLD_DAYS} days.",
                    old_status
                )
            )

            escalated_count += 1

    # Log to blockchain audit (after DB commit, so separately)
    with get_db() as cursor:
        cursor.execute(
            "SELECT id, title, description FROM issues WHERE status = 'escalated' AND updated_at > NOW() - INTERVAL '5 minutes'"
        )
        recently_escalated = cursor.fetchall()

    for issue in recently_escalated:
        log_event(
            issue_id=str(issue["id"]),
            event_type="auto_escalated",
            old_value={"status": "in_progress"},
            new_value={"status": "escalated"},
            title=issue["title"],
            description=issue["description"]
        )

    print(f"[Escalation] Escalated {escalated_count} issues.")


def update_authority_metrics():
    """
    Recalculate authority performance metrics hourly.
    """
    with get_db() as cursor:
        cursor.execute("SELECT id FROM users WHERE role = 'authority'")
        authorities = cursor.fetchall()

        for auth in authorities:
            auth_id = str(auth["id"])
            cursor.execute(
                """
                SELECT
                    COUNT(*)                                    AS total_assigned,
                    COUNT(*) FILTER (WHERE status = 'resolved') AS total_resolved,
                    COUNT(*) FILTER (WHERE status = 'escalated') AS total_escalated,
                    AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600)
                        FILTER (WHERE status = 'resolved')     AS avg_resolution_hours
                FROM issues
                WHERE assigned_authority_id = %s
                """,
                (auth_id,)
            )
            stats = cursor.fetchone()
            if not stats or stats["total_assigned"] == 0:
                continue

            total    = stats["total_assigned"] or 0
            resolved = stats["total_resolved"] or 0
            escalated = stats["total_escalated"] or 0
            avg_res  = float(stats["avg_resolution_hours"] or 0)

            resolution_rate = resolved / total if total > 0 else 0
            escalation_rate = escalated / total if total > 0 else 0
            # Performance score: weighted
            perf_score = round(
                (resolution_rate * 60) +
                ((1 - escalation_rate) * 30) +
                (max(0, 1 - avg_res / 120) * 10),  # Bonus if fast (<120h)
                1
            )

            cursor.execute(
                """
                INSERT INTO authority_metrics
                    (authority_id, total_assigned, total_resolved, total_escalated,
                     avg_resolution_time, resolution_rate, escalation_rate, performance_score)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (authority_id) DO UPDATE SET
                    total_assigned     = EXCLUDED.total_assigned,
                    total_resolved     = EXCLUDED.total_resolved,
                    total_escalated    = EXCLUDED.total_escalated,
                    avg_resolution_time = EXCLUDED.avg_resolution_time,
                    resolution_rate    = EXCLUDED.resolution_rate,
                    escalation_rate    = EXCLUDED.escalation_rate,
                    performance_score  = EXCLUDED.performance_score,
                    last_calculated_at = NOW(),
                    updated_at         = NOW()
                """,
                (auth_id, total, resolved, escalated, avg_res,
                 resolution_rate, escalation_rate, perf_score)
            )

    print(f"[Metrics] Authority metrics updated for {len(authorities)} authorities.")
