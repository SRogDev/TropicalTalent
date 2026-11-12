"""RED tests — Phase 3 discovery LangGraph (AgentExecutor migration).

The graph is the orchestrator; Gemini stays the provider behind the
nodes. Nodes/transitions under test (with all LLM + DB calls stubbed):

  understand -> decide -> search_offers -> present -> respond -> END
  understand -> decide -> clarify -> respond -> END
  understand -> decide -> search_offers -> sourcing -> respond -> END
  understand -> legacy_agent (greetings / compare / named person) -> END

The AgentExecutor survives only inside the legacy_agent node.
"""

import pytest
from langchain_core.messages import HumanMessage

from app.services.discovery_graph import get_discovery_graph


@pytest.fixture(autouse=True)
def _stub_llm_intent(monkeypatch):
    """No graph test may call real Gemini.

    The understand node treats intent extraction as best-effort; the
    stub fails fast so local extraction alone drives the decision.
    Individual tests override this with their own stub when needed.
    """
    from app.services import discovery_graph

    async def _failing_intent(query):
        raise RuntimeError("gemini down")

    monkeypatch.setattr(discovery_graph, "extract_search_intent", _failing_intent)

OFFER_CARD = {
    "id": "offer-1", "category": "products", "title": "Cuban coffee",
    "description": "Arabica.", "skills": ["coffee"], "languages": ["es"],
    "city": "Santiago de Cuba", "country": "Cuba",
    "availabilityStatus": "available", "quantityAvailable": 500,
    "quantityUnit": "kg", "productionCapacity": None,
    "pricingBasis": "unit", "priceAmount": 12.5, "priceCurrency": "USD",
    "originCountry": "Cuba", "originVerified": True, "madeInCuba": True,
    "verificationStatus": "verified",
    "provider": {"displayName": "Café Sierra", "verificationStatus": "verified"},
}


def _initial_state(query, user_id="user-1"):
    return {
        "messages": [HumanMessage(content=query)],
        "user_id": user_id,
        "conversation_id": "conv-1",
        "query": query,
        "requirements": {},
        "clarification_count": 0,
        "clarification_questions": [],
        "offers": [],
        "partial_offers": [],
        "sourcing_request": None,
        "legacy_events": [],
        "events": [],
        "reply_text": "",
        "route": "",
        "status": "",
        "error_message": None,
        "tools_used": [],
        "search_log_id": None,
    }


def _event_types(state):
    return [e["type"] for e in state.get("events", [])]


@pytest.mark.asyncio
async def test_graph_compiles_and_has_expected_nodes():
    graph = get_discovery_graph()
    nodes = set(graph.nodes.keys())
    assert {
        "understand", "clarify", "search_offers", "present",
        "sourcing", "legacy_agent", "respond",
    } <= nodes


@pytest.mark.asyncio
async def test_search_turn_emits_message_then_offers_then_done(monkeypatch):
    from app.services import discovery_graph

    async def fake_search(query, requirements, user_id, limit=6, **_k):
        return [OFFER_CARD]

    monkeypatch.setattr(discovery_graph, "search_offers", fake_search)
    monkeypatch.setattr(
        discovery_graph, "extract_search_intent",
        _failing_intent,
    )
    graph = get_discovery_graph()
    state = await graph.ainvoke(
        _initial_state("I need Cuban coffee"),
        {"configurable": {"thread_id": "t-search"}},
    )
    assert state["route"] == "discovery"
    assert state["offers"] == [OFFER_CARD]
    types = _event_types(state)
    assert types[0] == "message"
    assert "offers" in types
    assert types[-1] == "done"


async def _failing_intent(query):
    raise RuntimeError("gemini down")


