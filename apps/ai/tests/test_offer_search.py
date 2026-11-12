"""RED tests — Phase 3 offer search (structured + semantic).

Semantic search must be able to return OFFER cards, not only talent
profiles. The search only ever returns rows that exist in
`tropical_offers` — it never invents supply. When Pinecone is
unavailable it degrades to structured SQL search, never to an error.
"""

import pytest

from tests.fakes import FakeSupabase


@pytest.fixture(autouse=True)
def _stub_semantic_seam(monkeypatch):
    """Structured-search tests must never touch the network.

    The semantic stage resolves the real embedding model + Pinecone
    index lazily; without these stubs a structured test would call
    Gemini/Pinecone with test keys and hang on the sandbox egress.
    Tests that exercise the semantic stage pass an explicit fake index
    (and their own embedding stub) instead.
    """
    from app.services import offer_search

    async def _fake_embedding(text):
        return [0.1] * 8

    monkeypatch.setattr(offer_search, "generate_embedding", _fake_embedding)
    monkeypatch.setattr(
        "app.core.pinecone_client.get_pinecone_index",
        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no pinecone in tests")),
    )

OFFER_ROW = {
    "id": "offer-1",
    "provider_id": "prov-1",
    "category": "products",
    "status": "published",
    "title": "Cuban coffee",
    "description": "Arabica, 500 kg/month.",
    "skills": ["coffee", "agriculture"],
    "languages": ["es", "en"],
    "city": "Santiago de Cuba",
    "country": "Cuba",
    "availability_status": "available",
    "quantity_available": 500,
    "quantity_unit": "kg",
    "production_capacity": {"monthly_amount": 500, "unit": "kg"},
    "pricing_basis": "unit",
    "price_amount": 12.5,
    "price_currency": "USD",
    "origin_country": "Cuba",
    "origin_verified": True,
    "made_in_cuba": True,
    "verification_status": "verified",
    "attributes": {},
    "search_indexed_at": "2026-11-11T00:00:00+00:00",
    "created_at": "2026-11-11T00:00:00+00:00",
    "updated_at": "2026-11-11T00:00:00+00:00",
    "provider": {"display_name": "Café Sierra", "verification_status": "verified",
                 "kind": "business", "city": "Santiago de Cuba",
                 "country": "Cuba", "languages": ["es"]},
}

DRAFT_ROW = dict(OFFER_ROW, id="offer-2", status="draft", title="Draft honey")


def _store():
    return {"tropical_offers": [dict(OFFER_ROW), dict(DRAFT_ROW)]}


def test_offer_row_to_card_maps_to_web_offer_shape():
    from app.services.offer_search import offer_row_to_card

    card = offer_row_to_card(OFFER_ROW)
    # CamelCase keys match apps/web modules/catalog/types.ts Offer.
    assert card["id"] == "offer-1"
    assert card["category"] == "products"
    assert card["madeInCuba"] is True
    assert card["availabilityStatus"] == "available"
    assert card["priceAmount"] == 12.5
    assert card["provider"]["displayName"] == "Café Sierra"


@pytest.mark.asyncio
async def test_structured_search_returns_only_published():
    from app.services.offer_search import search_offers

    results = await search_offers(
        "coffee", {"category": "products", "terms": ["coffee"]},
        user_id="user-1", supabase=FakeSupabase(_store()),
    )
    ids = [r["id"] for r in results]
    assert "offer-1" in ids
    assert "offer-2" not in ids  # draft must never surface


@pytest.mark.asyncio
async def test_structured_search_empty_when_nothing_matches():
    from app.services.offer_search import search_offers

    results = await search_offers(
        "unobtainium", {"category": "talent", "terms": ["unobtainium"]},
        user_id="user-1", supabase=FakeSupabase(_store()),
    )
    assert results == []


@pytest.mark.asyncio
async def test_search_degrades_when_supabase_fails():
    from app.services.offer_search import search_offers

    class Broken:
        _client = None

        def table(self, *_a, **_k):
            raise RuntimeError("db down")

    # A broken DB must degrade to an empty list, never raise into the agent.
    assert await search_offers("coffee", {}, user_id="u", supabase=Broken()) == []


class _FakeMatch:
    def __init__(self, match_id, score):
        self.id = match_id
        self.score = score
        self.metadata = {"offer_id": match_id.removeprefix("offer-")}


class _FakePineconeQuery:
    def __init__(self, matches):
        self.matches = matches


class _FakeIndex:
    def __init__(self, matches):
        self._matches = matches
        self.queries = []

    def query(self, **kwargs):
        self.queries.append(kwargs)
        return _FakePineconeQuery(self._matches)


@pytest.mark.asyncio
async def test_semantic_search_returns_offer_cards_from_pinecone_ids(monkeypatch):
    from app.services import offer_search

    async def _fake_embedding(text):
        return [0.1] * 8

    monkeypatch.setattr(offer_search, "generate_embedding", _fake_embedding)
    fake_index = _FakeIndex([_FakeMatch("offer-offer-1", 0.9)])
    results = await offer_search.search_offers(
        "coffee", {"category": "products", "terms": ["coffee"]},
        user_id="user-1",
        supabase=FakeSupabase(_store()),
        pinecone_index=fake_index,
    )
    ids = [r["id"] for r in results]
    assert "offer-1" in ids
    # Pinecone was asked for offer vectors only.
    assert fake_index.queries[0]["filter"] == {"record_type": {"$eq": "offer"}}


@pytest.mark.asyncio
async def test_semantic_failure_falls_back_to_structured(monkeypatch):
    from app.services import offer_search

    async def _broken_embedding(text):
        raise RuntimeError("embedding down")

    monkeypatch.setattr(offer_search, "generate_embedding", _broken_embedding)

    class ExplodingIndex:
        def query(self, **_k):
            raise RuntimeError("pinecone down")

    results = await offer_search.search_offers(
        "coffee", {"category": "products", "terms": ["coffee"]},
        user_id="user-1",
        supabase=FakeSupabase(_store()),
        pinecone_index=ExplodingIndex(),
    )
    assert [r["id"] for r in results] == ["offer-1"]
