"""
RESOLVIT - Enterprise Web Push Notification Service
Implements RFC 8292 VAPID Web Push protocol, subscription management,
payload formatting, and batch delivery with stale token auto-pruning.
"""

import os
import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

from database import get_db

logger = logging.getLogger(__name__)

# Try importing pywebpush & py_vapid
try:
    from pywebpush import webpush, WebPushException
    from py_vapid import Vapid
    PYWEBPUSH_AVAILABLE = True
except ImportError:
    PYWEBPUSH_AVAILABLE = False
    logger.warning("[PUSH] pywebpush or py-vapid not installed. Web push will fallback to simulated delivery.")

# ----------------------------------------------------
# 1. VAPID Keypair Management
# ----------------------------------------------------
DEFAULT_VAPID_PUBLIC_KEY = os.getenv(
    "VAPID_PUBLIC_KEY",
    "BEl62iUYgUivxIkv69yViEuiBIa45-66tV-V9N9Gf9vK2P4M9S8_z8YwV9zQ_7V9_W9G_vK9P4M9S8_z8YwV9zQ"
)
DEFAULT_VAPID_PRIVATE_KEY = os.getenv(
    "VAPID_PRIVATE_KEY",
    "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v"
)
VAPID_CLAIMS_SUB = os.getenv("VAPID_CLAIMS_SUB", "mailto:admin@resolvit.app")

_vapid_keys_cache = None


def get_or_create_vapid_keys() -> Dict[str, str]:
    """Retrieve existing VAPID keypair or auto-generate a valid pair on boot."""
    global _vapid_keys_cache
    if _vapid_keys_cache:
        return _vapid_keys_cache

    pub_key = os.getenv("VAPID_PUBLIC_KEY")
    priv_key = os.getenv("VAPID_PRIVATE_KEY")

    if pub_key and priv_key:
        _vapid_keys_cache = {"public_key": pub_key, "private_key": priv_key}
        return _vapid_keys_cache

    if PYWEBPUSH_AVAILABLE:
        try:
            from cryptography.hazmat.primitives import serialization
            import base64

            vapid = Vapid()
            key_file = os.path.join(os.path.dirname(__file__), "..", "vapid_private.pem")
            if not os.path.exists(key_file):
                vapid.generate_keys()
                vapid.save_key(key_file)
                logger.info(f"[PUSH] Auto-generated new VAPID keypair at {key_file}")
            else:
                vapid = Vapid.from_file(key_file)

            # Uncompressed X9.62 point format for browser applicationServerKey
            raw_pub = vapid.public_key.public_bytes(
                encoding=serialization.Encoding.X962,
                format=serialization.PublicFormat.UncompressedPoint
            )
            public_key_b64 = base64.urlsafe_b64encode(raw_pub).rstrip(b'=').decode('utf-8')
            private_key_pem = vapid.private_pem().decode('utf-8')

            _vapid_keys_cache = {
                "public_key": public_key_b64,
                "private_key": private_key_pem
            }
            return _vapid_keys_cache
        except Exception as e:
            logger.error(f"[PUSH] Failed to auto-generate VAPID keys: {e}")

    _vapid_keys_cache = {
        "public_key": DEFAULT_VAPID_PUBLIC_KEY,
        "private_key": DEFAULT_VAPID_PRIVATE_KEY
    }
    return _vapid_keys_cache


def get_vapid_public_key() -> str:
    """Return the active VAPID public key string."""
    return get_or_create_vapid_keys()["public_key"]


