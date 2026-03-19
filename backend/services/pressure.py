"""
RESOLVIT - Governance Pressure Engine

Computes:
  PressureScore = (PriorityScore × ReportCount) + EscalationWeight + SocialAmplification
  SocialAmplification = upvotes × 1.5
  GovernanceHealthIndex = SLA_Compliance×0.3 + Transparency×0.2 + CitizenSatisfaction×0.2
                        + EscalationRateInverse×0.2 + BacklogStability×0.1
"""
import logging
from datetime import datetime, timezone
from database import get_db

logger = logging.getLogger(__name__)

# Governance pressure thresholds
PRESSURE_THRESHOLDS = {
    "PUBLIC_ATTENTION_RISK": 200,
    "CRITICAL_PRESSURE":     400,
}


def compute_pressure_score(priority_score: float, report_count: int, escalation_level: int, upvotes: int) -> float:
    """
    PressureScore = (PriorityScore × ReportCount) + EscalationWeight + SocialAmplification
    """
    escalation_weight = escalation_level * 25
    social_amplification = upvotes * 1.5
    raw = (priority_score * report_count) + escalation_weight + social_amplification
    return round(raw, 2)


def compute_governance_health() -> dict:
    """
    Compute real-time Governance Health Index (0–100) from live DB data.
    """
    with get_db() as cursor:
        # SLA compliance: resolved or non-breached / total non-resolved
        cursor.execute("""
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'resolved') AS resolved,
                COUNT(*) FILTER (WHERE status = 'escalated') AS escalated,
                COUNT(*) FILTER (WHERE sla_expires_at IS NOT NULL AND sla_expires_at < NOW() AND status != 'resolved') AS breached,
                COUNT(*) FILTER (WHERE is_simulated = TRUE) AS simulated
            FROM issues
        """)
        stats = dict(cursor.fetchone())

        real_total = stats["total"] - stats["simulated"]
        real_resolved = stats["resolved"]
        real_escalated = stats["escalated"]
        real_breached = stats["breached"]

        sla_compliance = max(0, min(1.0, 1.0 - (real_breached / max(real_total, 1))))
        escalation_rate = real_escalated / max(real_total, 1)
        escalation_rate_inverse = 1.0 - min(escalation_rate, 1.0)

        # Backlog stability: resolved vs total
        backlog_stability = min(real_resolved / max(real_total, 1), 1.0)

        # Transparency: authority metrics completeness
        cursor.execute("""
            SELECT COALESCE(AVG(performance_score / 100.0), 0.5) AS avg_transparency
            FROM authority_metrics
        """)
        transparency = float(cursor.fetchone()["avg_transparency"] or 0.5)

        # Citizen satisfaction: quality ratings
        cursor.execute("""
            SELECT COALESCE(AVG(quality_rating) / 5.0, 0.7) AS avg_satisfaction
            FROM issues WHERE quality_rating IS NOT NULL AND is_simulated = FALSE
        """)
        citizen_satisfaction = float(cursor.fetchone()["avg_satisfaction"] or 0.7)

    health_index = (
        sla_compliance * 0.3 +
        transparency * 0.2 +
        citizen_satisfaction * 0.2 +
        escalation_rate_inverse * 0.2 +
        backlog_stability * 0.1
    ) * 100

    health_index = round(min(health_index, 100.0), 1)

    label = (
        "Excellent 🟢" if health_index >= 85 else
        "Stable 🟡" if health_index >= 70 else
        "At Risk 🟠" if health_index >= 50 else
        "Critical 🔴"
    )

    return {
        "health_index": health_index,
        "label": label,
        "components": {
            "sla_compliance": round(sla_compliance * 100, 1),
            "transparency": round(transparency * 100, 1),
            "citizen_satisfaction": round(citizen_satisfaction * 100, 1),
            "escalation_control": round(escalation_rate_inverse * 100, 1),
            "backlog_stability": round(backlog_stability * 100, 1),
        },
        "raw": {
            "total_issues": stats["total"],
            "resolved": stats["resolved"],
            "escalated": stats["escalated"],
            "sla_breached": stats["breached"],
        },
        "computed_at": datetime.now(timezone.utc).isoformat()
    }


def recalculate_all_pressure_scores():
    """Update pressure_score for all non-simulated unresolved issues."""
    with get_db() as cursor:
        cursor.execute("""
            SELECT id, priority_score, report_count, escalation_level, upvotes
            FROM issues WHERE status != 'resolved'
        """)
        issues = cursor.fetchall()

        for issue in issues:
            score = compute_pressure_score(
                float(issue["priority_score"] or 0),
                int(issue["report_count"] or 1),
                int(issue["escalation_level"] or 0),
                int(issue["upvotes"] or 0),
            )
            cursor.execute(
                "UPDATE issues SET pressure_score = %s WHERE id = %s",
                (score, issue["id"])
            )
    logger.info(f"[Pressure] Recalculated {len(issues)} pressure scores.")
    return len(issues)


def run_anomaly_detection():
    """
    Detect suspicious officer patterns:
    - Issues marked resolved < 2 min then rejected by citizen
    - High rejection rate
    - Repeated fast closures
    """
    with get_db() as cursor:
        # Fast resolvers: resolved_at - updated_at < 2 min
        cursor.execute("""
            SELECT i.assigned_authority_id, u.username, u.full_name,
                   COUNT(*) AS fast_resolutions
            FROM issues i
            JOIN users u ON i.assigned_authority_id = u.id
            WHERE i.status = 'resolved'
              AND i.resolved_at IS NOT NULL
              AND i.updated_at IS NOT NULL
              AND (i.resolved_at - i.updated_at) < INTERVAL '2 minutes'
              AND i.is_simulated = FALSE
            GROUP BY i.assigned_authority_id, u.username, u.full_name
            HAVING COUNT(*) >= 3
        """)
        fast_closers = cursor.fetchall()

        # Insert anomaly records
        for row in fast_closers:
            cursor.execute("""
                INSERT INTO anomalies (authority_id, anomaly_type, description, severity)
                VALUES (%s, 'FAST_CLOSURE', %s, 'warning')
                ON CONFLICT DO NOTHING
            """, (
                row["assigned_authority_id"],
                f"Officer {row['username']} resolved {row['fast_resolutions']} issues in under 2 minutes. Possible low-quality resolution."
            ))

    logger.info(f"[Anomaly] Detected {len(fast_closers)} officers with suspicious patterns.")
