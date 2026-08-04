"""
RESOLVIT - Push Notification API Endpoints
Handles VAPID key retrieval, client subscriptions, test pushes,
and enterprise broadcast dispatching for administrators and authorities.
"""

from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, Field

from database import get_db
from auth import get_optional_current_user, get_current_user
from services.push_service import (
    get_vapid_public_key,
    send_single_push,
    broadcast_push_notification
)

router = APIRouter()

# ----------------------------------------------------
# Pydantic Schemas
# ----------------------------------------------------
class PushKeysSchema(BaseModel):
    p256dh: str
    auth: str

class SubscribePayload(BaseModel):
    endpoint: str
    keys: PushKeysSchema
    user_role: Optional[str] = "citizen"
    device_type: Optional[str] = "unknown"

class UnsubscribePayload(BaseModel):
    endpoint: str

class BroadcastPayload(BaseModel):
    title: str = Field(..., example="Critical Alert: Road Maintenance Scheduled")
    body: str = Field(..., example="Crews will be active in Ward 4 tomorrow morning.")
    icon: Optional[str] = "/icons/icon-192x192.png"
    badge: Optional[str] = "/icons/badge-72x72.png"
    image: Optional[str] = None
    url: Optional[str] = "/"
    category: Optional[str] = "announcement"
    priority: Optional[str] = "normal"
    silent: Optional[bool] = False
    actions: Optional[List[Dict[str, str]]] = None
    target_type: Optional[str] = "all"  # 'all', 'role', 'user'
    target_filter: Optional[str] = None  # e.g., 'citizen', 'authority', 'admin', 'ngo'

class TestPushPayload(BaseModel):
    endpoint: Optional[str] = None


# ----------------------------------------------------
# 1. Public VAPID Key Endpoint
# ----------------------------------------------------
@router.get("/vapid-public-key")
def vapid_public_key():
    """Returns the VAPID public key string for WebPush subscription registration."""
    key = get_vapid_public_key()
    return {
        "success": True,
        "public_key": key
    }


