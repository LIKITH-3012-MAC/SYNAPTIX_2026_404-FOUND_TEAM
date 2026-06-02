from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional
from uuid import UUID
from datetime import datetime, timezone
import re

from database import get_db
from auth import require_roles, get_current_user
from models import NGOAssignmentCreate, NGOUpdateStatus, MessageResponse
from services.email_service import send_ngo_assignment_email

router = APIRouter()

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_-]+', '-', text)
    return text

# ─────────────────────────────────────────────────────────────
# ADMIN ENDPOINTS
# ─────────────────────────────────────────────────────────────

@router.post("/admin/issues/{issue_id}/assign-ngo", response_model=MessageResponse)
def assign_issue_to_ngo(
    issue_id: str,
    payload: NGOAssignmentCreate,
    current_user: dict = Depends(require_roles("admin"))
):
    """
    POST /api/admin/issues/{issue_id}/assign-ngo
    Assigns a public issue to an NGO, inserts NGO records, updates issue status/location,
    registers the assignment, and triggers notification email via Resend.
    """
    try:
        # Validate issue_id format (must be UUID for DB)
        try:
            issue_uuid = UUID(issue_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid issue_id format. Must be UUID.")

        with get_db() as cursor:
            # 1. Verify issue exists
            cursor.execute("SELECT id, title, description, address, location_text FROM issues WHERE id = %s", (issue_uuid,))
            issue = cursor.fetchone()
            if not issue:
                raise HTTPException(status_code=404, detail="Issue not found.")

            ngo_email = payload.email.strip().lower()
            ngo_name = payload.ngo_name.strip()
            contact_person = payload.contact_person_name.strip()
            phone = payload.phone.strip() if payload.phone else None
            admin_msg = payload.admin_message.strip() if payload.admin_message else None
            confirmed_location = payload.location.strip() if payload.location else (issue["address"] or issue["location_text"])

            # 2. Add or fetch NGO organization details
            cursor.execute("SELECT id FROM ngos WHERE email = %s", (ngo_email,))
            ngo_row = cursor.fetchone()
            if ngo_row:
                ngo_id = ngo_row["id"]
            else:
                ngo_slug = slugify(ngo_name)
                # Handle possible duplicate slugs by appending unique tag
                cursor.execute("SELECT id FROM ngos WHERE slug = %s", (ngo_slug,))
                if cursor.fetchone():
                    ngo_slug = f"{ngo_slug}-{int(datetime.now().timestamp()) % 1000}"
                
                cursor.execute(
                    """
                    INSERT INTO ngos (name, slug, contact_name, contact_email, contact_phone, is_active, created_by_admin_id)
                    VALUES (%s, %s, %s, %s, %s, TRUE, %s) RETURNING id
                    """,
                    (ngo_name, ngo_slug, contact_person, ngo_email, phone, current_user["sub"])
                )
                ngo_id = cursor.fetchone()["id"]

            # 3. If there is a registered user with this email, upgrade their role to 'ngo'
            cursor.execute("UPDATE users SET role = 'ngo' WHERE email = %s", (ngo_email,))

            # 4. Insert assignment record
            cursor.execute(
                """
                INSERT INTO issue_assignments (issue_id, ngo_id, ngo_email, assigned_by_admin_id, admin_message, status)
                VALUES (%s, %s, %s, %s, %s, 'Assigned') RETURNING id
                """,
                (issue_uuid, ngo_id, ngo_email, current_user["sub"], admin_msg)
            )
            assignment_id = cursor.fetchone()["id"]

            # 5. Mark issue status as 'Assigned' and update confirmed location
            cursor.execute(
                "UPDATE issues SET status = 'Assigned', location = %s, updated_at = NOW() WHERE id = %s",
                (confirmed_location, issue_uuid)
            )

            # 6. Log audit trail to issue_history
            cursor.execute(
                """
                INSERT INTO issue_history (issue_id, action_type, note, actor_id, actor_role)
                VALUES (%s, 'assigned', %s, %s, 'admin')
                """,
                (issue_uuid, f"Assigned to NGO {ngo_name} ({ngo_email})", current_user["sub"])
            )

        # 7. Send notification email (Done outside the DB block to prevent transaction holding)
        issue_desc = issue["description"]
        send_ngo_assignment_email(
            ngo_email=ngo_email,
            ngo_person_name=contact_person,
            issue_title=issue["title"],
            issue_location=confirmed_location or "N/A",
            issue_description=issue_desc
        )

        return MessageResponse(
            success=True,
            message=f"Issue successfully assigned to NGO: {ngo_name}. Verification email dispatched."
        )

    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database or system error: {e}")


@router.get("/admin/assignments")
def get_all_assignments(current_user: dict = Depends(require_roles("admin"))):
    """
    GET /api/admin/assignments
    Returns a complete log of issue assignments for administrator audit tracking.
    """
    try:
        with get_db() as cursor:
            query = """
                SELECT 
                    ia.id, ia.ngo_email, ia.admin_message, ia.status, ia.seen_by_ngo, ia.is_new,
                    ia.assigned_at, ia.updated_at,
                    i.id AS issue_id, i.title AS issue_title, i.location AS issue_location, i.description AS issue_description,
                    n.name AS ngo_name, n.contact_name AS ngo_contact_name,
                    u.username AS admin_username
                FROM issue_assignments ia
                JOIN issues i ON ia.issue_id = i.id
                LEFT JOIN ngos n ON ia.ngo_id = n.id
                LEFT JOIN users u ON ia.assigned_by_admin_id = u.id
                ORDER BY ia.assigned_at DESC
            """
            cursor.execute(query)
            rows = cursor.fetchall()
            
            # Serialize for output
            results = []
            for r in rows:
                item = dict(r)
                item["id"] = str(item["id"])
                item["issue_id"] = str(item["issue_id"])
                if item["assigned_at"]:
                    item["assigned_at"] = item["assigned_at"].isoformat()
                if item["updated_at"]:
                    item["updated_at"] = item["updated_at"].isoformat()
                results.append(item)
            return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/admin/issues/{issue_id}/updates")
def get_issue_updates(
    issue_id: str,
    current_user: dict = Depends(require_roles("admin", "ngo"))
):
    """
    GET /api/admin/issues/{issue_id}/updates
    Fetches the audit updates history logged by NGOs for a specific issue.
    """
    try:
        try:
            issue_uuid = UUID(issue_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid issue_id format. Must be UUID.")

        with get_db() as cursor:
            query = """
                SELECT iu.id, iu.ngo_email, iu.status, iu.update_message, iu.proof_image_url, iu.created_at,
                       n.name AS ngo_name
                FROM issue_updates iu
                JOIN issue_assignments ia ON iu.assignment_id = ia.id
                LEFT JOIN ngos n ON ia.ngo_id = n.id
                WHERE iu.issue_id = %s
                ORDER BY iu.created_at DESC
            """
            cursor.execute(query, (issue_uuid,))
            rows = cursor.fetchall()
            
            results = []
            for r in rows:
                item = dict(r)
                item["id"] = str(item["id"])
                if item["created_at"]:
                    item["created_at"] = item["created_at"].isoformat()
                results.append(item)
            return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─────────────────────────────────────────────────────────────
# NGO ENDPOINTS
# ─────────────────────────────────────────────────────────────

@router.get("/ngo/my-assignments")
def get_my_assignments(current_user: dict = Depends(require_roles("ngo"))):
    """
    GET /api/ngo/my-assignments
    Fetches all assignments associated with the logged-in NGO email.
    """
    email = current_user.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="No email associated with authenticated session.")
        
    try:
        with get_db() as cursor:
            query = """
                SELECT 
                    ia.id, ia.admin_message, ia.status, ia.seen_by_ngo, ia.is_new, ia.assigned_at, ia.updated_at,
                    i.id AS issue_id, i.title AS issue_title, i.description AS issue_description,
                    i.location AS issue_location, i.latitude, i.longitude,
                    n.name AS ngo_name, n.contact_name AS ngo_contact_name
                FROM issue_assignments ia
                JOIN issues i ON ia.issue_id = i.id
                LEFT JOIN ngos n ON ia.ngo_id = n.id
                WHERE ia.ngo_email = %s
                ORDER BY ia.assigned_at DESC
            """
            cursor.execute(query, (email.lower(),))
            rows = cursor.fetchall()
            
            results = []
            for r in rows:
                item = dict(r)
                item["id"] = str(item["id"])
                item["issue_id"] = str(item["issue_id"])
                if item["assigned_at"]:
                    item["assigned_at"] = item["assigned_at"].isoformat()
                if item["updated_at"]:
                    item["updated_at"] = item["updated_at"].isoformat()
                results.append(item)
            return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ngo/assignments/{assignment_id}/mark-seen", response_model=MessageResponse)
def mark_assignment_seen(
    assignment_id: str,
    current_user: dict = Depends(require_roles("ngo"))
):
    """
    POST /api/ngo/assignments/{assignment_id}/mark-seen
    Triggers seen status update for an assignment once blinking animations complete.
    """
    try:
        try:
            assign_uuid = UUID(assignment_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid assignment_id format.")

        email = current_user.get("email")
        if not email:
            raise HTTPException(status_code=400, detail="No email in authenticated session.")

        with get_db() as cursor:
            # Verify assignment belongs to logged-in NGO email
            cursor.execute("SELECT ngo_email FROM issue_assignments WHERE id = %s", (assign_uuid,))
            assignment = cursor.fetchone()
            if not assignment:
                raise HTTPException(status_code=404, detail="Assignment not found.")
                
            if assignment["ngo_email"].lower() != email.lower():
                raise HTTPException(status_code=403, detail="Forbidden. Assignment email mismatch.")

            cursor.execute(
                "UPDATE issue_assignments SET seen_by_ngo = TRUE, is_new = FALSE, updated_at = NOW() WHERE id = %s",
                (assign_uuid,)
            )

        return MessageResponse(success=True, message="Assignment successfully marked as seen.")
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/ngo/assignments/{assignment_id}/status", response_model=MessageResponse)
def update_assignment_status(
    assignment_id: str,
    payload: NGOUpdateStatus,
    current_user: dict = Depends(require_roles("ngo"))
):
    """
    PUT /api/ngo/assignments/{assignment_id}/status
    Updates the status and updates history for an assigned issue, inserting proofs if solved.
    """
    try:
        try:
            assign_uuid = UUID(assignment_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid assignment_id format.")

        email = current_user.get("email")
        if not email:
            raise HTTPException(status_code=400, detail="No email in authenticated session.")

        with get_db() as cursor:
            # 1. Fetch assignment and check owner
            cursor.execute("SELECT ngo_email, issue_id, ngo_id FROM issue_assignments WHERE id = %s", (assign_uuid,))
            assignment = cursor.fetchone()
            if not assignment:
                raise HTTPException(status_code=404, detail="Assignment not found.")

            if assignment["ngo_email"].lower() != email.lower():
                raise HTTPException(status_code=403, detail="Forbidden. Assignment email mismatch.")

            issue_uuid = assignment["issue_id"]
            new_status = payload.status.strip()
            msg = payload.update_message.strip() if payload.update_message else None
            proof_img = payload.proof_image_url.strip() if payload.proof_image_url else None

            # 2. Insert into issue_updates table
            cursor.execute(
                """
                INSERT INTO issue_updates (assignment_id, issue_id, ngo_email, status, update_message, proof_image_url)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (assign_uuid, issue_uuid, email.lower(), new_status, msg, proof_img)
            )

            # 3. Update issue_assignments status
            cursor.execute(
                "UPDATE issue_assignments SET status = %s, updated_at = NOW() WHERE id = %s",
                (new_status, assign_uuid)
            )

            # 4. Update the original issue status and resolution details if Solved
            if new_status.lower() == "solved":
                cursor.execute(
                    """
                    UPDATE issues 
                    SET status = %s, resolution_note = %s, resolution_proof_url = %s, resolved_at = NOW(), updated_at = NOW() 
                    WHERE id = %s
                    """,
                    ("resolved", msg or "Solved by NGO", proof_img, issue_uuid)
                )
            else:
                cursor.execute(
                    "UPDATE issues SET status = %s, updated_at = NOW() WHERE id = %s",
                    (new_status, issue_uuid)
                )

            # 5. Log audit trail in issue_history
            cursor.execute(
                """
                INSERT INTO issue_history (issue_id, action_type, note, actor_id, actor_role)
                VALUES (%s, %s, %s, %s, 'ngo')
                """,
                (issue_uuid, new_status.lower(), f"Status updated by NGO to {new_status}. Message: {msg or 'N/A'}", current_user["sub"])
            )

        return MessageResponse(success=True, message=f"Status successfully updated to: {new_status}")

    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
