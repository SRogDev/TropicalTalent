"""Phase 3 offer search — semantic search returns OFFER cards.

Two stages, both reading only rows that exist in `tropical_offers`:
  1. Semantic: embed the query, ask Pinecone for vectors with
     `record_type == "offer"` (written by `offer_indexing`), hydrate the
     matching offer ids from Supabase.
  2. Structured: a Supabase query on published offers (category, skills
     overlap, city), the same filters the /catalog page uses.

Either stage failing degrades to the other; both failing returns []
instead of raising — a search backend must never take the agent turn
down with it, and must never fabricate a result to fill the gap.
"""

from __future__ import annotations

from typing import Optional

from app.core.logging import get_logger
from app.services.embedding_service import generate_embedding

logger = get_logger("services.offer_search")

OFFERS_TABLE = "tropical_offers"
OFFER_VECTOR_PREFIX = "offer-"

_OFFER_SELECT = (
    "id, provider_id, category, status, title, description, "
    "skills, languages, city, country, availability_status, "
    "quantity_available, quantity_unit, production_capacity, "
    "pricing_basis, price_amount, price_currency, "
    "origin_country, origin_verified, made_in_cuba, verification_status, "
    "attributes, search_indexed_at, created_at, updated_at, "
    "provider:tropical_providers(display_name, kind, city, country, "
    "languages, verification_status)"
)


def offer_row_to_card(row: dict) -> dict:
    """Map one `tropical_offers` row to the web `Offer` JSON (camelCase).

    Only provider-stated fields are copied. Nothing is inferred: a
    missing price stays null (price on request), a missing quantity
    stays null (quantity on request).
    """
    provider = row.get("provider") or {}
    if isinstance(provider, list):
        provider = provider[0] if provider else {}
    return {
        "id": row.get("id"),
        "providerId": row.get("provider_id"),
        "category": row.get("category"),
        "status": row.get("status"),
        "title": row.get("title"),
        "description": row.get("description") or "",
        "skills": list(row.get("skills") or []),
        "languages": list(row.get("languages") or []),
        "city": row.get("city"),
        "country": row.get("country"),
        "availabilityStatus": row.get("availability_status"),
        "quantityAvailable": row.get("quantity_available"),
        "quantityUnit": row.get("quantity_unit"),
        "productionCapacity": row.get("production_capacity"),
        "pricingBasis": row.get("pricing_basis"),
        "priceAmount": row.get("price_amount"),
        "priceCurrency": row.get("price_currency") or "USD",
        "originCountry": row.get("origin_country"),
        "originVerified": bool(row.get("origin_verified")),
        "madeInCuba": bool(row.get("made_in_cuba")),
        "verificationStatus": row.get("verification_status"),
        "attributes": row.get("attributes") or {},
        "searchIndexedAt": row.get("search_indexed_at"),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
        "provider": {
            "displayName": provider.get("display_name"),
            "kind": provider.get("kind"),
            "city": provider.get("city"),
            "country": provider.get("country"),
            "languages": list(provider.get("languages") or []),
            "verificationStatus": provider.get("verification_status"),
        }
        if provider
        else None,
    }


def _structured_query(client, requirements: dict, limit: int):
    query = (
        client.table(OFFERS_TABLE)
        .select(_OFFER_SELECT)
        .eq("status", "published")
        .order("created_at", desc=True)
        .limit(limit)
    )
    category = (requirements or {}).get("category")
    if category:
        query = query.eq("category", category)
    terms = (requirements or {}).get("terms") or []
    if terms:
        query = query.overlaps("skills", terms)
    location = (requirements or {}).get("location")
    if location:
        query = query.ilike("city", f"%{location}%")
    return query


async def _structured_search(client, requirements: dict, limit: int) -> list:
    try:
        result = _structured_query(client, requirements, limit).execute()
        return [offer_row_to_card(r) for r in (result.data or [])]
    except Exception as exc:  # noqa: BLE001 — degrade, never raise
        logger.warning("Structured offer search failed", error=str(exc))
        return []


async def _semantic_search(
    client, query_text: str, limit: int, pinecone_index=None
) -> list:
    """Pinecone offer vectors -> hydrated offer cards (may be empty)."""
    try:
        embedding = await generate_embedding(query_text)
        if not embedding:
            return []
        index = pinecone_index
        if index is None:
            from app.core.pinecone_client import get_pinecone_index  # noqa: PLC0415

            index = get_pinecone_index()
        results = index.query(
            vector=embedding,
            top_k=limit,
            include_metadata=True,
            filter={"record_type": {"$eq": "offer"}},
        )
        offer_ids = []
        for match in results.matches or []:
            meta = getattr(match, "metadata", None) or {}
            offer_id = meta.get("offer_id")
            if offer_id and offer_id not in offer_ids:
                offer_ids.append(offer_id)
        if not offer_ids:
            return []
        hydrated = (
            client.table(OFFERS_TABLE)
            .select(_OFFER_SELECT)
            .eq("status", "published")
            .in_("id", offer_ids)
            .execute()
        )
        by_id = {r["id"]: r for r in (hydrated.data or [])}
        return [offer_row_to_card(by_id[i]) for i in offer_ids if i in by_id]
    except Exception as exc:  # noqa: BLE001 — degrade, never raise
        logger.warning("Semantic offer search failed", error=str(exc))
        return []


async def search_offers(
    query: str,
    requirements: dict | None = None,
    user_id: Optional[str] = None,
    limit: int = 6,
    supabase=None,
    pinecone_index=None,
) -> list:
    """Search offers for a discovery turn.

    `pinecone_index` is injectable for tests; when None, the semantic
    stage resolves the real index lazily inside `_semantic_search`.
    When an index object is passed, it is used directly.
    """
    requirements = requirements or {}
    if supabase is not None:
        client = supabase._client
    else:
        from app.core.database import get_supabase_client  # noqa: PLC0415

        client = (await get_supabase_client())._client

    cards: list = []
    seen: set = set()

    # Semantic first (best relevance), structured fills the remainder.
    for card in await _semantic_search(client, query, limit, pinecone_index):
        if card["id"] not in seen:
            seen.add(card["id"])
            cards.append(card)

    if len(cards) < limit:
        for card in await _structured_search(client, requirements, limit):
            if card["id"] not in seen:
                seen.add(card["id"])
                cards.append(card)
            if len(cards) >= limit:
                break

    return cards[:limit]