# ----------------------------------------------------
# 2. Subscribe Endpoint
# ----------------------------------------------------
@router.post("/subscribe")
def subscribe_device(
    payload: SubscribePayload,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_current_user)
):
    """
    Registers a WebPush browser endpoint and cryptographic keys (p256dh, auth).
    Supports both authenticated citizens/admins and guest visitors.
    """
    user_id = current_user.get("id") if current_user else None
    user_role = current_user.get("role", payload.user_role or "citizen") if current_user else (payload.user_role or "citizen")

    try:
        with get_db() as cursor:
            cursor.execute(
                """
                INSERT INTO push_subscriptions 
                (user_id, endpoint, p256dh, auth, user_role, device_type, is_active, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, TRUE, NOW())
                ON CONFLICT (endpoint) 
                DO UPDATE SET 
                    user_id = COALESCE(EXCLUDED.user_id, push_subscriptions.user_id),
                    p256dh = EXCLUDED.p256dh,
                    auth = EXCLUDED.auth,
                    user_role = EXCLUDED.user_role,
                    device_type = EXCLUDED.device_type,
                    is_active = TRUE,
                    updated_at = NOW();
                """,
                (user_id, payload.endpoint, payload.keys.p256dh, payload.keys.auth, user_role, payload.device_type)
            )
        return {
            "success": True,
            "message": "Push subscription registered successfully",
            "endpoint_preview": payload.endpoint[:40] + "..."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save push subscription: {str(e)}")


# ----------------------------------------------------
# 3. Unsubscribe Endpoint
# ----------------------------------------------------
@router.post("/unsubscribe")
def unsubscribe_device(payload: UnsubscribePayload):
    """Deactivates a WebPush subscription."""
    try:
        with get_db() as cursor:
            cursor.execute(
                "UPDATE push_subscriptions SET is_active = FALSE, updated_at = NOW() WHERE endpoint = %s;",
                (payload.endpoint,)
            )
        return {
            "success": True,
            "message": "Push subscription deactivated successfully"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to deactivate subscription: {str(e)}")


# ----------------------------------------------------
# 4. Status Check Endpoint
# ----------------------------------------------------
@router.get("/status")
def push_status(current_user: Optional[Dict[str, Any]] = Depends(get_optional_current_user)):
    """Returns system subscription statistics."""
    try:
        with get_db() as cursor:
            cursor.execute("SELECT COUNT(*) as total_active FROM push_subscriptions WHERE is_active = TRUE;")
            row = cursor.fetchone()
            total_active = row["total_active"] if row else 0

            user_active = 0
            if current_user:
                cursor.execute(
                    "SELECT COUNT(*) as u_count FROM push_subscriptions WHERE user_id = %s AND is_active = TRUE;",
                    (current_user["id"],)
                )
                u_row = cursor.fetchone()
                user_active = u_row["u_count"] if u_row else 0

        return {
            "success": True,
            "total_active_subscriptions": total_active,
            "user_active_subscriptions": user_active,
            "vapid_ready": True
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ----------------------------------------------------
# 5. Send Test Notification Endpoint
# ----------------------------------------------------
@router.post("/send-test")
def send_test_push(
    payload: TestPushPayload,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_current_user)
):
    """Sends a real OS-native test notification to caller's registered device endpoint."""
    endpoint = payload.endpoint
    sub_data = None

    try:
        with get_db() as cursor:
            if endpoint:
                cursor.execute(
                    "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = %s AND is_active = TRUE LIMIT 1;",
                    (endpoint,)
                )
            elif current_user:
                cursor.execute(
                    "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = %s AND is_active = TRUE ORDER BY updated_at DESC LIMIT 1;",
                    (current_user["id"],)
                )
            else:
                cursor.execute(
                    "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE is_active = TRUE ORDER BY updated_at DESC LIMIT 1;"
                )
            sub_data = cursor.fetchone()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    if not sub_data:
        raise HTTPException(status_code=404, detail="No active push subscription found to deliver test notification.")

    test_payload = {
        "title": "⚡ RESOLVIT Test Notification",
        "body": "Your WebPush notification service is active and operating perfectly!",
        "icon": "/icons/icon-192x192.png",
        "badge": "/icons/badge-72x72.png",
        "category": "test",
        "priority": "high",
        "data": {
            "url": "/dashboard.html",
            "timestamp": 123456789
        },
        "actions": [
            {"action": "open", "title": "View Dashboard"},
            {"action": "dismiss", "title": "Dismiss"}
        ]
    }

    success = send_single_push(dict(sub_data), test_payload)

    return {
        "success": success,
        "message": "Test push notification dispatched successfully!" if success else "Failed to deliver push notification.",
        "endpoint_preview": sub_data["endpoint"][:40] + "..."
    }


# ----------------------------------------------------
# 6. Admin Broadcast Endpoint
# ----------------------------------------------------
@router.post("/broadcast")
def broadcast_push(
    payload: BroadcastPayload,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Broadcasts real operating system notifications to target audiences.
    Restricted to Admin, Authority, or NGO roles.
    """
    role = current_user.get("role", "").lower()
    if role not in ("admin", "authority", "ngo", "superadmin"):
        raise HTTPException(status_code=403, detail="Unauthorized. Only administrators and authorities can broadcast push notifications.")

    res = broadcast_push_notification(
        title=payload.title,
        body=payload.body,
        icon=payload.icon,
        badge=payload.badge,
        image=payload.image,
        url=payload.url,
        category=payload.category or "announcement",
        priority=payload.priority or "normal",
        silent=payload.silent or False,
        actions=payload.actions,
        target_type=payload.target_type or "all",
        target_filter=payload.target_filter,
        sender_user_id=current_user.get("id")
    )

    return res
