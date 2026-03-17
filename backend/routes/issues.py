"""
RESOLVIT - Issues Routes (CRUD + Full Pipeline) v2

POST   /api/issues           - Create (triggers clustering + SLA + scoring + credits + audit)
GET    /api/issues           - List all issues (filterable, sortable, paginated)
GET    /api/issues/{id}      - Get single issue detail
PATCH  /api/issues/{id}      - Update issue (auth/admin only); awards credits on resolve
DELETE /api/issues/{id}      - Delete issue (admin only)
"""
import uuid
from fastapi import APIRouter, HTTPException, Depends, Query, Request, UploadFile, File
import os
import uuid
import shutil
from typing import Optional
from models import IssueCreate, IssueUpdate, IssueResponse, MessageResponse
from database import get_db
from auth import get_current_user, require_roles
from services.priority import calculate_priority, get_sla_hours, get_sla_expiry, predict_sla_breach_risk
from services.clustering import attempt_clustering
from services.blockchain import log_event
from services.escalation import award_credits
from datetime import datetime, timezone

router = APIRouter()


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
    created = r.get("created_at")
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
        r["days_unresolved"] = round(float(delta / 86400), 1)

    # SLA countdown in seconds (None if no sla_expires_at)
    sla_expires = r.get("sla_expires_at")
    if sla_expires:
        if sla_expires.tzinfo is None:
            sla_expires = sla_expires.replace(tzinfo=timezone.utc)
        r["sla_expires_at"] = sla_expires.isoformat()
        sla_seconds_remaining = (sla_expires - datetime.now(timezone.utc)).total_seconds()
        r["sla_seconds_remaining"] = max(sla_seconds_remaining, 0)
        r["sla_breached"] = sla_seconds_remaining <= 0
    else:
        r["sla_seconds_remaining"] = None
        r["sla_breached"] = False

    # Datetime serializtion
    for field in ("created_at", "updated_at", "resolved_at"):
        if r.get(field) and hasattr(r[field], "isoformat"):
            r[field] = r[field].isoformat()

    # Predictive breach risk (0.0–1.0)
    try:
        sla_exp = None
        if r.get("sla_expires_at") and isinstance(r["sla_expires_at"], str):
            sla_exp = datetime.fromisoformat(r["sla_expires_at"])
        r["breach_risk"] = predict_sla_breach_risk(
            category=r.get("category", "Other"),
            urgency=r.get("urgency", 3),
            created_at=created or datetime.now(timezone.utc),
            sla_expires_at=sla_exp,
            escalation_level=r.get("escalation_level") or 0,
        )
    except Exception:
        r["breach_risk"] = 0.0

    return r


