"""
RESOLVIT - AI Demo / Simulation Routes

POST /api/simulation/generate    - Generate 100–500 synthetic issues (admin only)
POST /api/simulation/crisis      - Trigger civic crisis scenario
POST /api/simulation/clear       - Delete all simulated issues (admin only)
GET  /api/simulation/status      - Check if demo mode is active
"""
import uuid
import random
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from database import get_db
from auth import require_roles
from datetime import datetime, timezone, timedelta
from services.priority import get_sla_hours, calculate_priority

router = APIRouter(tags=["Demo/Simulation"])

# Kavali, Andhra Pradesh region bounds
KAVALI_BOUNDS = {
    "lat_min": 14.8800, "lat_max": 14.9800,
    "lng_min": 79.9500, "lng_max": 80.0500,
}

# Kavali crisis hotspots (for cluster injection)
CRISIS_HOTSPOTS = [
    {"name": "II Town Police Zone",    "lat": 14.9282, "lng": 79.9900, "radius": 0.008},
    {"name": "Municipal Office Zone",  "lat": 14.9150, "lng": 79.9780, "radius": 0.010},
    {"name": "RDO Office Zone",        "lat": 14.9400, "lng": 80.0100, "radius": 0.007},
]

CATEGORY_WEIGHTS = [
    ("Roads", 30), ("Sanitation", 25), ("Water", 15),
    ("Electricity", 15), ("Safety", 8), ("Environment", 7),
]

SAMPLE_TITLES = {
    "Roads":       ["Pothole on main road", "Road cave-in near market", "Damaged speed breaker", "Road flooding", "Broken road divider"],
    "Sanitation":  ["Overflowing garbage bins", "Sewage overflow", "Open drain near school", "Waste dumping site", "Blocked drainage"],
    "Water":       ["No water supply for 3 days", "Burst water pipe", "Contaminated water", "Low water pressure", "Water meter damage"],
    "Electricity": ["Street light outage", "Fallen electric pole", "Exposed wiring danger", "Transformer sparking", "Power cut for 12h"],
    "Safety":      ["Open manhole on road", "Broken footpath", "Dangerous construction debris", "Illegal encroachment", "Stray dogs menace"],
    "Environment": ["Industrial waste dumping", "Tree fell on road", "Waterlogged park", "Illegal garbage burning", "River encroachment"],
}

def _weighted_choice(weights):
    items, w = zip(*weights)
    total = sum(w)
    r = random.uniform(0, total)
    cum = 0
    for item, weight in zip(items, w):
        cum += weight
        if r <= cum:
            return item
    return items[-1]

def _generate_issue_params(hotspot=None, escalate=False, sla_breach=False):
    category = _weighted_choice(CATEGORY_WEIGHTS)
    titles = SAMPLE_TITLES.get(category, ["Unknown Issue"])
    title = random.choice(titles)
    urgency = random.choices([1,2,3,4,5], weights=[5,15,35,30,15])[0]
    impact = random.randint(10, 2000)

    if hotspot:
        lat = hotspot["lat"] + random.uniform(-hotspot["radius"], hotspot["radius"])
        lng = hotspot["lng"] + random.uniform(-hotspot["radius"], hotspot["radius"])
    else:
        lat = random.uniform(KAVALI_BOUNDS["lat_min"], KAVALI_BOUNDS["lat_max"])
        lng = random.uniform(KAVALI_BOUNDS["lng_min"], KAVALI_BOUNDS["lng_max"])

    sla_h = get_sla_hours(category)
    # Randomize age (0–10 days ago)
    days_ago = random.uniform(0, 10)
    created_at = datetime.now(timezone.utc) - timedelta(days=days_ago)

    if sla_breach:
        # Make it already breached
        sla_expires_at = created_at + timedelta(hours=sla_h * 0.2)
        status = "escalated"
        escalation_level = random.randint(1, 3)
    elif escalate:
        sla_expires_at = created_at + timedelta(hours=sla_h)
        status = random.choice(["escalated", "in_progress"])
        escalation_level = 1
    else:
        sla_expires_at = created_at + timedelta(hours=sla_h)
        days_factor = days_ago / 10.0
        status = random.choices(
            ["reported", "verified", "in_progress", "escalated"],
            weights=[40, 20, 25, 15]
        )[0]
        escalation_level = 0

    upvotes = random.randint(0, 30)
    report_count = random.randint(1, 15)

    priority_score = calculate_priority(
        impact_scale=impact,
        urgency=urgency,
        created_at=created_at,
        report_count=report_count,
        upvotes=upvotes,
        escalation_level=escalation_level,
    )

    return {
        "id": str(uuid.uuid4()),
        "title": title,
        "description": f"Simulated issue: {title} in Kavali area. Requires immediate attention.",
        "category": category,
        "latitude": lat,
        "longitude": lng,
        "urgency": urgency,
        "impact_scale": impact,
        "status": status,
        "priority_score": priority_score,
        "safety_risk_probability": random.uniform(0.1, 0.9) if category == "Safety" else random.uniform(0.05, 0.4),
        "sla_hours": sla_h,
        "sla_expires_at": sla_expires_at,
        "upvotes": upvotes,
        "report_count": report_count,
        "escalation_level": escalation_level,
        "is_simulated": True,
        "created_at": created_at,
        "updated_at": created_at,
    }


