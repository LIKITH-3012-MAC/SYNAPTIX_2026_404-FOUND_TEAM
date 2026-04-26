"""
RESOLVIT - Admin Export Routes
Enterprise-grade CSV export feature for Admin Control Tower enabling real DB-backed data intelligence exports.
"""

import io
import csv
import json
from typing import Optional, List, Any
from fastapi import APIRouter, HTTPException, Depends, Query, Request
from fastapi.responses import StreamingResponse
from datetime import datetime
from psycopg2.extras import Json

from database import get_db
from auth import require_roles
from models import DataResponse, MessageResponse

router = APIRouter()

# ─────────────────────────────────────────────────────────────
# EXPORT DATASET QUERIES & SCHEMAS
# ─────────────────────────────────────────────────────────────

DATASETS = {
    "issues": {
        "query": """
            SELECT 
                i.id, i.tracking_id, i.title, i.description, i.category, i.subcategory, 
                i.status, i.urgency, i.priority_score, i.impact_scale, i.safety_risk_probability,
                i.city, i.district, i.ward, i.location_text, i.latitude, i.longitude,
                u.full_name as citizen_name, u.email as citizen_email,
                a.full_name as assigned_authority, n.name as assigned_ngo,
                i.created_at, i.updated_at, i.resolved_at,
                i.escalation_level, i.sla_status, i.resolution_summary, i.latest_admin_note
            FROM issues i
            LEFT JOIN users u ON i.reporter_id = u.id
            LEFT JOIN users a ON i.assigned_authority_id = a.id
            LEFT JOIN ngos n ON i.assigned_ngo_id = n.id
        """,
        "columns": [
            "id", "tracking_id", "title", "description", "category", "subcategory", 
            "status", "urgency", "priority_score", "impact_scale", "safety_risk_probability",
            "city", "district", "ward", "location_text", "latitude", "longitude",
            "citizen_name", "citizen_email", "assigned_authority", "assigned_ngo",
            "created_at", "updated_at", "resolved_at", "escalation_level", 
            "sla_status", "resolution_summary", "latest_admin_note"
        ]
    },
    "citizens": {
        "query": """
            SELECT 
                id as user_id, full_name as name, email, role, is_active as status,
                trust_score, points_cache as civic_credits, reports_filed,
                resolved_reports, active_reports, created_at as joined_at, last_login_at
            FROM users
            WHERE role = 'citizen'
        """,
        "columns": [
            "user_id", "name", "email", "role", "status", "trust_score", 
            "civic_credits", "reports_filed", "resolved_reports", "active_reports",
            "joined_at", "last_login_at"
        ]
    },
    "authorities": {
        "query": """
            SELECT 
                u.id as authority_id, u.full_name as name, u.department, u.email,
                m.total_assigned as assigned_issues, m.total_resolved as resolved_issues, 
                m.total_escalated as escalated_issues, m.avg_resolution_time, m.sla_breach_count
            FROM users u
            LEFT JOIN authority_metrics m ON u.id = m.authority_id
            WHERE u.role = 'authority'
        """,
        "columns": [
            "authority_id", "name", "department", "email", "assigned_issues", 
            "resolved_issues", "escalated_issues", "avg_resolution_time", "sla_breach_count"
        ]
    },
    "care_reports": {
        "query": """
            SELECT 
                r.id as care_report_id, r.title, r.category, r.status,
                n.name as assigned_ngo, o.full_name as assigned_officer,
                r.urgency_score as urgency, r.location_text as location,
                r.created_at, r.resolved_at, r.resolution_summary
            FROM reports r
            LEFT JOIN ngos n ON r.assigned_ngo_id = n.id
            LEFT JOIN users o ON r.assigned_officer_id = o.id
        """,
        "columns": [
            "care_report_id", "title", "category", "status", "assigned_ngo", 
            "assigned_officer", "urgency", "location", "created_at", "resolved_at", "resolution_summary"
        ]
    },
    "ngos": {
        "query": """
            SELECT 
                id as ngo_id, name as ngo_name, specialization, operating_region as region,
                contact_email, contact_phone, is_active as active_status,
                assigned_reports, resolved_reports, created_at
            FROM ngos
        """,
        "columns": [
            "ngo_id", "ngo_name", "specialization", "region", "contact_email", 
            "contact_phone", "active_status", "assigned_reports", "resolved_reports", "created_at"
        ]
    },
    "volunteers": {
        "query": """
            SELECT 
                v.id as volunteer_id, v.full_name as name, v.email, v.skills, 
                v.languages, v.current_region as region, v.availability_status, 
                n.name as ngo_name, v.created_at
            FROM volunteers v
            LEFT JOIN ngos n ON v.ngo_id = n.id
        """,
        "columns": [
            "volunteer_id", "name", "email", "skills", "languages", "region", 
            "availability_status", "ngo_name", "created_at"
        ]
    },
    "audit_logs": {
        "query": """
            SELECT 
                l.id as audit_id, u.username as actor, u.role as actor_role,
                l.action as action_type, l.entity_type, l.entity_id, 
                l.new_value as metadata, l.created_at as timestamp
            FROM admin_audit_logs l
            LEFT JOIN users u ON l.admin_id = u.id
        """,
        "columns": [
            "audit_id", "actor", "actor_role", "action_type", "entity_type", 
            "entity_id", "metadata", "timestamp"
        ]
    },
    "email_logs": {
        "query": """
            SELECT 
                id as email_id, recipient, template_name as email_type, 
                issue_id as related_issue_id, subject, status, 
                resend_message_id, created_at as sent_at, error_message
            FROM email_audit_logs
        """,
        "columns": [
            "email_id", "recipient", "email_type", "related_issue_id", "subject", 
            "status", "resend_message_id", "sent_at", "error_message"
        ]
    }
}

