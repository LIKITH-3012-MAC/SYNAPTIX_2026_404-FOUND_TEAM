"""
RESOLVIT - Issues Routes (CRUD + Full Pipeline)

POST   /api/issues           - Create new issue (triggers clustering + scoring + audit)
GET    /api/issues           - List all issues (filterable, sortable, paginated)
GET    /api/issues/{id}      - Get single issue detail
PATCH  /api/issues/{id}      - Update issue (auth/admin only)
DELETE /api/issues/{id}      - Delete issue (admin only)
"""
import uuid
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from models import IssueCreate, IssueUpdate, IssueResponse, MessageResponse
from database import get_db
from auth import get_current_user, require_roles
from services.priority import calculate_priority
from services.clustering import attempt_clustering
from services.blockchain import log_event
from datetime import datetime, timezone

router = APIRouter(prefix="/api/issues", tags=["Issues"])


def _serialize_issue(row: dict) -> dict:
    """Serialize DB row to IssueResponse-compatible dict."""
    r = dict(row)
    r["id"] = str(r["id"])
    r["reporter_id"] = str(r["reporter_id"])
    if r.get("assigned_authority_id"):
        r["assigned_authority_id"] = str(r["assigned_authority_id"])
    if r.get("cluster_id"):
        r["cluster_id"] = str(r["cluster_id"])
    # Days unresolved
    created = r["created_at"]
    if created:
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        resolved = r.get("resolved_at")
        if resolved:
            if resolved.tzinfo is None:
                resolved = resolved.replace(tzinfo=timezone.utc)
            delta = (resolved - created).total_seconds()
        else:
            delta = (datetime.now(timezone.utc) - created).total_seconds()
        r["days_unresolved"] = round(delta / 86400, 1)
    return r


# ── CREATE ────────────────────────────────────────────────────
@router.post("", status_code=201, response_model=IssueResponse)
def create_issue(
    payload: IssueCreate,
    current_user: dict = Depends(get_current_user)
):
    """
    Create a new civic issue. Triggers:
    1. Priority score calculation
    2. AI clustering check
    3. Blockchain audit log
    """
    issue_id = str(uuid.uuid4())
    reporter_id = current_user["sub"]

    # Step 1: Calculate initial priority score
    priority_score = calculate_priority(
        impact_scale=payload.impact_scale,
        urgency=payload.urgency,
        created_at=datetime.now(timezone.utc),
        safety_risk_probability=payload.safety_risk_probability
    )

    with get_db() as cursor:
        cursor.execute(
            """
            INSERT INTO issues
                (id, title, description, category, latitude, longitude,
                 urgency, impact_scale, image_url, status, priority_score,
                 safety_risk_probability, reporter_id, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'reported',%s,%s,%s,NOW(),NOW())
            RETURNING *
            """,
            (
                issue_id, payload.title, payload.description, payload.category.value,
                payload.latitude, payload.longitude, payload.urgency,
                payload.impact_scale, payload.image_url,
                priority_score, payload.safety_risk_probability, reporter_id
            )
        )
        issue = dict(cursor.fetchone())

    # Step 2: AI Clustering (async-style, synchronous MVP)
    if payload.latitude and payload.longitude:
        cluster_id = attempt_clustering(
            issue_id=issue_id,
            title=payload.title,
            category=payload.category.value,
            latitude=payload.latitude,
            longitude=payload.longitude
        )
        if cluster_id:
            issue["cluster_id"] = cluster_id
            issue["status"] = "clustered"

    # Step 3: Blockchain audit log
    log_event(
        issue_id=issue_id,
        event_type="created",
        actor_id=reporter_id,
        new_value={
            "title": payload.title,
            "category": payload.category.value,
            "urgency": payload.urgency,
            "priority_score": priority_score
        },
        title=payload.title,
        description=payload.description
    )

    return _serialize_issue(issue)


