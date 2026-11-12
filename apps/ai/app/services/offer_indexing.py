"""Phase 3 offer-level Pinecone indexing.

Reuses the profile vectorization seam instead of duplicating it: the
same embedding service (`generate_embedding`, Gemini
`gemini-embedding-001`) and the same Pinecone index. Offer vectors are
distinguishable from profile vectors by metadata
(`record_type: "offer"`) and by id (`offer-<offer_id>`), so the
talent-search filter (`user_id != ...`) never collides with them.

Only `published` offers are indexed — drafts must not surface in buyer
search. After a successful upsert the offer row is stamped with
`search_indexed_at` (the placeholder Phase 2 left in `tropical_offers`).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from app.core.logging import get_logger
from app.services.embedding_service import generate_embedding
from app.services.offer_search import OFFERS_TABLE, OFFER_VECTOR_PREFIX

logger = get_logger("services.offer_indexing")


def offer_to_text(offer: dict) -> str:
    """Text to embed: provider-stated fields only, no invented claims."""
    parts = [
        offer.get("title") or "",
        offer.get("description") or "",
        f"category: {offer.get('category') or ''}",
        "skills: " + ", ".join(offer.get("skills") or []),
        "languages: " + ", ".join(offer.get("languages") or []),
        f"city: {offer.get('city') or ''}",
        f"country: {offer.get('country') or ''}",
    ]
    capacity = offer.get("production_capacity") or {}
    if isinstance(capacity, dict) and capacity.get("monthly_amount"):
        parts.append(
            f"production capacity: {capacity.get('monthly_amount')} "
            f"{capacity.get('unit') or ''} per month"
        )
    return "\n".join(p for p in parts if p.strip())


async def _get_client(supabase=None):
    if supabase is not None:
        return supabase._client
    from app.core.database import get_supabase_client  # noqa: PLC0415

    return (await get_supabase_client())._client


def _get_index(pinecone_index=None):
    if pinecone_index is not None:
        return pinecone_index
    from app.core.pinecone_client import get_pinecone_index  # noqa: PLC0415

    return get_pinecone_index()


async def index_offer(
    offer_id: str, supabase=None, pinecone_index=None
) -> dict:
    """Vectorize one published offer and stamp `search_indexed_at`."""
    client = await _get_client(supabase)
    try:
        result = (
            client.table(OFFERS_TABLE)
            .select("*")
            .eq("id", offer_id)
            .single()
            .execute()
        )
        rows = result.data
        row = rows[0] if isinstance(rows, list) and rows else (
            rows if isinstance(rows, dict) else None
        )
    except Exception as exc:  # noqa: BLE001
        return {"offer_id": offer_id, "success": False, "message": str(exc)}
    if not row:
        return {
            "offer_id": offer_id,
            "success": False,
            "message": f"Offer {offer_id} not found",
        }
    if row.get("status") != "published":
        return {
            "offer_id": offer_id,
            "success": False,
            "message": f"Offer {offer_id} is {row.get('status')}, not published — draft offers are never indexed",
        }
    try:
        embedding = await generate_embedding(offer_to_text(row))
        if not embedding:
            return {
                "offer_id": offer_id,
                "success": False,
                "message": "Embedding generation returned nothing",
            }
        vector_id = f"{OFFER_VECTOR_PREFIX}{offer_id}"
        index = _get_index(pinecone_index)
        index.upsert(
            vectors=[
                {
                    "id": vector_id,
                    "values": embedding,
                    "metadata": {
                        "record_type": "offer",
                        "offer_id": offer_id,
                        "category": row.get("category") or "",
                        "title": row.get("title") or "",
                        "city": row.get("city") or "",
                        "country": row.get("country") or "",
                        "skills": list(row.get("skills") or []),
                        "made_in_cuba": bool(row.get("made_in_cuba")),
                        "availability_status": row.get("availability_status") or "",
                    },
                }
            ]
        )
        stamped_at = datetime.now(timezone.utc).isoformat()
        client.table(OFFERS_TABLE).update(
            {"search_indexed_at": stamped_at}
        ).eq("id", offer_id).execute()
        logger.info("Offer indexed", offer_id=offer_id, vector_id=vector_id)
        return {
            "offer_id": offer_id,
            "success": True,
            "vector_id": vector_id,
            "message": "Offer indexed successfully",
        }
    except Exception as exc:  # noqa: BLE001
        logger.error("Offer indexing failed", offer_id=offer_id, error=str(exc))
        return {"offer_id": offer_id, "success": False, "message": str(exc)}


async def index_unindexed_offers(
    limit: int = 50, dry_run: bool = False, supabase=None, pinecone_index=None
) -> dict:
    """Index every published offer whose `search_indexed_at` is NULL."""
    client = await _get_client(supabase)
    result = (
        client.table(OFFERS_TABLE)
        .select("id")
        .eq("status", "published")
        .is_("search_indexed_at", "null")
        .limit(limit)
        .execute()
    )
    rows = result.data or []
    total = len(rows)
    if dry_run:
        return {"dry_run": True, "total": total, "succeeded": 0, "failed": 0}
    succeeded = 0
    failed = 0
    errors: list = []
    for row in rows:
        outcome = await index_offer(
            row["id"], supabase=supabase, pinecone_index=pinecone_index
        )
        if outcome["success"]:
            succeeded += 1
        else:
            failed += 1
            errors.append({"offer_id": row["id"], "error": outcome["message"]})
    return {
        "total": total,
        "succeeded": succeeded,
        "failed": failed,
        "errors": errors,
    }
