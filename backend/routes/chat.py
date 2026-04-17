"""
RESOLVIT AI COPILOT
Chatbot Router
"""

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional

from database import get_db
from auth import get_current_user
from services.ai_service import stream_groq_chat
from models import IssueCreate, IssueResponse, DataResponse
from services.priority import calculate_priority, get_sla_hours, get_sla_expiry
from services.blockchain import log_event
from services.escalation import award_credits

router = APIRouter()

# -----------------------------
# Pydantic Schemas
# -----------------------------
class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    user_role: str = "citizen"

class ChatResponse(BaseModel):
    text: str
    action: str
    sources: List[str]

class ChatIntakeRequest(BaseModel):
    title: str
    description: str
    category: str
    urgency: int
    impact_scale: int
    safety_risk_probability: float
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    image_url: Optional[str] = None

# -----------------------------
# Endpoints
# -----------------------------

@router.post("", response_model=ChatResponse)
async def process_chat(payload: ChatRequest):
    """
    Standard AI Copilot conversation endpoint.
    Not strictly authenticated (so guests can ask questions), but accepts user role context.
    """
    try:
        # Convert Pydantic list to dict list for Groq
        messages_dict = [{"role": msg.role, "content": msg.content} for msg in payload.messages]
        reply_data = await stream_groq_chat(messages_dict, payload.user_role)
        return reply_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/complaint-intake", status_code=201, response_model=DataResponse[IssueResponse])
def chat_complaint_intake(
    payload: ChatIntakeRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Processes a structured complaint sent directly from the Copilot mini-form.
    MANDATORY LOGIN: Protected by Depends(get_current_user).
    """
    issue_id = str(uuid.uuid4())
    reporter_id = current_user["sub"]
    
    # Map raw strings to enums/expected values if necessary based on your database schema
    category = payload.category.lower() if payload.category else "other"
    now = datetime.now(timezone.utc)

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
        cursor.execute(
            """
            INSERT INTO issues
                (id, title, description, category, latitude, longitude,
                 urgency, impact_scale, image_url, status, priority_score,
                 safety_risk_probability, sla_hours, sla_expires_at,
                 upvotes, report_count, escalation_level,
                 reporter_id, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'reported',%s,%s,%s,%s,0,1,0,%s,NOW(),NOW())
            RETURNING *
            """,
            (
                issue_id, payload.title, payload.description, category,
                payload.latitude, payload.longitude, payload.urgency,
                payload.impact_scale, payload.image_url,
                priority_score, payload.safety_risk_probability,
                sla_hours, sla_expires_at,
                reporter_id
            )
        )
        issue = dict(cursor.fetchone())

        if payload.image_url:
            cursor.execute(
                """
                INSERT INTO issue_attachments (issue_id, file_url, file_name, file_type, uploaded_by)
                VALUES (%s, %s, %s, 'photo', %s)
                """,
                (issue_id, payload.image_url, "primary_evidence.jpg", reporter_id)
            )

        # Award +10 civic credits to reporter
        award_credits(
            user_id=reporter_id,
            issue_id=issue_id,
            action_type="report_issue_bot",
            points=10,
            description=f"Reported issue via AI Copilot: {payload.title[:60]}",
            cursor=cursor
        )

    # Blockchain audit log
    log_event(
        issue_id=issue_id,
        event_type="created",
        actor_id=reporter_id,
        new_value={
            "title": payload.title,
            "category": category,
            "urgency": payload.urgency,
            "priority_score": priority_score,
            "source": "chatbot",
        },
        title=payload.title,
        description=payload.description
    )

    # Use issues.py serializer to format output safely
    from routes.issues import _serialize_issue
    return {
        "success": True,
        "message": "Issue intelligently routed and created via AI Copilot",
        "data": _serialize_issue(issue, show_email=True)
    }