# ── LIST ──────────────────────────────────────────────────────
@router.get("", response_model=list)
def list_issues(
    category: Optional[str]  = Query(None),
    status:   Optional[str]  = Query(None),
    sort_by:  str            = Query("priority_score", regex="^(priority_score|created_at|impact_scale|urgency)$"),
    order:    str            = Query("desc", regex="^(asc|desc)$"),
    limit:    int            = Query(50, ge=1, le=200),
    offset:   int            = Query(0, ge=0)
):
    """Paginated, filterable issue list."""
    conditions = []
    params = []

    if category:
        conditions.append("i.category = %s")
        params.append(category)
    if status:
        conditions.append("i.status = %s")
        params.append(status)

    where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    order_clause = f"{sort_by} {order.upper()}"

    query = f"""
        SELECT i.*,
               u.username   AS reporter_name,
               a.username   AS authority_name,
               a.full_name  AS authority_full_name
        FROM issues i
        LEFT JOIN users u ON i.reporter_id = u.id
        LEFT JOIN users a ON i.assigned_authority_id = a.id
        {where_clause}
        ORDER BY i.{order_clause}
        LIMIT %s OFFSET %s
    """
    params.extend([limit, offset])

    with get_db() as cursor:
        cursor.execute(query, params)
        rows = cursor.fetchall()

    return [_serialize_issue(dict(r)) for r in rows]


# ── GET ONE ───────────────────────────────────────────────────
@router.get("/{issue_id}", response_model=IssueResponse)
def get_issue(issue_id: str):
    """Get full details of a single issue."""
    with get_db() as cursor:
        cursor.execute(
            """
            SELECT i.*,
                   u.username   AS reporter_name,
                   a.username   AS authority_name
            FROM issues i
            LEFT JOIN users u ON i.reporter_id = u.id
            LEFT JOIN users a ON i.assigned_authority_id = a.id
            WHERE i.id = %s
            """,
            (issue_id,)
        )
        row = cursor.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Issue not found.")
    return _serialize_issue(dict(row))


# ── UPDATE ────────────────────────────────────────────────────
@router.patch("/{issue_id}", response_model=IssueResponse)
def update_issue(
    issue_id: str,
    payload: IssueUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Update issue fields. Citizens can update their own; authorities and admins have broader access."""
    with get_db() as cursor:
        cursor.execute("SELECT * FROM issues WHERE id = %s", (issue_id,))
        existing = cursor.fetchone()

    if not existing:
        raise HTTPException(status_code=404, detail="Issue not found.")

    # Authorization check
    role = current_user.get("role")
    if role == "citizen" and str(existing["reporter_id"]) != current_user["sub"]:
        raise HTTPException(status_code=403, detail="You can only modify your own issues.")

    # Build dynamic update
    fields = {}
    if payload.title is not None:             fields["title"] = payload.title
    if payload.description is not None:       fields["description"] = payload.description
    if payload.status is not None:            fields["status"] = payload.status.value
    if payload.urgency is not None:           fields["urgency"] = payload.urgency
    if payload.impact_scale is not None:      fields["impact_scale"] = payload.impact_scale
    if payload.resolution_note is not None:   fields["resolution_note"] = payload.resolution_note
    if payload.resolution_proof_url is not None: fields["resolution_proof_url"] = payload.resolution_proof_url
    if payload.safety_risk_probability is not None: fields["safety_risk_probability"] = payload.safety_risk_probability
    if payload.assigned_authority_id is not None and role in ("authority", "admin"):
        fields["assigned_authority_id"] = payload.assigned_authority_id

    # Handle resolution
    if payload.status and payload.status.value == "resolved":
        fields["resolved_at"] = datetime.now(timezone.utc)

    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update.")

    # Recalculate priority if relevant fields changed
    set_clauses = ", ".join(f"{k} = %s" for k in fields)
    values = list(fields.values()) + [issue_id]

    with get_db() as cursor:
        cursor.execute(
            f"UPDATE issues SET {set_clauses}, updated_at = NOW() WHERE id = %s RETURNING *",
            values
        )
        updated = dict(cursor.fetchone())

    # Recalculate priority after update
    from services.priority import recalculate_issue_priority
    recalculate_issue_priority(issue_id)

    # Audit log
    log_event(
        issue_id=issue_id,
        event_type="updated",
        actor_id=current_user["sub"],
        old_value={k: str(existing[k]) for k in fields if k in existing},
        new_value=fields
    )

    return _serialize_issue(updated)


# ── DELETE ────────────────────────────────────────────────────
@router.delete("/{issue_id}", response_model=MessageResponse)
def delete_issue(
    issue_id: str,
    current_user: dict = Depends(require_roles("admin"))
):
    """Delete an issue. Admin only."""
    with get_db() as cursor:
        cursor.execute("DELETE FROM issues WHERE id = %s RETURNING id", (issue_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Issue not found.")

    return {"message": f"Issue {issue_id} deleted successfully."}
