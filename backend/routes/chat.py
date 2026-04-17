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
from services.workflow_engine import WorkflowEngine
from models import IssueCreate, IssueResponse, DataResponse

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

# Using IssueCreate directly for intake to ensure consistency

# -----------------------------
# Endpoints
# -----------------------------

@router.post("/chat", response_model=ChatResponse)
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


@router.post("/chat/complaint-intake", status_code=201, response_model=DataResponse[IssueResponse])
def chat_complaint_intake(
    payload: IssueCreate,
    current_user: dict = Depends(get_current_user)
):
    """
    Processes a structured complaint sent from the Copilot.
    MANDATORY LOGIN: Protected by Depends(get_current_user).
    """
    try:
        reporter_id = current_user["sub"]
        
        # Enforce source
        payload.source = "copilot_chat"
        
        issue_data = WorkflowEngine.process_new_issue(payload, reporter_id)

        # Use issues.py serializer to format output safely
        from routes.issues import _serialize_issue
        return {
            "success": True,
            "message": "Issue intelligently routed and created via AI Copilot",
            "data": _serialize_issue(issue_data, show_email=True)
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