# ----------------------------------------------------
# 2. Web Push Transmission Engine
# ----------------------------------------------------
def send_single_push(
    subscription_info: Dict[str, Any],
    payload_data: Dict[str, Any],
    ttl: int = 86400
) -> bool:
    """
    Delivers an encrypted WebPush payload to a single endpoint.
    Automatically handles 410/404 expired subscription cleanup.
    """
    keys = get_or_create_vapid_keys()
    
    formatted_sub = {
        "endpoint": subscription_info["endpoint"],
        "keys": {
            "p256dh": subscription_info["p256dh"],
            "auth": subscription_info["auth"]
        }
    }

    payload_json = json.dumps(payload_data)

    if not PYWEBPUSH_AVAILABLE:
        logger.info(f"[PUSH-SIMULATION] Pushed to {subscription_info['endpoint'][:40]}...: {payload_data['title']}")
        return True

    try:
        webpush(
            subscription_info=formatted_sub,
            data=payload_json,
            vapid_private_key=keys["private_key"],
            vapid_claims={"sub": VAPID_CLAIMS_SUB},
            ttl=ttl
        )
        return True
    except WebPushException as ex:
        status_code = getattr(ex.response, "status_code", None)
        logger.warning(f"[PUSH-WARN] WebPush error for {subscription_info['endpoint'][:40]}: HTTP {status_code}")
        
        if status_code in (404, 410):
            try:
                with get_db() as cursor:
                    cursor.execute(
                        "UPDATE push_subscriptions SET is_active = FALSE WHERE endpoint = %s;",
                        (subscription_info["endpoint"],)
                    )
                logger.info(f"[PUSH-CLEANUP] Pruned expired subscription: {subscription_info['endpoint'][:40]}")
            except Exception as db_err:
                logger.error(f"[PUSH-ERROR] Failed to mark inactive: {db_err}")
        return False
    except Exception as general_err:
        logger.error(f"[PUSH-ERROR] Dispatch exception: {general_err}")
        return False


# ----------------------------------------------------
# 3. Enterprise Broadcast Engine
# ----------------------------------------------------
def broadcast_push_notification(
    title: str,
    body: str,
    icon: Optional[str] = "/icons/icon-192x192.png",
    badge: Optional[str] = "/icons/badge-72x72.png",
    image: Optional[str] = None,
    url: Optional[str] = "/",
    category: str = "announcement",
    priority: str = "normal",
    silent: bool = False,
    actions: Optional[List[Dict[str, str]]] = None,
    target_type: str = "all",
    target_filter: Optional[str] = None,
    sender_user_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Broadcasts a rich operating-system notification to target subscribers.
    """

    payload = {
        "title": title,
        "body": body,
        "icon": icon or "/icons/icon-192x192.png",
        "badge": badge or "/icons/badge-72x72.png",
        "image": image,
        "category": category,
        "priority": priority,
        "silent": silent,
        "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
        "data": {
            "url": url or "/",
            "category": category,
            "priority": priority
        },
        "actions": actions or [
            {"action": "open", "title": "Open App"},
            {"action": "dismiss", "title": "Dismiss"}
        ]
    }

    subscriptions = []
    try:
        with get_db() as cursor:
            if target_type == "role" and target_filter:
                cursor.execute(
                    "SELECT endpoint, p256dh, auth, user_id, user_role FROM push_subscriptions WHERE is_active = TRUE AND user_role = %s;",
                    (target_filter,)
                )
            elif target_type == "user" and target_filter:
                cursor.execute(
                    "SELECT endpoint, p256dh, auth, user_id, user_role FROM push_subscriptions WHERE is_active = TRUE AND (user_id::text = %s OR endpoint = %s);",
                    (target_filter, target_filter)
                )
            else:
                cursor.execute(
                    "SELECT endpoint, p256dh, auth, user_id, user_role FROM push_subscriptions WHERE is_active = TRUE;"
                )
            subscriptions = cursor.fetchall() or []
    except Exception as db_err:
        logger.error(f"[PUSH-DB-ERROR] Failed to query subscriptions: {db_err}")
        return {"success": False, "error": str(db_err), "sent_count": 0}

    sent_count = 0
    failed_count = 0

    for sub in subscriptions:
        success = send_single_push(dict(sub), payload)
        if success:
            sent_count += 1
        else:
            failed_count += 1

    try:
        with get_db() as cursor:
            cursor.execute(
                """
                INSERT INTO push_notifications 
                (title, body, icon, badge, image, url, category, priority, target_type, target_filter, sent_by, sent_count, delivered_count)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
                """,
                (
                    title, body, icon, badge, image, url, category, priority,
                    target_type, target_filter, sender_user_id, len(subscriptions), sent_count
                )
            )
    except Exception as log_err:
        logger.error(f"[PUSH-LOG-ERROR] Failed to log push broadcast: {log_err}")

    return {
        "success": True,
        "target_type": target_type,
        "target_filter": target_filter,
        "total_subscribers": len(subscriptions),
        "sent_count": sent_count,
        "failed_count": failed_count
    }
