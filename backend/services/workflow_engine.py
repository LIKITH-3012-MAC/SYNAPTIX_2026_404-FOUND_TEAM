"""
RESOLVIT - Workflow Engine
Production-grade issue processing pipeline.
"""
import uuid
import json
from datetime import datetime, timezone
from typing import Optional

from database import get_db
from models import IssueCreate, IssueResponse
from services.priority import calculate_priority, get_sla_hours, get_sla_expiry
from services.clustering import attempt_clustering
from services.blockchain import log_event
from services.escalation import award_credits

class WorkflowEngine:
    @staticmethod
    def process_new_issue(payload: IssueCreate, reporter_id: str) -> dict:
        """
        The definitive pipeline for creating a civic issue.
        1. SLA & Priority Calculation
        2. Database Persistence
        3. Evidence Registration
        4. Clustering & Hotspot Detection
        5. Gamification (Credits)
        6. Blockchain Audit Log
        7. Real-time Event Trigger (Implicit in DB save)
        """
        issue_id = str(uuid.uuid4())
        category = payload.category.value if hasattr(payload.category, "value") else str(payload.category)
        now = datetime.now(timezone.utc)

        # 1. SLA & Priority
        sla_hours = get_sla_hours(category)
        sla_expires_at = get_sla_expiry(category, now)
        
        priority_score = calculate_priority(
            impact_scale=payload.impact_scale,
            urgency=payload.urgency,
            created_at=now,
            safety_risk_probability=payload.safety_risk_probability,
            report_count=1,
            upvotes=0,
            escalation_level=0,
        )

        with get_db() as cursor:
            # 2. Database Persistence
            cursor.execute(
                """
                INSERT INTO issues
                    (id, title, description, category, latitude, longitude, address,
                     urgency, impact_scale, image_url, status, priority_score,
                     safety_risk_probability, sla_hours, sla_expires_at,
                     upvotes, report_count, escalation_level,
                     reporter_id, source, created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'reported',%s,%s,%s,%s,0,1,0,%s,%s,NOW(),NOW())
                RETURNING *
                """,
                (
                    issue_id, payload.title, payload.description, category,
                    payload.latitude, payload.longitude, payload.address or payload.location_text,
                    payload.urgency, payload.impact_scale, payload.image_url,
                    priority_score, payload.safety_risk_probability,
                    sla_hours, sla_expires_at,
                    reporter_id, payload.source
                )
            )
            issue = dict(cursor.fetchone())

            # 3. Evidence Registration
            if payload.image_url:
                cursor.execute(
                    """
                    INSERT INTO issue_attachments (issue_id, file_url, file_name, file_type, uploaded_by)
                    VALUES (%s, %s, %s, 'photo', %s)
                    """,
                    (issue_id, payload.image_url, "primary_evidence.jpg", reporter_id)
                )

            # 4. Clustering
            if payload.latitude and payload.longitude:
                try:
                    cluster_id = attempt_clustering(
                        issue_id=issue_id,
                        title=payload.title,
                        category=category,
                        latitude=payload.latitude,
                        longitude=payload.longitude
                    )
                    if cluster_id:
                        issue["cluster_id"] = cluster_id
                        issue["status"] = "clustered"
                except Exception as e:
                    print(f"[WorkflowEngine] Clustering Error: {e}")

            # 5. Gamification (Credits)
            action_type = "report_issue_bot" if payload.source == "copilot_chat" else "report_issue"
            award_credits(
                user_id=reporter_id,
                issue_id=issue_id,
                action_type=action_type,
                points=15 if payload.source == "copilot_chat" else 10, # Bonus for using AI
                description=f"Reported issue via {payload.source}: {payload.title[:60]}",
                cursor=cursor
            )

        # 6. Blockchain Audit Log
        log_event(
            issue_id=issue_id,
            event_type="created",
            actor_id=reporter_id,
            new_value={
                "title": payload.title,
                "category": category,
                "urgency": payload.urgency,
                "priority_score": priority_score,
                "source": payload.source,
                "cluster_id": issue.get("cluster_id")
            },
            title=payload.title,
            description=payload.description
        )

        return issue