class GenerateRequest(BaseModel):
    count: int = 100  # 100–500
    crisis_mode: bool = False


@router.post("/generate")
def generate_simulation(
    payload: GenerateRequest,
    current_user: dict = Depends(require_roles("admin"))
):
    """Generate synthetic issues for demo mode."""
    count = min(max(payload.count, 50), 500)

    issues_to_insert = []

    if payload.crisis_mode:
        # Crisis mode: heavy hotspots + lots of escalations
        hotspot_issues = count * 7 // 10  # 70% in hotspots
        per_hotspot = hotspot_issues // len(CRISIS_HOTSPOTS)
        for hotspot in CRISIS_HOTSPOTS:
            for _ in range(per_hotspot):
                breach = random.random() < 0.4
                esc = random.random() < 0.3
                issues_to_insert.append(_generate_issue_params(hotspot=hotspot, escalate=esc, sla_breach=breach))
        # Fill rest randomly
        for _ in range(count - len(issues_to_insert)):
            issues_to_insert.append(_generate_issue_params(sla_breach=random.random() < 0.1))
    else:
        # Normal demo: 3 high-density hotspots, 5 medium clusters, rest random
        for hotspot in CRISIS_HOTSPOTS:
            for _ in range(25):
                issues_to_insert.append(_generate_issue_params(hotspot=hotspot))
        for _ in range(count - len(issues_to_insert)):
            issues_to_insert.append(_generate_issue_params())

    # Get first available reporter (fallback to admin)
    with get_db() as cursor:
        cursor.execute("SELECT id FROM users WHERE role='citizen' LIMIT 1")
        citizen = cursor.fetchone()
        reporter_id = citizen["id"] if citizen else current_user["sub"]

        inserted = 0
        for issue in issues_to_insert:
            try:
                cursor.execute("""
                    INSERT INTO issues
                        (id, title, description, category, latitude, longitude,
                         urgency, impact_scale, status, priority_score,
                         safety_risk_probability, sla_hours, sla_expires_at,
                         upvotes, report_count, escalation_level,
                         is_simulated, reporter_id, created_at, updated_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,TRUE,%s,%s,%s)
                """, (
                    issue["id"], issue["title"], issue["description"],
                    issue["category"], issue["latitude"], issue["longitude"],
                    issue["urgency"], issue["impact_scale"], issue["status"],
                    issue["priority_score"], issue["safety_risk_probability"],
                    issue["sla_hours"], issue["sla_expires_at"],
                    issue["upvotes"], issue["report_count"], issue["escalation_level"],
                    reporter_id, issue["created_at"], issue["updated_at"]
                ))
                inserted += 1
            except Exception as e:
                pass  # Skip duplicates

    escalated_count = sum(1 for i in issues_to_insert if i["status"] == "escalated")
    breached_count = sum(1 for i in issues_to_insert if i.get("sla_expires_at") and i["sla_expires_at"] < datetime.now(timezone.utc))

    return {
        "message": f"✅ Demo simulation active: {inserted} synthetic issues generated",
        "generated": inserted,
        "crisis_mode": payload.crisis_mode,
        "escalated": escalated_count,
        "sla_breached": breached_count,
        "hotspots": [h["name"] for h in CRISIS_HOTSPOTS],
    }


@router.post("/crisis")
def trigger_crisis(current_user: dict = Depends(require_roles("admin"))):
    """Trigger Civic Crisis Scenario (300 issues, all hotspots, many SLA breaches)."""
    return generate_simulation(GenerateRequest(count=300, crisis_mode=True), current_user)


@router.post("/clear")
def clear_simulation(current_user: dict = Depends(require_roles("admin"))):
    """Delete all simulated issues. Clean state restore."""
    with get_db() as cursor:
        cursor.execute("SELECT COUNT(*) AS cnt FROM issues WHERE is_simulated = TRUE")
        cnt = cursor.fetchone()["cnt"]
        cursor.execute("DELETE FROM issues WHERE is_simulated = TRUE")
    return {
        "message": f"🧹 Simulation cleared: {cnt} synthetic issues removed. Platform restored to real data.",
        "deleted": cnt
    }


@router.get("/status")
def simulation_status():
    """Check if demo mode is active and how many simulated issues exist."""
    with get_db() as cursor:
        cursor.execute("""
            SELECT COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE status='escalated') AS escalated,
                   COUNT(*) FILTER (WHERE sla_expires_at < NOW()) AS breached
            FROM issues WHERE is_simulated = TRUE
        """)
        stats = dict(cursor.fetchone())
    return {
        "active": stats["total"] > 0,
        "simulated_count": stats["total"],
        "simulated_escalated": stats["escalated"],
        "simulated_breached": stats["breached"],
    }