# ── UPLOAD ────────────────────────────────────────────────────
@router.post("/upload", response_model=dict)
def upload_image(request: Request, file: UploadFile = File(...)):
    """Upload image to local server and return URL."""
    try:
        os.makedirs("uploads", exist_ok=True)
        ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
        filename = f"{uuid.uuid4()}.{ext}"
        path = os.path.join("uploads", filename)
        with open(path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        base_url = str(request.base_url).rstrip("/")
        # fallback for render or prod if request.base_url is wrong
        return {"url": f"{base_url}/uploads/{filename}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── CREATE ────────────────────────────────────────────────────
@router.post("", status_code=201, response_model=IssueResponse)
def create_issue(
    payload: IssueCreate,
    current_user: dict = Depends(get_current_user)
):
    """
    Create a new civic issue. Triggers:
    1. SLA calculation (per category)
    2. Priority score calculation
    3. AI clustering check
    4. Civic credits (+10 to reporter)
    5. Blockchain audit log
    """
    issue_id = str(uuid.uuid4())
    reporter_id = current_user["sub"]
    category = payload.category.value
    now = datetime.now(timezone.utc)

    # Step 1: SLA calculation
    sla_hours = get_sla_hours(category)
    sla_expires_at = get_sla_expiry(category, now)

    # Step 2: Priority score
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

        # Step 4: Award +10 civic credits to reporter
        award_credits(
            user_id=reporter_id,
            issue_id=issue_id,
            action_type="report_issue",
            points=10,
            description=f"Reported civic issue: {payload.title[:60]}",
            cursor=cursor
        )

    # Step 3: AI Clustering
    if payload.latitude and payload.longitude:
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

    # Step 5: Blockchain audit log
    log_event(
        issue_id=issue_id,
        event_type="created",
        actor_id=reporter_id,
        new_value={
            "title": payload.title,
            "category": category,
            "urgency": payload.urgency,
            "priority_score": priority_score,
            "sla_hours": sla_hours,
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
    sort_by:  str            = Query("priority_score", regex="^(priority_score|created_at|impact_scale|urgency|sla_expires_at)$"),
    order:    str            = Query("desc", regex="^(asc|desc)$"),
    limit:    int            = Query(50, ge=1, le=10000),
    offset:   int            = Query(0, ge=0),
    current_user: dict       = Depends(get_current_user)
):
    """Paginated, filterable issue list with SLA and credit fields."""
    conditions = []
    params = []

    role = current_user.get("role")
    user_dept = current_user.get("department")

    # Strict Role-Based Filtering
    if role == "authority":
        if not user_dept:
            # If an authority has no department assigned, safely show nothing
            return []
        
        # Override client-requested category with authority's fixed department
        # Authorities cannot look outside their scope even if they try via URL params
        conditions.append("i.category = %s")
        params.append(user_dept)
    else:
        # Citizens and Admins can filter by category if they want
        if category:
            conditions.append("i.category = %s")
            params.append(category)

    if status:
        conditions.append("i.status = %s")
        params.append(status)

    where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    order_clause = f"i.{sort_by} {order.upper()}"

    query = f"""
        SELECT i.*,
               u.username   AS reporter_name,
               a.username   AS authority_name,
               a.full_name  AS authority_full_name,
               a.department AS authority_department
        FROM issues i
        LEFT JOIN users u ON i.reporter_id = u.id
        LEFT JOIN users a ON i.assigned_authority_id = a.id
        {where_clause}
        ORDER BY {order_clause}
        LIMIT %s OFFSET %s
    """
    params.extend([int(limit), int(offset)])

    with get_db() as cursor:
        cursor.execute(query, params)
        rows = cursor.fetchall()

    return [_serialize_issue(dict(r)) for r in rows]


# ── GET ONE ───────────────────────────────────────────────────
@router.get("/{issue_id}", response_model=IssueResponse)
def get_issue(
    issue_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get full details of a single issue with SLA and breach risk."""
    with get_db() as cursor:
        cursor.execute(
            """
            SELECT i.*,
                   u.username   AS reporter_name,
                   u.full_name  AS reporter_full_name,
                   a.username   AS authority_name,
                   a.full_name  AS authority_full_name,
                   a.department AS authority_department
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
    
    issue_data = dict(row)
    role = current_user.get("role")
    user_dept = current_user.get("department")

    # Access Control: Authorities only see their department's issues
    if role == "authority":
        if issue_data.get("category") != user_dept:
            raise HTTPException(
                status_code=403, 
                detail=f"Access denied. This issue belongs to the {issue_data.get('category')} department."
            )

    return _serialize_issue(issue_data)


# ── UPDATE ────────────────────────────────────────────────────
@router.patch("/{issue_id}", response_model=IssueResponse)
def update_issue(
    issue_id: str,
    payload: IssueUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Update issue fields. Awards +50 credits to reporter on resolution."""
    with get_db() as cursor:
        cursor.execute("SELECT * FROM issues WHERE id = %s", (issue_id,))
        existing = cursor.fetchone()

    if not existing:
        raise HTTPException(status_code=404, detail="Issue not found.")

    role = current_user.get("role")
    user_dept = current_user.get("department")

    if role == "citizen":
        if str(existing["reporter_id"]) != current_user["sub"]:
            raise HTTPException(status_code=403, detail="You can only modify your own issues.")
        # Citizen can only edit before the issue is verified, assigned, or resolved
        if existing["status"] not in ("reported", "clustered"):
            raise HTTPException(
                status_code=403, 
                detail=f"Cannot edit issue once it has been {existing['status']}. Please contact support."
            )

    fields = {}
    if payload.title is not None:             fields["title"] = payload.title
    if payload.description is not None:       fields["description"] = payload.description
    
    # Status updates restricted to authorities/admin
    if payload.status is not None:
        if role == "admin":
            fields["status"] = payload.status.value
        elif role == "authority":
            # Strict department check
            if existing["category"] != user_dept:
                raise HTTPException(
                    status_code=403, 
                    detail=f"Access denied. Your department ({user_dept}) cannot update {existing['category']} issues."
                )
            fields["status"] = payload.status.value
        else:
            raise HTTPException(status_code=403, detail="Only authorities or admins can update issue status.")

    if payload.urgency is not None:           fields["urgency"] = payload.urgency
    if payload.impact_scale is not None:      fields["impact_scale"] = payload.impact_scale
    
    if payload.resolution_note is not None and role in ("authority", "admin"):
        fields["resolution_note"] = payload.resolution_note
    if payload.resolution_proof_url is not None and role in ("authority", "admin"):
        fields["resolution_proof_url"] = payload.resolution_proof_url
        
    if payload.safety_risk_probability is not None: fields["safety_risk_probability"] = payload.safety_risk_probability
    
    if payload.assigned_authority_id is not None:
        if role == "admin":
            fields["assigned_authority_id"] = payload.assigned_authority_id
        elif role == "authority":
            # Authorities can only assign to themselves or stay within their department
            if existing["category"] != user_dept:
                raise HTTPException(status_code=403, detail="Cannot assign issues outside your department.")
            fields["assigned_authority_id"] = payload.assigned_authority_id
        else:
            raise HTTPException(status_code=403, detail="Only authorities/admins can assign issues.")

    is_resolving = payload.status and payload.status.value == "resolved"
    if is_resolving:
        fields["resolved_at"] = datetime.now(timezone.utc)

    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update.")

    set_clauses = ", ".join(f"{k} = %s" for k in fields)
    values = list(fields.values()) + [issue_id]

    with get_db() as cursor:
        cursor.execute(
            f"UPDATE issues SET {set_clauses}, updated_at = NOW() WHERE id = %s RETURNING *",
            values
        )
        updated = dict(cursor.fetchone())

        # Award +50 civic credits to reporter upon resolution
        if is_resolving:
            reporter_id = str(existing["reporter_id"])
            award_credits(
                user_id=reporter_id,
                issue_id=issue_id,
                action_type="issue_resolved",
                points=50,
                description=f"Issue resolved: {existing['title'][:60]}",
                cursor=cursor
            )

    # Recalculate priority after update
    from services.priority import recalculate_issue_priority
    recalculate_issue_priority(issue_id)

    # Audit log
    log_event(
        issue_id=issue_id,
        event_type="updated",
        actor_id=current_user["sub"],
        old_value={k: str(existing.get(k, "")) for k in fields if k in existing},
        new_value={k: str(v) for k, v in fields.items()}
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
