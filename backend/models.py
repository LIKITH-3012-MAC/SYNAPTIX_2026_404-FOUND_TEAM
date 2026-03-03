"""
RESOLVIT - Pydantic Models
Request/Response schemas for all API endpoints
"""
from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional, List, Any
from datetime import datetime
from uuid import UUID
from enum import Enum


# ── Enums ─────────────────────────────────────────────────────
class UserRole(str, Enum):
    citizen   = "citizen"
    authority = "authority"
    admin     = "admin"

class IssueCategory(str, Enum):
    Roads       = "Roads"
    Water       = "Water"
    Electricity = "Electricity"
    Sanitation  = "Sanitation"
    Safety      = "Safety"
    Environment = "Environment"
    Other       = "Other"

class IssueStatus(str, Enum):
    reported   = "reported"
    verified   = "verified"
    clustered  = "clustered"
    assigned   = "assigned"
    in_progress = "in_progress"
    escalated  = "escalated"
    resolved   = "resolved"


# ── Auth Schemas ──────────────────────────────────────────────
class UserRegister(BaseModel):
    username:   str = Field(..., min_length=3, max_length=64)
    email:      EmailStr
    password:   str = Field(..., min_length=8, max_length=128)
    role:       UserRole = UserRole.citizen
    full_name:  Optional[str] = None
    department: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_strength(cls, v):
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one digit")
        return v


class UserLogin(BaseModel):
    email:    EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    role:         str
    user_id:      str
    username:     str


class UserResponse(BaseModel):
    id:         str
    username:   str
    email:      str
    role:       str
    full_name:  Optional[str]
    department: Optional[str]
    created_at: Optional[datetime]


# ── Issue Schemas ─────────────────────────────────────────────
class IssueCreate(BaseModel):
    title:       str = Field(..., min_length=10, max_length=256)
    description: str = Field(..., min_length=20)
    category:    IssueCategory
    latitude:    float = Field(..., ge=-90, le=90)
    longitude:   float = Field(..., ge=-180, le=180)
    urgency:     int = Field(3, ge=1, le=5)
    impact_scale: int = Field(1, ge=1)
    image_url:   Optional[str] = None
    safety_risk_probability: float = Field(0.1, ge=0.0, le=1.0)


class IssueUpdate(BaseModel):
    title:                  Optional[str] = None
    description:            Optional[str] = None
    status:                 Optional[IssueStatus] = None
    urgency:                Optional[int] = Field(None, ge=1, le=5)
    impact_scale:           Optional[int] = Field(None, ge=1)
    assigned_authority_id:  Optional[str] = None
    resolution_note:        Optional[str] = None
    resolution_proof_url:   Optional[str] = None
    safety_risk_probability: Optional[float] = Field(None, ge=0.0, le=1.0)


class IssueResponse(BaseModel):
    id:                     str
    title:                  str
    description:            str
    category:               str
    latitude:               Optional[float]
    longitude:              Optional[float]
    urgency:                int
    impact_scale:           int
    image_url:              Optional[str]
    status:                 str
    priority_score:         float
    safety_risk_probability: float
    cluster_id:             Optional[str]
    reporter_id:            str
    assigned_authority_id:  Optional[str]
    resolution_note:        Optional[str]
    resolution_proof_url:   Optional[str]
    created_at:             datetime
    updated_at:             datetime
    resolved_at:            Optional[datetime]
    days_unresolved:        Optional[float] = None
    reporter_name:          Optional[str] = None
    authority_name:         Optional[str] = None


# ── Metrics Schemas ───────────────────────────────────────────
class AuthorityMetricsResponse(BaseModel):
    authority_id:       str
    username:           str
    full_name:          Optional[str]
    department:         Optional[str]
    total_assigned:     int
    total_resolved:     int
    total_escalated:    int
    avg_response_time:  float
    avg_resolution_time: float
    resolution_rate:    float
    escalation_rate:    float
    performance_score:  float


# ── Audit Log Schema ──────────────────────────────────────────
class AuditLogResponse(BaseModel):
    id:             str
    issue_id:       str
    event_type:     str
    actor_id:       Optional[str]
    old_value:      Optional[Any]
    new_value:      Optional[Any]
    hash:           str
    previous_hash:  Optional[str]
    timestamp:      datetime


# ── Generic Response ──────────────────────────────────────────
class MessageResponse(BaseModel):
    message: str
    detail:  Optional[Any] = None


# ── Feedback Schemas ──────────────────────────────────────────
class AppFeedbackCreate(BaseModel):
    ui_rating:         int = Field(..., ge=1, le=5)
    ux_rating:         int = Field(..., ge=1, le=5)
    experience_rating: int = Field(..., ge=1, le=5)
    comment:           Optional[str] = None
