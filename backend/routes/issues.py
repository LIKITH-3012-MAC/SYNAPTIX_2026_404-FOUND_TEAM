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
import json
import os
import shutil
from pydantic import BaseModel
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
        r["days_unresolved"] = round(delta / 86400, 1)

    # SLA countdown in seconds
    for f in ["sla_expires_at", "sla_due_at"]:
        val = r.get(f)
        if val:
            if val.tzinfo is None:
                val = val.replace(tzinfo=timezone.utc)
            r[f] = val.isoformat()
            if f == "sla_due_at":
                sla_rem = (val - datetime.now(timezone.utc)).total_seconds()
                r["sla_seconds_remaining"] = max(sla_rem, 0)
                r["sla_breached"] = sla_rem <= 0

    # Datetime serialization for other fields
    for field in ("created_at", "updated_at", "resolved_at"):
        if r.get(field) and hasattr(r[field], "isoformat"):
            r[field] = r[field].isoformat()

    # Predictive breach risk (0.0–1.0)
    try:
        sla_exp_str = r.get("sla_expires_at") or r.get("sla_due_at")
        sla_exp = None
        if sla_exp_str:
            sla_exp = datetime.fromisoformat(sla_exp_str)
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
        if "render.com" in base_url or "vercel.app" in base_url:
            base_url = base_url.replace("http://", "https://")
            
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

        # Step 3: Register primary evidence in attachments table
        if payload.image_url:
            cursor.execute(
                """
                INSERT INTO issue_attachments (issue_id, file_url, file_name, file_type, uploaded_by)
                VALUES (%s, %s, %s, 'photo', %s)
                """,
                (issue_id, payload.image_url, "primary_evidence.jpg", reporter_id)
            )

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

    # Strict Role-Based Visibility
    if role == "admin" or role == "authority":
        # Full visibility for officials
        pass
    else:
        # Citizens (default) see only their own issues
        conditions.append("i.reporter_id = %s")
        params.append(current_user["sub"])

    # Additional filters (Category/Status)
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
               u.full_name  AS reporter_full_name,
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
    params.extend([limit, offset])

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

    # Access Control: Citizens only see their own issues
    if role not in ("admin", "authority") and str(issue_data.get("reporter_id")) != current_user["sub"]:
        raise HTTPException(
            status_code=403, 
            detail="Access denied. You can only view details of issues you reported."
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

    role = str(current_user.get("role", "citizen"))
    if role not in ["admin", "authority"]:
        raise HTTPException(status_code=403, detail="Forbidden: Only Admin and Authority can update issues.")
    
    fields = {}
    if payload.title is not None:             fields["title"] = payload.title
    if payload.description is not None:       fields["description"] = payload.description
    if payload.category is not None:          fields["category"] = payload.category.value
    if payload.subcategory is not None:       fields["subcategory"] = payload.subcategory
    if payload.status is not None:            fields["status"] = payload.status.value
    if payload.urgency is not None:           fields["urgency"] = payload.urgency
    if payload.severity is not None:          fields["severity"] = payload.severity
    if payload.impact_scale is not None:      fields["impact_scale"] = payload.impact_scale
    if payload.safety_risk_probability is not None: fields["safety_risk_probability"] = payload.safety_risk_probability
    if payload.assigned_authority_id is not None: fields["assigned_authority_id"] = payload.assigned_authority_id
    if payload.resolution_note is not None:   fields["resolution_note"] = payload.resolution_note
    if payload.resolution_proof_url is not None: fields["resolution_proof_url"] = payload.resolution_proof_url
    if payload.latitude is not None:          fields["latitude"] = payload.latitude
    if payload.longitude is not None:         fields["longitude"] = payload.longitude
    if payload.escalation_level is not None:  fields["escalation_level"] = payload.escalation_level
    if payload.is_fake is not None:           fields["is_fake"] = payload.is_fake
    if payload.is_archived is not None:       fields["is_archived"] = payload.is_archived
    if payload.sla_due_at is not None:        fields["sla_due_at"] = payload.sla_due_at
    if payload.is_fake is not None:           fields["is_fake"] = payload.is_fake
    if payload.is_archived is not None:       fields["is_archived"] = payload.is_archived
    if payload.escalation_level is not None:  fields["escalation_level"] = payload.escalation_level
    if payload.status is not None:            fields["status"] = payload.status.value
    if payload.priority_score is not None:
        fields["priority_score"] = payload.priority_score
        fields["priority_manual_override"] = True

    # ⚠️ CRITICAL: Resolution Status Shift Verification
    is_resolving = payload.status is not None and payload.status.value == "resolved" and existing["status"] != "resolved"

    if payload.status is not None and payload.status.value == "resolved":
        if not existing.get("resolved_at"):
            fields["resolved_at"] = datetime.now(timezone.utc)
            # AUTO-REWARD: 50 points to the reporter for successful civic resolution
            try:
                award_credits(
                    user_id=str(existing["reporter_id"]),
                    issue_id=issue_id,
                    action_type="issue_resolved",
                    points=50,
                    description=f"Issue Resolved: {existing['title']}",
                    cursor=cursor
                )
            except Exception as e:
                print(f"[REWARD ERR] {e}")

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

        # Record History for each changed field
        for field, new_val in fields.items():
            old_val = existing.get(field)
            if str(old_val) != str(new_val):
                _add_issue_history(
                    cursor, issue_id, 
                    action_type="status_change" if field == "status" else "field_update", 
                    actor_id=current_user["sub"],
                    actor_role=role,
                    note=f"Update {field.replace('_', ' ')}",
                    old_val={field: old_val},
                    new_val={field: new_val}
                )

        # Audit log for admins
        if role == "admin":
            cursor.execute(
                "INSERT INTO admin_audit_logs (admin_id, entity_type, entity_id, action, old_value, new_value) VALUES (%s, 'issue', %s, %s, %s, %s)",
                (current_user["sub"], issue_id, "issue_update", json.dumps({k:str(existing.get(k)) for k in fields}), json.dumps({k:str(v) for k,v in fields.items()}))
            )

        # Special action: Resolution credits
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
        
        # 🔗 SYNC: Push update to citizen activity ledger
        cursor.execute(
            """
            INSERT INTO citizen_activity (user_id, action, credits_delta, note, created_at)
            VALUES (%s, %s, %s, %s, NOW())
            """,
            (
                str(existing["reporter_id"]), 
                f"Issue {payload.status.value if payload.status else 'updated'}", 
                0, 
                f"Status: {payload.status.value if payload.status else 'Modified'} | Note: {payload.resolution_note or 'Admin update'}"
            )
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


# ── OPERATIONAL ACTIONS ───────────────────────────────────────

def _add_issue_history(cursor, issue_id: str, action_type: str, actor_id: str, actor_role: str, note: Optional[str] = None, old_val = None, new_val = None):
    """Internal helper to record issue transitions."""
    import json
    cursor.execute(
        """
        INSERT INTO issue_history (issue_id, action_type, actor_id, actor_role, note, old_value, new_value)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (
            issue_id, 
            action_type, 
            actor_id, 
            actor_role, 
            note, 
            json.dumps(old_val) if old_val else None, 
            json.dumps(new_val) if new_val else None
        )
    )

@router.get("/{issue_id}/history", response_model=list)
def get_issue_history(issue_id: str, current_user: dict = Depends(get_current_user)):
    """Retrieve full audit trail of an issue."""
    with get_db() as cursor:
        cursor.execute(
            """
            SELECT h.*, u.username as actor_name, u.role as actor_role
            FROM issue_history h
            LEFT JOIN users u ON h.actor_id = u.id
            WHERE h.issue_id = %s
            ORDER BY h.created_at DESC
            """,
            (issue_id,)
        )
        rows = cursor.fetchall()
    
    # Simple serialization
    results = []
    for r in rows:
        item = dict(r)
        item["id"] = str(item["id"])
        item["issue_id"] = str(item["issue_id"])
        if item.get("actor_id"): item["actor_id"] = str(item["actor_id"])
        if item.get("created_at") and hasattr(item["created_at"], "isoformat"):
            item["created_at"] = item["created_at"].isoformat()
        results.append(item)
    return results

@router.get("/{issue_id}/attachments", response_model=list)
def get_issue_attachments(issue_id: str, current_user: dict = Depends(get_current_user)):
    """Retrieve all evidence/attachments for an issue."""
    with get_db() as cursor:
        cursor.execute(
            "SELECT * FROM issue_attachments WHERE issue_id = %s ORDER BY created_at DESC",
            (issue_id,)
        )
        rows = cursor.fetchall()
    
    results = []
    for r in rows:
        item = dict(r)
        item["id"] = str(item["id"])
        item["issue_id"] = str(item["issue_id"])
        if item.get("uploaded_by"): item["uploaded_by"] = str(item["uploaded_by"])
        if item.get("created_at") and hasattr(item["created_at"], "isoformat"):
            item["created_at"] = item["created_at"].isoformat()
        results.append(item)
    return results

class AssignPayload(BaseModel):
    authority_id: str
    note: Optional[str] = None

@router.post("/{issue_id}/assign", response_model=MessageResponse)
def assign_issue(issue_id: str, payload: AssignPayload, current_user: dict = Depends(require_roles("admin", "authority"))):
    """Assign issue to a specific authority."""
    with get_db() as cursor:
        cursor.execute("SELECT status, assigned_authority_id, reporter_id FROM issues WHERE id = %s", (issue_id,))
        existing = cursor.fetchone()
        if not existing: raise HTTPException(status_code=404, detail="Issue not found")
        
        cursor.execute(
            "UPDATE issues SET assigned_authority_id = %s, status = 'assigned', updated_at = NOW() WHERE id = %s",
            (payload.authority_id, issue_id)
        )
        _add_issue_history(
            cursor, issue_id, "assigned", current_user["sub"], current_user["role"],
            note=payload.note,
            old_val={"authority_id": str(existing["assigned_authority_id"]) if existing["assigned_authority_id"] else None},
            new_val={"authority_id": payload.authority_id}
        )
        # 🔗 SYNC: Push update to citizen activity ledger
        cursor.execute(
            """
            INSERT INTO citizen_activity (user_id, action, credits_delta, note, created_at)
            VALUES (%s, %s, %s, %s, NOW())
            """,
            (
                str(existing["reporter_id"]), 
                "Issue assigned", 
                0, 
                f"Status: Assigned | Note: {payload.note or 'Assigned to an official'}"
            )
        )
    return {"message": "Issue assigned successfully"}

@router.post("/{issue_id}/escalate", response_model=MessageResponse)
def escalate_issue(issue_id: str, note: Optional[str] = Query(None), current_user: dict = Depends(require_roles("admin", "authority"))):
    """Escalate an issue."""
    with get_db() as cursor:
        cursor.execute("SELECT status, escalation_level, reporter_id FROM issues WHERE id = %s", (issue_id,))
        existing = cursor.fetchone()
        if not existing: raise HTTPException(status_code=404, detail="Issue not found")
        new_level = (existing["escalation_level"] or 0) + 1
        cursor.execute(
            "UPDATE issues SET status = 'escalated', escalation_level = %s, updated_at = NOW() WHERE id = %s",
            (new_level, issue_id)
        )
        _add_issue_history(
            cursor, issue_id, "escalated", current_user["sub"], current_user["role"],
            note=note,
            old_val={"status": existing["status"], "level": existing["escalation_level"]},
            new_val={"status": "escalated", "level": new_level}
        )
        # 🔗 SYNC: Push update to citizen activity ledger
        cursor.execute(
            """
            INSERT INTO citizen_activity (user_id, action, credits_delta, note, created_at)
            VALUES (%s, %s, %s, %s, NOW())
            """,
            (
                str(existing["reporter_id"]), 
                "Issue escalated", 
                0, 
                f"Status: Escalated to Level {new_level} | Note: {note or 'Escalated by Admin'}"
            )
        )
    return {"message": "Issue escalated successfully"}

@router.post("/{issue_id}/resolve", response_model=MessageResponse)
def resolve_issue(issue_id: str, note: Optional[str] = Query(None), current_user: dict = Depends(require_roles("admin", "authority"))):
    """Resolve an issue."""
    with get_db() as cursor:
        cursor.execute("SELECT status, reporter_id FROM issues WHERE id = %s", (issue_id,))
        existing = cursor.fetchone()
        cursor.execute(
            "UPDATE issues SET status = 'resolved', resolution_note = %s, resolved_at = NOW(), updated_at = NOW() WHERE id = %s",
            (note, issue_id)
        )
        _add_issue_history(
            cursor, issue_id, "resolved", current_user["sub"], current_user["role"],
            note=note
        )
        # Award credits
        award_credits(
            user_id=str(existing["reporter_id"]),
            issue_id=issue_id,
            action_type="issue_resolved",
            points=50,
            description=f"Issue resolved: {issue_id}",
            cursor=cursor
        )
    return {"message": "Issue resolved successfully"}

@router.post("/{issue_id}/archive", response_model=MessageResponse)
def archive_issue(issue_id: str, current_user: dict = Depends(require_roles("admin"))):
    """Archive an issue. Admin only."""
    with get_db() as cursor:
        cursor.execute("SELECT reporter_id FROM issues WHERE id = %s", (issue_id,))
        existing = cursor.fetchone()
        if not existing: raise HTTPException(status_code=404, detail="Issue not found")
        
        cursor.execute("UPDATE issues SET status = 'archived', is_archived = TRUE, updated_at = NOW() WHERE id = %s", (issue_id,))
        _add_issue_history(cursor, issue_id, "archived", current_user["sub"], current_user["role"])
        
        # 🔗 SYNC: Push update to citizen activity ledger
        cursor.execute(
            """
            INSERT INTO citizen_activity (user_id, action, credits_delta, note, created_at)
            VALUES (%s, %s, %s, %s, NOW())
            """,
            (
                str(existing["reporter_id"]), 
                "Issue archived", 
                0, 
                "Status: Archived | Note: Moved to archives"
            )
        )
    return {"message": "Issue archived successfully"}