@pytest.mark.asyncio
async def test_vague_turn_clarifies_and_shows_partial_results(monkeypatch):
    from app.services import discovery_graph

    async def fake_search(query, requirements, user_id, limit=6, **_k):
        return [OFFER_CARD]

    monkeypatch.setattr(discovery_graph, "search_offers", fake_search)
    monkeypatch.setattr(discovery_graph, "extract_search_intent", _failing_intent)
    graph = get_discovery_graph()
    state = await graph.ainvoke(
        _initial_state("I need something"),
        {"configurable": {"thread_id": "t-clarify"}},
    )
    assert state["route"] == "discovery"
    assert state["clarification_questions"], "expected clarification questions"
    assert len(state["clarification_questions"]) <= 2
    types = _event_types(state)
    assert "clarification" in types
    # Partial results ride along with the clarification (plan §4: show
    # preliminary matches while collecting missing information).
    assert "offers" in types
    assert types[-1] == "done"


@pytest.mark.asyncio
async def test_no_results_turn_creates_sourcing_request(monkeypatch):
    from app.services import discovery_graph

    async def fake_search(query, requirements, user_id, limit=6, **_k):
        return []

    created = {}

    async def fake_create(user_id, query, requirements, conversation_id=None, **_k):
        created["called"] = True
        return {"id": "sr-1", "status": "open", "query": query}

    async def fake_notify(sourcing_request_id, user_id, **_k):
        created["notified"] = True
        return {"status": "pending", "sourcing_request_id": sourcing_request_id}

    monkeypatch.setattr(discovery_graph, "search_offers", fake_search)
    monkeypatch.setattr(discovery_graph, "create_sourcing_request", fake_create)
    monkeypatch.setattr(discovery_graph, "record_pending_notification", fake_notify)
    monkeypatch.setattr(discovery_graph, "extract_search_intent", _failing_intent)
    graph = get_discovery_graph()
    state = await graph.ainvoke(
        _initial_state("I need unobtainium ore by the tonne"),
        {"configurable": {"thread_id": "t-sourcing"}},
    )
    assert created.get("called") is True
    assert created.get("notified") is True
    assert state["sourcing_request"] is not None
    assert state["sourcing_request"]["status"] == "open"
    assert "sourcing_request" in _event_types(state)
    assert _event_types(state)[-1] == "done"


@pytest.mark.asyncio
async def test_greeting_routes_to_legacy_agent_executor(monkeypatch):
    from app.services import discovery_graph

    async def fake_legacy(user_id, message, chat_history=None, entity_context=""):
        yield {"type": "message", "content": "Hello! I can help you find talent."}
        yield {"type": "done", "content": "end"}

    monkeypatch.setattr(discovery_graph, "run_agent_streaming", fake_legacy)
    graph = get_discovery_graph()
    state = await graph.ainvoke(
        _initial_state("hello"),
        {"configurable": {"thread_id": "t-legacy"}},
    )
    assert state["route"] == "legacy"
    assert any(
        e["type"] == "message" and "Hello" in str(e["content"])
        for e in state["events"]
    )


@pytest.mark.asyncio
async def test_second_clarification_round_searches_anyway(monkeypatch):
    """After 2 clarification rounds the graph searches with what it has —
    it must not interrogate the user forever."""
    from app.services import discovery_graph

    async def fake_search(query, requirements, user_id, limit=6, **_k):
        return []

    async def fake_create(user_id, query, requirements, conversation_id=None, **_k):
        return {"id": "sr-2", "status": "open", "query": query}

    async def fake_notify(sourcing_request_id, user_id, **_k):
        return {"status": "pending", "sourcing_request_id": sourcing_request_id}

    monkeypatch.setattr(discovery_graph, "search_offers", fake_search)
    monkeypatch.setattr(discovery_graph, "create_sourcing_request", fake_create)
    monkeypatch.setattr(discovery_graph, "record_pending_notification", fake_notify)
    monkeypatch.setattr(discovery_graph, "extract_search_intent", _failing_intent)
    graph = get_discovery_graph()
    initial = _initial_state("I need something")
    initial["clarification_count"] = 2
    state = await graph.ainvoke(
        initial, {"configurable": {"thread_id": "t-rounds"}},
    )
    assert state["clarification_questions"] == []
    assert state["sourcing_request"] is not None
