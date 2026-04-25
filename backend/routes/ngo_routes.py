from fastapi import APIRouter, Depends, HTTPException, status
from typing import List
from models import NGOCreate, NGOUpdate, NGOResponse, UserResponse, UserRole, NGOOperatorCreate, NGOOperatorResponse
from auth import require_roles, get_current_user
from database import get_db

router = APIRouter()

@router.get("/admin/ngos", response_model=List[NGOResponse])
def admin_list_ngos(current_user: dict = Depends(require_roles("admin"))):
    try:
        with get_db() as cursor:
            cursor.execute("""
                SELECT n.*, (SELECT COUNT(*) FROM ngo_operators WHERE ngo_id = n.id) as officer_count 
                FROM ngos n 
                ORDER BY n.created_at DESC;
            """)
            return cursor.fetchall()
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
            return cursor.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/admin/ngos", response_model=NGOResponse)
def create_ngo(payload: NGOCreate, current_user: dict = Depends(require_roles("admin"))):
    try:
        with get_db() as cursor:
            cursor.execute(
                """
                INSERT INTO ngos (name, slug, description, specialization, contact_name, contact_email, contact_phone, operating_region, district, address, is_active, created_by_admin_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *;
                """,
                (payload.name, payload.slug, payload.description, payload.specialization, payload.contact_name, payload.contact_email, payload.contact_phone, payload.operating_region, payload.district, payload.address, payload.is_active, current_user["sub"])
            )
            return cursor.fetchone()
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
            return updated
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/admin/ngo-officers", response_model=NGOOperatorResponse)
def create_ngo_officer(payload: NGOOperatorCreate, current_user: dict = Depends(require_roles("admin"))):
    """Admin creates an NGO officer by linking a user to an NGO and promoting their role."""
    try:
        with get_db() as cursor:
            # 1. Update user role to ngo_operator automatically
            cursor.execute("UPDATE users SET role = %s WHERE id = %s", ('ngo_operator', payload.user_id))
            
            # 2. Insert link
            cursor.execute(
                """
                INSERT INTO ngo_operators (ngo_id, user_id, role_within_ngo)
                VALUES (%s, %s, %s)
                ON CONFLICT (ngo_id, user_id) DO UPDATE SET role_within_ngo = EXCLUDED.role_within_ngo, is_active = TRUE
                RETURNING *;
                """,
                (payload.ngo_id, payload.user_id, payload.role_within_ngo)
            )
            op = cursor.fetchone()
            
            # 3. Audit
            cursor.execute(
                "INSERT INTO care_audit_log (actor_user_id, actor_role, action_type, entity_type, entity_id) VALUES (%s, %s, %s, %s, %s)",
                (current_user["sub"], current_user["role"], "officer_created", "ngo_operator", op["id"])
            )
            
            # 4. Fetch enriched details for response
            cursor.execute("SELECT u.username, u.email, u.full_name FROM users u WHERE u.id = %s", (payload.user_id,))
            u = cursor.fetchone()
            return {**op, **u} if u else op
            
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
            return cursor.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
