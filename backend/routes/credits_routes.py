"""
RESOLVIT - Unified Civic Credits & Reputation Engine
Standardized to use citizen_activity ledger.
"""
from fastapi import APIRouter, Depends, HTTPException
from database import get_db
from auth import get_current_user
from typing import List, Optional
from pydantic import BaseModel

router = APIRouter()

BADGE_THRESHOLDS = [
    (5000, "🏆 Urban Champion"),
    (2500, "🏅 Elite Guardian"),
    (1000, "🦸 Civic Hero"),
    (500,  "🛡️ City Guardian"),
    (250,  "🎖️ Senior Contributor"),
    (100,  "⭐ Contributor"),
    (0,    "🌱 New Citizen"),
]

def get_badge(points: int) -> str:
    for threshold, badge in BADGE_THRESHOLDS:
        if points >= threshold:
            return badge
    return "🌱 New Citizen"

@router.get("/me")
def get_my_credits_full(current_user: dict = Depends(get_current_user)):
    """Return total civic points, badge, rank, and recent 10 transactions."""
    user_id = current_user["sub"]
    with get_db() as cursor:
        # 1. Get points from cache in users table
        cursor.execute("SELECT points_cache, rank FROM users WHERE id = %s", (user_id,))
        user_row = cursor.fetchone()
        total_points = user_row["points_cache"] if user_row else 0
        current_rank_label = user_row["rank"] if user_row else "New Citizen"

        # 2. Global Rank Calculation (Heuristic)
        cursor.execute(
            "SELECT COUNT(*) + 1 AS rank FROM users WHERE points_cache > %s AND role = 'citizen'",
            (total_points,)
        )
        global_rank = cursor.fetchone()["rank"]

        # 3. Recent Activity from citizen_activity
        cursor.execute(
            """SELECT action, credits_delta, note, created_at
               FROM citizen_activity
               WHERE user_id = %s
               ORDER BY created_at DESC LIMIT 10""",
            (user_id,)
        )
        rows = cursor.fetchall()
        transactions = []
        for r in rows:
            t = dict(r)
            if t.get("created_at") and hasattr(t["created_at"], "isoformat"):
                t["created_at"] = t["created_at"].isoformat()
            transactions.append(t)

    return {
        "total_points": int(total_points),
        "badge": get_badge(int(total_points)),
        "rank": int(global_rank),
        "rank_label": current_rank_label,
        "transactions": transactions,
    }

@router.get("/leaderboard")
def get_credits_leaderboard():
    """Return top 20 citizens by total civic credits."""
    with get_db() as cursor:
        cursor.execute(
            """SELECT id, username, full_name, points_cache, rank
               FROM users
               WHERE role = 'citizen' AND is_active = TRUE
               ORDER BY points_cache DESC
               LIMIT 20""",
        )
        rows = cursor.fetchall()

    result = []
    for i, r in enumerate(rows):
        pts = int(r["points_cache"] or 0)
        result.append({
            "rank": i + 1,
            "user_id": str(r["id"]),
            "username": r["username"],
            "full_name": r["full_name"] or r["username"],
            "total_points": pts,
            "badge": get_badge(pts),
            "rank_label": r["rank"]
        })
    return result

@router.post("/upvote/{issue_id}")
def upvote_issue_and_reward(issue_id: str, current_user: dict = Depends(get_current_user)):
    """Upvote an issue. Awards +5 pts to voter and increments issue upvote counter."""
    user_id = current_user["sub"]
    with get_db() as cursor:
        # 1. Check issue
        cursor.execute("SELECT id, title FROM issues WHERE id = %s", (issue_id,))
        issue = cursor.fetchone()
        if not issue:
            raise HTTPException(status_code=404, detail="Issue not found")

        # 2. Check duplicate upvote in activity ledger
        cursor.execute(
            "SELECT id FROM citizen_activity WHERE user_id = %s AND issue_id = %s AND action = 'upvote'",
            (user_id, issue_id)
        )
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail="Already upvoted this issue")

        # 3. Update Issue Counter
        cursor.execute("UPDATE issues SET upvotes = upvotes + 1 WHERE id = %s", (issue_id,))

        # 4. Award Credits & Update User Cache
        points_to_award = 5
        cursor.execute(
            "UPDATE users SET points_cache = points_cache + %s WHERE id = %s",
            (points_to_award, user_id)
        )
        
        # 5. Log Activity
        cursor.execute(
            """INSERT INTO citizen_activity (user_id, issue_id, action, credits_delta, note)
               VALUES (%s, %s, 'upvote', %s, %s)""",
            (user_id, issue_id, points_to_award, f"Upvoted: {issue['title']}")
        )

    return {"message": "Upvoted successfully", "points_earned": points_to_award}
