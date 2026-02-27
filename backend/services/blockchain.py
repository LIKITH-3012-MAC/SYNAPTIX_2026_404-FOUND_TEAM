"""
RESOLVIT - Blockchain Simulation Service
SHA-256 based immutable audit log (append-only chain)
"""
import hashlib
import json
from datetime import datetime
from database import get_db


def _compute_hash(previous_hash: str, payload: dict) -> str:
    """Compute SHA-256 hash of (previous_hash + serialized payload)."""
    raw = previous_hash + json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def _get_last_hash(cursor, issue_id: str) -> str:
    """Retrieve the hash of the most recent audit log for an issue."""
    cursor.execute(
        "SELECT hash FROM audit_logs WHERE issue_id = %s ORDER BY timestamp DESC LIMIT 1",
        (issue_id,)
    )
    row = cursor.fetchone()
    return row["hash"] if row else "0" * 64  # Genesis block


def log_event(
    issue_id: str,
    event_type: str,
    actor_id: str = None,
    old_value: dict = None,
    new_value: dict = None,
    title: str = "",
    description: str = ""
):
    """
    Append a new immutable audit event to the blockchain log.
    Each entry is chained to the previous via SHA-256 hash.
    """
    with get_db() as cursor:
        previous_hash = _get_last_hash(cursor, issue_id)

        payload = {
            "issue_id":   issue_id,
            "event_type": event_type,
            "actor_id":   actor_id,
            "old_value":  old_value,
            "new_value":  new_value,
            "title":      title,
            "description": description,
            "timestamp":  datetime.utcnow().isoformat()
        }

        computed_hash = _compute_hash(previous_hash, payload)

        cursor.execute(
            """
            INSERT INTO audit_logs
                (issue_id, event_type, actor_id, old_value, new_value, hash, previous_hash)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                issue_id,
                event_type,
                actor_id,
                json.dumps(old_value) if old_value else None,
                json.dumps(new_value) if new_value else None,
                computed_hash,
                previous_hash
            )
        )

    return computed_hash


def get_audit_chain(issue_id: str) -> list:
    """Return the full immutable audit chain for an issue."""
    with get_db() as cursor:
        cursor.execute(
            """
            SELECT al.*, u.username as actor_name
            FROM audit_logs al
            LEFT JOIN users u ON al.actor_id::uuid = u.id
            WHERE al.issue_id = %s
            ORDER BY al.timestamp ASC
            """,
            (issue_id,)
        )
        return [dict(row) for row in cursor.fetchall()]


def verify_chain_integrity(issue_id: str) -> dict:
    """
    Verify that the audit chain has not been tampered with.
    Re-computes each hash and checks against stored value.
    """
    chain = get_audit_chain(issue_id)
    if not chain:
        return {"valid": True, "blocks": 0, "tampered_at": None}

    prev_hash = "0" * 64
    for i, block in enumerate(chain):
        payload = {
            "issue_id":   block["issue_id"],
            "event_type": block["event_type"],
            "actor_id":   str(block.get("actor_id")) if block.get("actor_id") else None,
            "old_value":  block.get("old_value"),
            "new_value":  block.get("new_value"),
            "timestamp":  block["timestamp"].isoformat() if hasattr(block["timestamp"], "isoformat") else str(block["timestamp"])
        }
        expected = _compute_hash(prev_hash, payload)
        if expected != block["hash"]:
            return {"valid": False, "blocks": len(chain), "tampered_at": i}
        prev_hash = block["hash"]

    return {"valid": True, "blocks": len(chain), "tampered_at": None}
