from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from typing import List
import re
from datetime import datetime
from uuid import UUID
from models import NGOCreate, NGOUpdate, NGOResponse, UserResponse, UserRole, NGOOperatorCreate, NGOOperatorResponse
from auth import require_roles, get_current_user
from database import get_db
from services.email_service import send_officer_appointment_email

router = APIRouter()

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_-]+', '-', text)
    return text

def _serialize_ngo(row: dict) -> dict:
    if not row:
        return row
    r = dict(row)
    r["id"] = str(r["id"])
    if r.get("created_by_admin_id"):
        r["created_by_admin_id"] = str(r["created_by_admin_id"])
    return r

def _serialize_operator(row: dict) -> dict:
    if not row:
        return row
    r = dict(row)
    r["id"] = str(r["id"])
    r["ngo_id"] = str(r["ngo_id"])
    r["user_id"] = str(r["user_id"])
    return r

@router.get("/admin/ngos", response_model=List[NGOResponse])
def admin_list_ngos(current_user: dict = Depends(require_roles("admin"))):
    try:
        with get_db() as cursor:
            cursor.execute("""
                SELECT n.*, (SELECT COUNT(*) FROM ngo_operators WHERE ngo_id = n.id) as officer_count 
                FROM ngos n 
                ORDER BY n.created_at DESC;
            """)
            return [_serialize_ngo(r) for r in cursor.fetchall()]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ngos", response_model=List[NGOResponse])
def public_list_ngos():
    """Publicly visible NGOs for citizens."""
    try:
        with get_db() as cursor:
            cursor.execute("""
                SELECT n.*, (SELECT COUNT(*) FROM ngo_operators WHERE ngo_id = n.id) as officer_count 
                FROM ngos n 
                WHERE n.is_active = TRUE 
                ORDER BY n.name ASC;
            """)
            return [_serialize_ngo(r) for r in cursor.fetchall()]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/admin/ngos", response_model=NGOResponse)
def create_ngo(payload: NGOCreate, current_user: dict = Depends(require_roles("admin"))):
    try:
        with get_db() as cursor:
            # Clean and unique slugify
            ngo_slug = slugify(payload.slug or payload.name)
            cursor.execute("SELECT id FROM ngos WHERE slug = %s", (ngo_slug,))
            if cursor.fetchone():
                ngo_slug = f"{ngo_slug}-{int(datetime.now().timestamp()) % 1000}"

            cursor.execute(
                """
                INSERT INTO ngos (name, slug, description, specialization, contact_name, contact_email, contact_phone, operating_region, district, address, is_active, created_by_admin_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *;
                """,
                (payload.name, ngo_slug, payload.description, payload.specialization, payload.contact_name, payload.contact_email, payload.contact_phone, payload.operating_region, payload.district, payload.address, payload.is_active, current_user["sub"])
            )
            return _serialize_ngo(cursor.fetchone())
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create NGO: {e}")

@router.patch("/admin/ngos/{ngo_id}", response_model=NGOResponse)
def update_ngo(ngo_id: str, payload: NGOUpdate, current_user: dict = Depends(require_roles("admin"))):
    try:
        with get_db() as cursor:
            fields = []
            values = []
            for k, v in payload.model_dump(exclude_unset=True).items():
                fields.append(f"{k} = %s")
                values.append(v)
            if not fields:
                cursor.execute("SELECT * FROM ngos WHERE id = %s", (ngo_id,))
                return cursor.fetchone()
            
            values.append(ngo_id)
            query = f"UPDATE ngos SET {', '.join(fields)}, updated_at = NOW() WHERE id = %s RETURNING *;"
            cursor.execute(query, tuple(values))
            updated = cursor.fetchone()
            if not updated:
                raise HTTPException(status_code=404, detail="NGO not found")
            return _serialize_ngo(updated)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/admin/ngo-officers", response_model=NGOOperatorResponse)
