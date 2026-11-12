"""RED tests — Phase 3 offer-level Pinecone indexing.

Offers are vectorized with the same embedding service as profiles and
upserted as `offer-<id>` vectors with `record_type: "offer"` metadata.
Indexing stamps `search_indexed_at` on the offer row; drafts are never
indexed (they must not surface in buyer search).
"""

import pytest

from tests.fakes import FakeSupabase
from test_offer_search import OFFER_ROW, DRAFT_ROW


class _FakeIndex:
    def __init__(self):
        self.upserted = []

    def upsert(self, vectors):
        self.upserted.extend(vectors)
        return {"upserted_count": len(vectors)}


@pytest.mark.asyncio
async def test_offer_to_text_uses_provider_supplied_fields_only():
    from app.services.offer_indexing import offer_to_text

    text = offer_to_text(OFFER_ROW)
    assert "Cuban coffee" in text
    assert "Santiago de Cuba" in text
    assert "coffee" in text
    # Never invents availability/export/delivery claims.
    assert "export" not in text.lower()
    assert "guaranteed" not in text.lower()


@pytest.mark.asyncio
async def test_index_offer_upserts_offer_vector_and_stamps_row(monkeypatch):
    from app.services import offer_indexing

    async def _fake_embedding(text):
        return [0.1] * 8

    monkeypatch.setattr(offer_indexing, "generate_embedding", _fake_embedding)
    fake_db = FakeSupabase({"tropical_offers": [dict(OFFER_ROW)]})
    index = _FakeIndex()
    result = await offer_indexing.index_offer(
        "offer-1", supabase=fake_db, pinecone_index=index
    )
    assert result["success"] is True
    assert result["vector_id"] == "offer-offer-1"
    assert len(index.upserted) == 1
    vector = index.upserted[0]
    assert vector["id"] == "offer-offer-1"
    assert vector["metadata"]["record_type"] == "offer"
    assert vector["metadata"]["offer_id"] == "offer-1"
    assert vector["metadata"]["category"] == "products"
    assert fake_db.store["tropical_offers"][0]["search_indexed_at"] is not None


@pytest.mark.asyncio
async def test_index_offer_skips_drafts(monkeypatch):
    from app.services import offer_indexing

    async def _fake_embedding(text):
        return [0.1] * 8

    monkeypatch.setattr(offer_indexing, "generate_embedding", _fake_embedding)
    fake_db = FakeSupabase({"tropical_offers": [dict(DRAFT_ROW)]})
    index = _FakeIndex()
    result = await offer_indexing.index_offer(
        "offer-2", supabase=fake_db, pinecone_index=index
    )
    assert result["success"] is False
    assert "draft" in result["message"].lower()
    assert index.upserted == []


@pytest.mark.asyncio
async def test_index_offer_missing_offer_fails_cleanly():
    from app.services import offer_indexing

    fake_db = FakeSupabase({"tropical_offers": []})
    result = await offer_indexing.index_offer(
        "nope", supabase=fake_db, pinecone_index=_FakeIndex()
    )
    assert result["success"] is False


@pytest.mark.asyncio
async def test_index_unindexed_offers_only_picks_unstamped(monkeypatch):
    from app.services import offer_indexing

    async def _fake_embedding(text):
        return [0.1] * 8

    monkeypatch.setattr(offer_indexing, "generate_embedding", _fake_embedding)
    already = dict(OFFER_ROW, id="offer-9",
                   search_indexed_at="2026-11-11T00:00:00+00:00")
    pending = dict(OFFER_ROW, id="offer-10", search_indexed_at=None)
    fake_db = FakeSupabase({"tropical_offers": [already, pending]})
    index = _FakeIndex()
    summary = await offer_indexing.index_unindexed_offers(
        limit=10, supabase=fake_db, pinecone_index=index
    )
    assert summary["total"] == 1
    assert summary["succeeded"] == 1
    assert [v["id"] for v in index.upserted] == ["offer-offer-10"]
