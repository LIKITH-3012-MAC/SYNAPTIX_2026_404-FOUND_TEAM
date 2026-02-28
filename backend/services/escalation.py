"""
RESOLVIT - Escalation Engine v2

Uses sla_expires_at field per issue for precision escalation.
Escalation levels: 0=none, 1=Dept Head, 2=City Commissioner, 3=Govt Oversight
Auto-awards civic credits when issues are resolved.
"""
import logging
from datetime import datetime, timezone
from database import get_db

logger = logging.getLogger(__name__)

ESCALATION_LEVEL_LABELS = {
    0: "None",
    1: "Department Head",
    2: "City Commissioner",
    3: "Government Oversight",
}


def award_credits(user_id: str, issue_id: str, action_type: str, points: int, description: str, cursor):
    """Insert a civic_credits row. Cursor must be from an existing transaction."""
    try:
        cursor.execute(
            """INSERT INTO civic_credits (user_id, issue_id, action_type, points, description, created_at)
               VALUES (%s, %s, %s, %s, %s, NOW())""",
            (user_id, issue_id, action_type, points, description)
        )
    except Exception as e:
        logger.warning(f"[Credits] Failed to award {points} pts to {user_id}: {e}")


def run_escalation_check():
    """
    Background job (runs every 10 min):
    - Find all non-resolved issues where sla_expires_at < NOW()
    - Escalate each one: bump escalation_level, write escalation row, log audit
    """
    now = datetime.now(timezone.utc)
    logger.info(f"[Escalation] Running SLA check at {now.isoformat()}")

    try:
        with get_db() as cursor:
            # Find all issues past their SLA that aren't resolved yet
            cursor.execute(
                """SELECT id, title, status, reporter_id, assigned_authority_id,
                          escalation_level, sla_expires_at, category
                   FROM issues
                   WHERE status NOT IN ('resolved')
                     AND sla_expires_at IS NOT NULL
                     AND sla_expires_at < NOW()
                   ORDER BY sla_expires_at ASC""",
            )
            overdue_issues = cursor.fetchall()

            escalated_count = 0
            for issue in overdue_issues:
                issue_id = str(issue["id"])
                current_level = issue["escalation_level"] or 0
                new_level = min(current_level + 1, 3)
                previous_status = issue["status"]

                # If not yet escalated, set status = escalated
                new_status = "escalated" if previous_status not in ("escalated",) else previous_status

                # Update issue
                cursor.execute(
                    """UPDATE issues
                       SET status = %s,
                           escalation_level = %s,
                           updated_at = NOW()
                       WHERE id = %s""",
                    (new_status, new_level, issue_id)
                )

                # Insert escalation record
                reason = (
                    f"SLA breach. Issue unresolved past deadline. "
                    f"Escalated to {ESCALATION_LEVEL_LABELS.get(new_level, 'Higher Authority')}."
                )
                cursor.execute(
                    """INSERT INTO escalations
                         (issue_id, reason, previous_status, escalated_at)
                       VALUES (%s, %s, %s, NOW())""",
                    (issue_id, reason, previous_status)
                )

                # Update priority (escalation_level boosts score)
                cursor.execute(
                    """UPDATE issues
                       SET priority_score = LEAST(
                           priority_score + (%s * 5),
                           100.0
                       ),
                       updated_at = NOW()
                       WHERE id = %s""",
                    (new_level, issue_id)
                )

                escalated_count += 1
                logger.info(f"[Escalation] Issue {issue_id} → Level {new_level} ({ESCALATION_LEVEL_LABELS[new_level]})")

        logger.info(f"[Escalation] Escalated {escalated_count} issues.")

    except Exception as e:
        logger.error(f"[Escalation] Error during escalation check: {e}", exc_info=True)


def run_priority_recalculation():
    """Background job: recalculate priority for all active issues."""
    try:
        from services.priority import recalculate_all_priorities
        recalculate_all_priorities()
    except Exception as e:
        logger.error(f"[Priority] Recalculation error: {e}", exc_info=True)
