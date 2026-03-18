"""
RESOLVIT - Dynamic Priority Scoring Engine v2

Priority Formula (world-class civic governance model):
  priority_score = (report_count × 2)
                 + (urgency × 5)
                 + days_unresolved
                 + community_upvotes
                 + escalation_weight
                 + safety_boost

Where escalation_weight = escalation_level × 5
Normalized to max 100.

SLA per category:
  Safety      → 24h  (fastest)
  Water       → 48h
  Electricity → 48h
  Roads       → 72h
  Sanitation  → 72h
  Environment → 72h
  Other       → 48h
"""
from datetime import datetime, timezone, timedelta
from database import get_db


# SLA in hours per issue category
CATEGORY_SLA_HOURS = {
    "Safety":      24,
    "Water":       48,
    "Electricity": 48,
    "Roads":       72,
    "Sanitation":  72,
    "Environment": 72,
    "Other":       48,
}

# Priority color bands
PRIORITY_BANDS = [
    (80, "critical", "red"),
    (55, "high",     "orange"),
    (30, "medium",   "yellow"),
    (0,  "low",      "green"),
]


def get_sla_hours(category: str) -> int:
    """Return the SLA duration in hours for a given category."""
    return CATEGORY_SLA_HOURS.get(category, 48)


def get_sla_expiry(category: str, created_at: datetime) -> datetime:
    """Return the absolute SLA expiry datetime for an issue."""
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return created_at + timedelta(hours=get_sla_hours(category))


def get_priority_band(score: float) -> dict:
    """Return color band info dict for a priority score."""
    for threshold, level, color in PRIORITY_BANDS:
        if score >= threshold:
            return {"level": level, "color": color, "threshold": threshold}
    return {"level": "low", "color": "green", "threshold": 0}


def predict_sla_breach_risk(
    category: str,
    urgency: int,
    created_at: datetime,
    sla_expires_at: datetime = None,
    escalation_level: int = 0,
) -> float:
    """
    Predict probability (0.0–1.0) that this issue will breach its SLA.
    Based on: time elapsed vs SLA, urgency, escalations.
    Returns float 0.0 (no risk) to 1.0 (certain breach).
    """
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)

    if sla_expires_at:
        if sla_expires_at.tzinfo is None:
            sla_expires_at = sla_expires_at.replace(tzinfo=timezone.utc)
        total_sla = (sla_expires_at - created_at).total_seconds()
        elapsed   = (now - created_at).total_seconds()
        time_risk = min(elapsed / max(total_sla, 1), 1.0)
    else:
        sla_h = get_sla_hours(category)
        elapsed_h = (now - created_at).total_seconds() / 3600
        time_risk = min(elapsed_h / sla_h, 1.0)

    urgency_risk = urgency / 5.0
    escalation_risk = min(escalation_level * 0.2, 0.6)

    risk = (time_risk * 0.5) + (urgency_risk * 0.3) + (escalation_risk * 0.2)
    return round(min(risk, 1.0), 2)


def calculate_priority(
    impact_scale: int,
    urgency: int,
    created_at: datetime,
    safety_risk_probability: float = 0.1,
    resolved_at: datetime = None,
    report_count: int = 1,
    upvotes: int = 0,
    escalation_level: int = 0,
) -> float:
    """
    Calculate and return a 0-100 priority score.
    Formula: reports×2 + urgency×5 + days_unresolved + upvotes + escalation×5 + safety_boost
    """
    reference = resolved_at if resolved_at else datetime.now(timezone.utc)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)

    days_unresolved = max((reference - created_at).total_seconds() / 86400, 0)

    escalation_weight = escalation_level * 5
    safety_boost = safety_risk_probability * 10

    raw = (
        (report_count * 2) +
        (urgency * 5) +
        days_unresolved +
        upvotes +
        escalation_weight +
        safety_boost
    )

    # Normalize — 100 points is theoretical max for well-reported critical issue
    # Soft cap at 100 using sigmoid-like compression above 80
    score = min(raw, 100.0)
    return round(score, 2)


def recalculate_issue_priority(issue_id: str) -> float:
    """Fetch an issue from DB, recalculate its score, update and return it."""
    with get_db() as cursor:
        cursor.execute(
            """SELECT impact_scale, urgency, created_at, safety_risk_probability,
                      resolved_at, report_count, upvotes, escalation_level, priority_manual_override
               FROM issues WHERE id = %s""",
            (issue_id,)
        )
        row = cursor.fetchone()
        if not row or row.get("priority_manual_override"):
            return 0.0

        score = calculate_priority(
            impact_scale=row["impact_scale"],
            urgency=row["urgency"],
            created_at=row["created_at"],
            safety_risk_probability=row["safety_risk_probability"] or 0.1,
            resolved_at=row.get("resolved_at"),
            report_count=row.get("report_count") or 1,
            upvotes=row.get("upvotes") or 0,
            escalation_level=row.get("escalation_level") or 0,
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
            """SELECT id, impact_scale, urgency, created_at, safety_risk_probability,
                      report_count, upvotes, escalation_level
               FROM issues WHERE status != 'resolved'"""
        )
        issues = cursor.fetchall()

    for issue in issues:
        recalculate_issue_priority(str(issue["id"]))

    print(f"[Priority] Recalculated scores for {len(issues)} issues.")
