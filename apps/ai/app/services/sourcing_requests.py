"""Phase 3 sourcing requests — the no-results workflow (plan §4).

When no suitable offer exists, the discovery graph creates a structured
sourcing request (migration 055: `tropical_sourcing_requests`) and
records a PENDING notification (`tropical_sourcing_notifications`).

Notification DELIVERY is a stub on purpose: the row records that the
requester must be told when a real opportunity appears, but nothing is
sent — no email, no push. Delivery, matching, and verification of
candidates belong to the Phase 4 operations CRM. The status vocabulary
is exactly open | matched | notified; only ops moves a request out of
`open` (enforced by the 055 trigger + RLS).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from app.core.logging import get_logger

logger = get_logger("services.sourcing_requests")

SOURCING_REQUESTS_TABLE = "tropical_sourcing_requests"
SOURCING_NOTIFICATIONS_TABLE = "tropical_sourcing_notifications"


def build_sourcing_requirements(query: str, requirements: Any) -> dict:
    """Structured requirements stored on the request (JSONB)."""
    req = requirements or {}
    if hasattr(req, "to_dict"):
        req = req.to_dict()
    return {
        "query": query,
        "category": req.get("category"),
        "terms": list(req.get("terms") or []),
        "location": req.get("location"),
        "passion": req.get("passion"),
    }


async def _get_client(supabase=None):
    if supabase is not None:
        return supabase._client
    from app.core.database import get_supabase_client  # noqa: PLC0415

    wrapper = await get_supabase_client()
    return wrapper._client


async def create_sourcing_request(
    user_id: str,
    query: str,
    requirements: Any = None,
    conversation_id: Optional[str] = None,
    supabase=None,
) -> dict:
    """Insert a sourcing request in status `open`. Returns the stored row."""
    if not (query or "").strip():
        raise ValueError("A sourcing request needs the buyer's query.")
    client = await _get_client(supabase)
    row = {
        "user_id": user_id,
        "query": query.strip(),
        "requirements": build_sourcing_requirements(query, requirements),
        "status": "open",
        "conversation_id": conversation_id,
    }
    result = client.table(SOURCING_REQUESTS_TABLE).insert(row).execute()
    created = (result.data or [row])[0]
    logger.info(
        "Sourcing request created",
        sourcing_request_id=created.get("id"),
        user_id=user_id,
    )
    return created


async def record_pending_notification(
    sourcing_request_id: str,
    user_id: str,
    channel: str = "email",
    supabase=None,
) -> dict:
    """Record that the requester must be notified when a match appears.

    STUB — this only writes the pending row. Nothing is sent. Delivery
    (email/push) is Phase 4 work; until then the row is the queue.
    """
    client = await _get_client(supabase)
    row = {
        "sourcing_request_id": sourcing_request_id,
        "user_id": user_id,
        "channel": channel,
        "status": "pending",
        "sent_at": None,
    }
    result = client.table(SOURCING_NOTIFICATIONS_TABLE).insert(row).execute()
    created = (result.data or [row])[0]
    logger.info(
        "Pending sourcing notification recorded (not sent — stub)",
        sourcing_request_id=sourcing_request_id,
        user_id=user_id,
    )
    return created


async def get_sourcing_request(request_id: str, supabase=None) -> Optional[dict]:
    """Fetch one sourcing request by id, or None."""
    client = await _get_client(supabase)
    result = (
        client.table(SOURCING_REQUESTS_TABLE)
        .select("*")
        .eq("id", request_id)
        .single()
        .execute()
    )
    data = result.data or []
    if isinstance(data, dict):
        return data
    return data[0] if data else None
