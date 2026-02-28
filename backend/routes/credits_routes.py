"""
RESOLVIT - Civic Credits Routes

GET /api/credits/me             → My points total, badge, rank, recent transactions
GET /api/credits/leaderboard    → Top citizens by total points
POST /api/credits/upvote/{id}   → Upvote an issue (+5 pts to voter)
"""
from fastapi import APIRouter, Depends, HTTPException
from database import get_db
from auth import get_current_user

router = APIRouter()

BADGE_THRESHOLDS = [
    (5000, "🏆 Urban Champion"),
    (1000, "🦸 Civic Hero"),
    (500,  "🛡️ City Guardian"),
    (100,  "⭐ Contributor"),
    (0,    "🌱 Newcomer"),
]


def get_badge(points: int) -> str:
    for threshold, badge in BADGE_THRESHOLDS:
        if points >= threshold:
            return badge
    return "🌱 Newcomer"


@router.get("/me")
def get_my_credits(current_user: dict = Depends(get_current_user)):
    """Return total civic points, badge, rank, and recent 10 transactions."""
    user_id = current_user["sub"]
    with get_db() as cursor:
        # Total points
        cursor.execute(
            "SELECT COALESCE(SUM(points), 0) AS total FROM civic_credits WHERE user_id = %s",
            (user_id,)
        )
        total = cursor.fetchone()["total"]

        # Rank (count users with more points)
        cursor.execute(
            """SELECT COUNT(*) + 1 AS rank FROM (
                 SELECT user_id, SUM(points) AS pts
                 FROM civic_credits
                 GROUP BY user_id
                 HAVING SUM(points) > %s
               ) AS sub""",
            (total,)
        )
        rank = cursor.fetchone()["rank"]

        # Recent transactions
        cursor.execute(
            """SELECT action_type, points, description, created_at
               FROM civic_credits
               WHERE user_id = %s
               ORDER BY created_at DESC LIMIT 10""",
            (user_id,)
        )
        transactions = [dict(r) for r in cursor.fetchall()]
        for t in transactions:
            if t.get("created_at"):
                t["created_at"] = t["created_at"].isoformat()

    return {
        "total_points": int(total),
        "badge": get_badge(int(total)),
        "rank": int(rank),
        "transactions": transactions,
    }


@router.get("/leaderboard")
def get_credits_leaderboard():
    """Return top 20 citizens by total civic credits."""
    with get_db() as cursor:
        cursor.execute(
            """SELECT u.id, u.username, u.full_name, u.email,
                      COALESCE(SUM(cc.points), 0) AS total_points,
                      COUNT(cc.id) AS transaction_count
               FROM users u
               LEFT JOIN civic_credits cc ON cc.user_id = u.id
               WHERE u.role = 'citizen'
               GROUP BY u.id, u.username, u.full_name, u.email
               ORDER BY total_points DESC
               LIMIT 20""",
        )
        rows = cursor.fetchall()

    result = []
    for i, r in enumerate(rows):
        pts = int(r["total_points"] or 0)
        result.append({
            "rank": i + 1,
            "user_id": str(r["id"]),
            "username": r["username"],
            "full_name": r["full_name"] or r["username"],
            "total_points": pts,
            "badge": get_badge(pts),
            "transaction_count": int(r["transaction_count"] or 0),
        })
    return result


@router.post("/upvote/{issue_id}")
def upvote_issue(issue_id: str, current_user: dict = Depends(get_current_user)):
    """Upvote an issue. Awards +5 pts to voter and increments issue upvote counter."""
    user_id = current_user["sub"]
    with get_db() as cursor:
        # Check issue exists
        cursor.execute("SELECT id, reporter_id FROM issues WHERE id = %s", (issue_id,))
        issue = cursor.fetchone()
        if not issue:
            raise HTTPException(status_code=404, detail="Issue not found")

        # Check not already upvoted (simple check: look for existing upvote credit)
        cursor.execute(
            """SELECT id FROM civic_credits
               WHERE user_id = %s AND issue_id = %s AND action_type = 'upvote'""",
            (user_id, issue_id)
        )
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail="Already upvoted this issue")

        # Increment upvote count on issue
        cursor.execute(
            "UPDATE issues SET upvotes = COALESCE(upvotes, 0) + 1, updated_at = NOW() WHERE id = %s",
            (issue_id,)
        )

        # Award +5 credits to voter
        cursor.execute(
            """INSERT INTO civic_credits (user_id, issue_id, action_type, points, description)
               VALUES (%s, %s, 'upvote', 5, 'Upvoted a community issue')""",
            (user_id, issue_id)
        )

    return {"message": "Upvoted successfully", "points_earned": 5}