def create_ngo_officer(
    payload: NGOOperatorCreate,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_roles("admin"))
):
    """Admin creates an NGO officer by linking a user to an NGO and promoting their role."""
    try:
        with get_db() as cursor:
            user_id = payload.user_id
            
            # Resolve user_id if it's an email or username instead of a UUID
            if user_id:
                try:
                    UUID(user_id)
                except ValueError:
                    cursor.execute("SELECT id FROM users WHERE email = %s OR username = %s", (user_id.strip().lower(), user_id.strip()))
                    user_row = cursor.fetchone()
                    if not user_row:
                        raise HTTPException(status_code=404, detail=f"User with email/username '{user_id}' not found.")
                    user_id = str(user_row["id"])
                    
            elif payload.email:
                email = payload.email.strip().lower()
                cursor.execute("SELECT id FROM users WHERE email = %s", (email,))
                user_row = cursor.fetchone()
                if not user_row:
                    raise HTTPException(status_code=404, detail=f"User with email '{email}' not found.")
                user_id = str(user_row["id"])

            if not user_id:
                raise HTTPException(status_code=400, detail="Either user_id or email must be provided.")

            ngo_id = payload.ngo_id.strip()
            try:
                UUID(ngo_id)
            except ValueError:
                slugified = slugify(ngo_id)
                cursor.execute(
                    """
                    SELECT id FROM ngos 
                    WHERE LOWER(name) = %s 
                       OR slug = %s 
                       OR LOWER(contact_email) = %s
                       OR LOWER(name) LIKE %s
                    LIMIT 1
                    """,
                    (ngo_id.lower(), slugified, ngo_id.lower(), f"%{ngo_id.lower()}%")
                )
                ngo_row = cursor.fetchone()
                if not ngo_row:
                    raise HTTPException(status_code=404, detail=f"NGO with name/slug/email '{ngo_id}' not found.")
                ngo_id = str(ngo_row["id"])

            # 1. Update user role to ngo_operator automatically
            cursor.execute("UPDATE users SET role = %s WHERE id = %s", ('ngo_operator', user_id))
            
            # 2. Insert link
            cursor.execute(
                """
                INSERT INTO ngo_operators (ngo_id, user_id, role_within_ngo)
                VALUES (%s, %s, %s)
                ON CONFLICT (ngo_id, user_id) DO UPDATE SET role_within_ngo = EXCLUDED.role_within_ngo, is_active = TRUE
                RETURNING *;
                """,
                (ngo_id, user_id, payload.role_within_ngo)
            )
            op = cursor.fetchone()
            
            # 3. Audit
            cursor.execute(
                "INSERT INTO care_audit_log (actor_user_id, actor_role, action_type, entity_type, entity_id) VALUES (%s, %s, %s, %s, %s)",
                (current_user["sub"], current_user["role"], "officer_created", "ngo_operator", op["id"])
            )
            
            # 4. Fetch enriched details for response
            cursor.execute("SELECT u.username, u.email, u.full_name FROM users u WHERE u.id = %s", (user_id,))
            u = cursor.fetchone()

            # 5. Fetch NGO name for the email
            cursor.execute("SELECT name FROM ngos WHERE id = %s", (ngo_id,))
            ngo_row = cursor.fetchone()
            ngo_name = ngo_row["name"] if ngo_row else "Partner NGO"

            # 6. Send email notification via Resend in background
            if u and u.get("email"):
                try:
                    send_officer_appointment_email(
                        background_tasks=background_tasks,
                        to_email=u["email"],
                        user_name=u["full_name"] or u["username"],
                        ngo_name=ngo_name,
                        role_within_ngo=payload.role_within_ngo or "Lead Officer"
                    )
                except Exception as email_err:
                    print(f"[EMAIL-ERROR] Failed to send officer appointment email: {email_err}")

            res = {**op, **u} if u else op
            return _serialize_operator(res)
            
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create officer: {e}")


@router.get("/admin/ngo-officers", response_model=List[NGOOperatorResponse])
def admin_list_officers(current_user: dict = Depends(require_roles("admin"))):
    try:
        with get_db() as cursor:
            query = """
                SELECT op.*, u.username, u.email, u.full_name 
                FROM ngo_operators op
                JOIN users u ON op.user_id = u.id
                ORDER BY op.created_at DESC;
            """
            cursor.execute(query)
            return [_serialize_operator(r) for r in cursor.fetchall()]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