# ─────────────────────────────────────────────────────────────
# EXPORT API
# ─────────────────────────────────────────────────────────────

@router.get("/csv")
def export_csv(
    request: Request,
    type: str = Query(..., description="Type of dataset to export"),
    city: Optional[str] = Query(None),
    district: Optional[str] = Query(None),
    ward: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    authority_id: Optional[str] = Query(None),
    ngo_id: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    urgency_min: Optional[int] = Query(None),
    urgency_max: Optional[int] = Query(None),
    priority_min: Optional[float] = Query(None),
    priority_max: Optional[float] = Query(None),
    resolved_only: Optional[bool] = Query(False),
    escalated_only: Optional[bool] = Query(False),
    include_audit: Optional[bool] = Query(False),
    include_email_logs: Optional[bool] = Query(False),
    include_notes: Optional[bool] = Query(False),
    include_geo: Optional[bool] = Query(False),
    include_ai_scores: Optional[bool] = Query(False),
    current_admin: dict = Depends(require_roles("admin"))
):
    """Admin-only CSV Export Endpoint with streaming."""
    
    if type not in DATASETS:
        raise HTTPException(status_code=400, detail=f"Invalid export type: {type}")
        
    dataset = DATASETS[type]
    query_base = dataset["query"]
    columns = dataset["columns"].copy()
    
    # ── Security Exclusions ──
    # Explicitly exclude sensitive columns even if somehow queried
    sensitive_cols = ["password_hash", "firebase_uid", "auth_provider_id", "twitter_access_token_encrypted", "twitter_refresh_token_encrypted"]
    columns = [col for col in columns if col not in sensitive_cols]
    
    # ── Dynamic Query Building ──
    conditions = []
    params = []
    
    # Prefix mapping based on type
    prefix = ""
    if type == "issues": prefix = "i."
    elif type == "citizens": prefix = ""
    elif type == "authorities": prefix = "u."
    elif type == "care_reports": prefix = "r."
    elif type == "ngos": prefix = ""
    elif type == "volunteers": prefix = "v."
    elif type == "audit_logs": prefix = "l."
    elif type == "email_logs": prefix = ""
    
    if city and type in ["issues"]:
        conditions.append(f"{prefix}city = %s")
        params.append(city)
    if district and type in ["issues", "care_reports"]:
        conditions.append(f"{prefix}district = %s")
        params.append(district)
    if ward and type in ["issues", "care_reports"]:
        conditions.append(f"{prefix}ward = %s")
        params.append(ward)
    if category and type in ["issues", "care_reports"]:
        conditions.append(f"{prefix}category = %s")
        params.append(category)
    if status and type in ["issues", "care_reports"]:
        conditions.append(f"{prefix}status = %s")
        params.append(status)
    if authority_id and type == "issues":
        conditions.append(f"{prefix}assigned_authority_id = %s")
        params.append(authority_id)
    if ngo_id and type in ["issues", "care_reports", "volunteers"]:
        conditions.append(f"{prefix}assigned_ngo_id = %s" if type != "volunteers" else f"{prefix}ngo_id = %s")
        params.append(ngo_id)
    if date_from:
        conditions.append(f"{prefix}created_at >= %s")
        params.append(date_from)
    if date_to:
        conditions.append(f"{prefix}created_at <= %s")
        params.append(date_to)
    if urgency_min is not None and type in ["issues", "care_reports"]:
        col = "urgency" if type == "issues" else "urgency_score"
        conditions.append(f"{prefix}{col} >= %s")
        params.append(urgency_min)
    if urgency_max is not None and type in ["issues", "care_reports"]:
        col = "urgency" if type == "issues" else "urgency_score"
        conditions.append(f"{prefix}{col} <= %s")
        params.append(urgency_max)
    if priority_min is not None and type == "issues":
        conditions.append(f"{prefix}priority_score >= %s")
        params.append(priority_min)
    if priority_max is not None and type == "issues":
        conditions.append(f"{prefix}priority_score <= %s")
        params.append(priority_max)
    if resolved_only and type in ["issues", "care_reports"]:
        conditions.append(f"{prefix}status = 'resolved'")
    if escalated_only and type == "issues":
        conditions.append(f"{prefix}status = 'escalated'")
        
    # Optional columns logic (mostly for 'issues' type)
    if type == "issues":
        if not include_geo:
            columns = [c for c in columns if c not in ["latitude", "longitude", "city", "district", "ward"]]
        if not include_ai_scores:
            columns = [c for c in columns if c not in ["safety_risk_probability", "impact_scale"]]
        if not include_notes:
            columns = [c for c in columns if c not in ["resolution_summary", "latest_admin_note"]]
            
    # Construct final query
    final_query = query_base
    if "WHERE" in final_query:
        if conditions:
            final_query += " AND " + " AND ".join(conditions)
    else:
        if conditions:
            final_query += " WHERE " + " AND ".join(conditions)
            
    final_query += f" ORDER BY {prefix}created_at DESC"
    
    # ── Database Execution & Streaming ──
    try:
        with get_db() as cursor:
            cursor.execute(final_query, tuple(params))
            rows = cursor.fetchall()
            row_count = len(rows)
            
            # Audit Logging for Export
            audit_metadata = {
                "type": type,
                "filters": dict(request.query_params),
                "row_count": row_count,
                "user_agent": request.headers.get("user-agent", "Unknown")
            }
            cursor.execute(
                "INSERT INTO admin_audit_logs (admin_id, entity_type, action, new_value) VALUES (%s, %s, %s, %s)",
                (current_admin["sub"], "csv_export", "admin_csv_exported", Json(audit_metadata))
            )
            
    except Exception as e:
        # Log failure
        with get_db() as cursor:
            audit_metadata = {
                "type": type,
                "filters": dict(request.query_params),
                "status": "failed",
                "error": str(e),
                "user_agent": request.headers.get("user-agent", "Unknown")
            }
            cursor.execute(
                "INSERT INTO admin_audit_logs (admin_id, entity_type, action, new_value) VALUES (%s, %s, %s, %s)",
                (current_admin["sub"], "csv_export", "admin_csv_exported", Json(audit_metadata))
            )
        raise HTTPException(status_code=500, detail=f"Database query failed: {e}")

    # Generate CSV content
    def generate_csv():
        output = io.StringIO()
        # Add UTF-8 BOM for Excel compatibility
        output.write('\ufeff')
        writer = csv.writer(output, quoting=csv.QUOTE_ALL)
        
        # Write headers
        writer.writerow(columns)
        yield output.getvalue()
        output.seek(0)
        output.truncate(0)
        
        # Write data rows
        for row in rows:
            # Map row keys to columns and format values
            row_data = []
            for col in columns:
                val = row.get(col, "")
                if val is None:
                    row_data.append("")
                elif isinstance(val, datetime):
                    row_data.append(val.isoformat())
                elif isinstance(val, dict) or isinstance(val, list):
                    row_data.append(json.dumps(val))
                else:
                    row_data.append(str(val))
            writer.writerow(row_data)
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)
            
    # Dynamic filename
    filter_suffix = ""
    if district: filter_suffix += f"_{district}"
    if status: filter_suffix += f"_{status}"
    if resolved_only: filter_suffix += "_resolved"
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M")
    filename = f"resolvit_{type}{filter_suffix}_{timestamp}.csv"
    
    return StreamingResponse(
        generate_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@router.get("/history", response_model=DataResponse[list])
def get_export_history(
    limit: int = Query(20, ge=1, le=100),
    current_admin: dict = Depends(require_roles("admin"))
):
    """Get recent CSV exports by admins."""
    with get_db() as cursor:
        cursor.execute(
            """
            SELECT l.id, u.username as admin_name, l.new_value as metadata, l.created_at
            FROM admin_audit_logs l
            JOIN users u ON l.admin_id = u.id
            WHERE l.entity_type = 'csv_export' AND l.action = 'admin_csv_exported'
            ORDER BY l.created_at DESC
            LIMIT %s
            """,
            (limit,)
        )
        rows = cursor.fetchall()
        
    history = []
    for r in rows:
        meta = r.get("metadata") or {}
        history.append({
            "id": str(r["id"]),
            "admin_name": r["admin_name"],
            "type": meta.get("type", "unknown"),
            "row_count": meta.get("row_count", 0),
            "filters": meta.get("filters", {}),
            "status": meta.get("status", "success"),
            "created_at": r["created_at"].isoformat() if isinstance(r["created_at"], datetime) else str(r["created_at"])
        })
        
    return {
        "success": True,
        "data": history
    }
