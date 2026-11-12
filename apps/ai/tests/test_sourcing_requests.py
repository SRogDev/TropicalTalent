"""RED tests — Phase 3 sourcing requests + pending-notification stub.

A no-results discovery turn creates a structured sourcing request
(status open) and records a PENDING notification. Delivery is a stub:
nothing is ever sent (no email/push) — the row just waits for the
Phase 4 notification path.
"""

import pytest

from tests.fakes import FakeSupabase


@pytest.mark.asyncio
async def test_create_sourcing_request_stores_structured_requirements():
    from app.services.sourcing_requests import create_sourcing_request

    fake = FakeSupabase()
    req = {"category": "products", "terms": ["coffee"], "location": None,
           "passion": None, "raw_query": "Cuban coffee"}
    row = await create_sourcing_request(
        user_id="user-1",
        query="Cuban coffee",
        requirements=req,
        conversation_id="conv-1",
        supabase=fake,
    )
    assert row["status"] == "open"
    assert row["user_id"] == "user-1"
    assert row["requirements"]["category"] == "products"
    assert row["requirements"]["query"] == "Cuban coffee"
    assert row["conversation_id"] == "conv-1"
    stored = fake.store["tropical_sourcing_requests"]
    assert len(stored) == 1


@pytest.mark.asyncio
async def test_create_sourcing_request_rejects_empty_query():
    from app.services.sourcing_requests import create_sourcing_request

    fake = FakeSupabase()
    with pytest.raises(ValueError):
        await create_sourcing_request(
            user_id="user-1", query="  ", requirements={}, supabase=fake
        )


@pytest.mark.asyncio
async def test_record_pending_notification_is_a_stub_row_not_a_send():
    from app.services.sourcing_requests import (
        create_sourcing_request,
        record_pending_notification,
    )

    fake = FakeSupabase()
    row = await create_sourcing_request(
        user_id="user-1",
        query="rare cacao",
        requirements={"category": "products", "terms": ["cacao"]},
        supabase=fake,
    )
    note = await record_pending_notification(
        sourcing_request_id=row["id"], user_id="user-1", supabase=fake
    )
    assert note["status"] == "pending"
    assert note["sourcing_request_id"] == row["id"]
    # The stub records; it never claims delivery.
    assert note.get("sent_at") is None
    assert len(fake.store["tropical_sourcing_notifications"]) == 1


@pytest.mark.asyncio
async def test_get_sourcing_request_returns_row_or_none():
    from app.services.sourcing_requests import (
        create_sourcing_request,
        get_sourcing_request,
    )

    fake = FakeSupabase()
    row = await create_sourcing_request(
        user_id="user-1", query="honey", requirements={}, supabase=fake
    )
    found = await get_sourcing_request(row["id"], supabase=fake)
    assert found is not None and found["id"] == row["id"]
    assert await get_sourcing_request("missing-id", supabase=fake) is None
