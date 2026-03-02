"""
RESOLVIT - Feedback Routes
POST /api/feedback
"""
from fastapi import APIRouter, Depends, HTTPException
from models import AppFeedbackCreate, MessageResponse
from database import get_db
from auth import get_current_user
import uuid

router = APIRouter()

@router.post("", response_model=MessageResponse)
def submit_feedback(payload: AppFeedbackCreate, current_user: dict = Depends(get_current_user)):
    """Submit app feedback (UI/UX/Experience). Only for logged-in users."""
    user_id = current_user["sub"]
    
    with get_db() as cursor:
        cursor.execute(
            """
            INSERT INTO app_feedback (id, user_id, ui_rating, ux_rating, experience_rating, comment)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                str(uuid.uuid4()),
                user_id,
                payload.ui_rating,
                payload.ux_rating,
                payload.experience_rating,
                payload.comment
            )
        )
    
    return {"message": "Thank you for your feedback! It helps us build a better RESOLVIT."}
