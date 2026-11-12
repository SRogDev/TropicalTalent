"""RED tests — Phase 3 discovery SSE event schema (O12 contract).

The structured-streaming contract is defined in
docs/architecture/ai-orchestration.md. These tests pin the wire shape:
one SSE line per event, `data: {"type": ..., "content": ...}`.
"""

import json

import pytest

from app.services.discovery_events import (
    clarification_event,
    done_event,
    error_event,
    format_sse,
    message_event,
    offers_event,
    parse_sse_line,
    sourcing_request_event,
)

OFFER = {
    "id": "offer-1",
    "category": "products",
    "title": "Cuban coffee, 500 kg/month",
    "description": "Arabica from the Sierra Maestra.",
    "skills": [],
    "languages": ["es", "en"],
    "city": "Santiago de Cuba",
    "country": "Cuba",
    "availabilityStatus": "available",
    "quantityAvailable": 500,
    "quantityUnit": "kg",
    "productionCapacity": {"monthly_amount": 500, "unit": "kg"},
    "pricingBasis": "unit",
    "priceAmount": 12.5,
    "priceCurrency": "USD",
    "originCountry": "Cuba",
    "originVerified": True,
    "madeInCuba": True,
    "verificationStatus": "verified",
    "provider": {"displayName": "Café Sierra", "verificationStatus": "verified"},
}


def test_message_event_shape():
    event = message_event("Hello, buyer.")
    assert event["type"] == "message"
    assert event["content"] == "Hello, buyer."


def test_format_sse_round_trip():
    line = format_sse(message_event("hi"))
    assert line.startswith("data: ")
    assert line.endswith("\n\n")
    parsed = parse_sse_line(line)
    assert parsed == {"type": "message", "content": "hi"}


def test_parse_sse_line_rejects_non_data_lines():
    assert parse_sse_line("") is None
    assert parse_sse_line(": heartbeat") is None
    assert parse_sse_line("data: not-json") is None


def test_parse_sse_line_rejects_unknown_type():
    assert parse_sse_line('data: {"type": "teleport", "content": 1}\n\n') is None


def test_offers_event_carries_offer_cards():
    event = offers_event([OFFER], query="coffee", partial=False)
    assert event["type"] == "offers"
    assert event["content"]["offers"] == [OFFER]
    assert event["content"]["query"] == "coffee"
    assert event["content"]["partial"] is False


def test_clarification_event_carries_questions_and_partial_offers():
    event = clarification_event(
        ["Are you looking for talent, a service, or a product?"],
        partial_offers=[OFFER],
    )
    assert event["type"] == "clarification"
    assert len(event["content"]["questions"]) == 1
    assert event["content"]["partial_offers"] == [OFFER]


def test_clarification_event_without_partial_offers():
    event = clarification_event(["What do you need?"])
    assert event["content"]["partial_offers"] == []


def test_sourcing_request_event():
    req = {"id": "sr-1", "status": "open", "query": "rare cacao"}
    event = sourcing_request_event(req)
    assert event["type"] == "sourcing_request"
    assert event["content"]["id"] == "sr-1"
    assert event["content"]["status"] == "open"


def test_error_event_then_done_contract():
    assert error_event("boom")["type"] == "error"
    assert done_event()["type"] == "done"
    assert done_event()["content"] == "end"


def test_format_sse_accepts_plain_dicts():
    line = format_sse({"type": "done", "content": "end"})
    assert json.loads(line[len("data: "):].strip()) == {
        "type": "done",
        "content": "end",
    }


def test_event_types_are_stable_set():
    from app.services.discovery_events import EVENT_TYPES

    assert EVENT_TYPES == {
        "conversation_id",
        "message",
        "clarification",
        "offers",
        "sourcing_request",
        "profiles",
        "search_log",
        "error",
        "done",
    }
