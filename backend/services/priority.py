"""
RESOLVIT - Dynamic Priority Scoring Engine

Priority Formula:
  priority_score = (impact_scale * 0.4)
                 + (urgency * 0.3)
                 + (days_unresolved * 0.2)
                 + (safety_risk_probability * 0.1)

Normalized to 0-100 scale.
"""
from datetime import datetime, timezone
from database import get_db


# Normalization constants (tune based on real data)
MAX_IMPACT       = 1000.0   # People affected cap for normalization
MAX_URGENCY      = 5.0
MAX_DAYS         = 30.0     # Days after which score maxes out
MAX_SAFETY       = 1.0


def _normalize(value, max_val):
    return min(value / max_val, 1.0) * 100


def calculate_priority(
    impact_scale: int,
    urgency: int,
    created_at: datetime,
    safety_risk_probability: float = 0.1,
    resolved_at: datetime = None
) -> float:
    """
    Calculate and return a 0-100 priority score.
    """
    # Use resolved_at if available to stop the clock
    reference = resolved_at if resolved_at else datetime.now(timezone.utc)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)

    days_unresolved = max((reference - created_at).total_seconds() / 86400, 0)

    # Weighted score (each component normalized to 0-100)
    score = (
        _normalize(impact_scale, MAX_IMPACT)     * 0.40 +
        _normalize(urgency,      MAX_URGENCY)    * 0.30 +
        _normalize(days_unresolved, MAX_DAYS)    * 0.20 +
        _normalize(safety_risk_probability, MAX_SAFETY) * 0.10
    )

    return round(min(score, 100.0), 2)


def recalculate_issue_priority(issue_id: str) -> float:
    """Fetch an issue from DB, recalculate its score, update and return it."""
    with get_db() as cursor:
        cursor.execute(
            "SELECT impact_scale, urgency, created_at, safety_risk_probability, resolved_at "
            "FROM issues WHERE id = %s",
            (issue_id,)
        )
        row = cursor.fetchone()
        if not row:
            return 0.0

        score = calculate_priority(
            impact_scale=row["impact_scale"],
            urgency=row["urgency"],
            created_at=row["created_at"],
            safety_risk_probability=row["safety_risk_probability"] or 0.1,
            resolved_at=row.get("resolved_at")
        )

        cursor.execute(
            "UPDATE issues SET priority_score = %s, updated_at = NOW() WHERE id = %s",
            (score, issue_id)
        )
    return score


def recalculate_all_priorities():
    """Background job: recalculate priority for all unresolved issues."""
    with get_db() as cursor:
        cursor.execute(
            "SELECT id, impact_scale, urgency, created_at, safety_risk_probability "
            "FROM issues WHERE status != 'resolved'"
        )
        issues = cursor.fetchall()

    for issue in issues:
        recalculate_issue_priority(str(issue["id"]))

    print(f"[Priority] Recalculated scores for {len(issues)} issues.")
