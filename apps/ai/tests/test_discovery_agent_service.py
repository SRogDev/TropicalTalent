"""RED tests — Phase 3 agent_service wiring through the discovery graph.

POST /api/agent must stream the graph's structured events (message,
offers, sourcing_request, done) as SSE lines, and still persist the
turn to conversation memory. The AgentExecutor is reached only via the
graph's legacy node — never directly from the service.
"""

import json

import pytest
from langchain_core.messages import HumanMessage

from app.models.agent import AgentRequest


class _FakeMemory:
    def __init__(self, *args, **kwargs):
        self.saved = []

    async def load_conversation_context(self):
        return None, []

    def add_user_message(self, msg):
        pass

    def add_ai_message(self, msg):
        pass

    async def save_message(self, role, content, **kwargs):
        self.saved.append((role, content))

    def should_summarize(self):
        return False


class _FakeEntities:
    def __init__(self, *args, **kwargs):
        pass

    async def load_entities(self):
        return {}

    def format_for_prompt(self):
        return ""

    async def extract_and_save_entities(self, *args):
        pass


class _FakeGraph:
    """Stand-in for the compiled discovery graph."""

    def __init__(self, final_state):
        self.final_state = final_state
        self.seen_configs = []
        self.seen_inputs = []

    def get_state(self, config):
        self.seen_configs.append(config)

        class _Snap:
            values = {}

        return _Snap()

    async def ainvoke(self, input_state, config=None):
        self.seen_inputs.append(input_state)
        return self.final_state


def _lines(chunks):
    out = []
    for chunk in chunks:
        assert chunk.startswith("data: ")
        out.append(json.loads(chunk[len("data: "):].strip()))
    return out


@pytest.mark.asyncio
async def test_stream_agent_response_streams_graph_events(monkeypatch):
    from app.services import agent_service

    monkeypatch.setattr(
        agent_service, "_create_new_conversation",
        _fake_create_conversation,
    )
    monkeypatch.setattr(agent_service, "AgentMemoryManager", _FakeMemory)
    monkeypatch.setattr(agent_service, "EntityMemoryManager", _FakeEntities)
    final_state = {
        "events": [
            {"type": "message", "content": "Here is what I found."},
            {"type": "offers", "content": {"offers": [{"id": "offer-1"}], "query": "coffee", "partial": False}},
            {"type": "done", "content": "end"},
        ],
        "reply_text": "Here is what I found.",
        "tools_used": ["search_offers"],
        "search_log_id": None,
        "offers": [{"id": "offer-1"}],
    }
    fake_graph = _FakeGraph(final_state)
    monkeypatch.setattr(
        agent_service, "get_discovery_graph", lambda: fake_graph
    )

    chunks = [
        chunk
        async for chunk in agent_service.stream_agent_response(
            AgentRequest(message="I need Cuban coffee"), user_id="user-1"
        )
    ]
    events = _lines(chunks)
    assert [e["type"] for e in events] == [
        "conversation_id",
        "message",
        "offers",
        "done",
    ]
    assert events[0]["content"] == "conv-1"
    assert events[2]["content"]["offers"] == [{"id": "offer-1"}]
    # The graph was invoked with the user's message.
    assert fake_graph.seen_inputs[0]["query"] == "I need Cuban coffee"


async def _fake_create_conversation(user_id, first_message):
    return "conv-1"


@pytest.mark.asyncio
async def test_stream_agent_response_resumes_existing_conversation(monkeypatch):
    """A second turn on the same conversation resumes the graph thread
    instead of starting a fresh one (thread_id = conversation_id)."""
    from app.services import agent_service

    monkeypatch.setattr(agent_service, "AgentMemoryManager", _FakeMemory)
    monkeypatch.setattr(agent_service, "EntityMemoryManager", _FakeEntities)
    final_state = {
        "events": [{"type": "message", "content": "ok"}, {"type": "done", "content": "end"}],
        "reply_text": "ok",
        "tools_used": [],
        "search_log_id": None,
        "offers": [],
    }
    fake_graph = _FakeGraph(final_state)

    class _SnapWithValues:
        values = {"messages": [HumanMessage(content="earlier")]}

    fake_graph.get_state = lambda config: _SnapWithValues()
    monkeypatch.setattr(
        agent_service, "get_discovery_graph", lambda: fake_graph
    )

    chunks = [
        chunk
        async for chunk in agent_service.stream_agent_response(
            AgentRequest(message="and in Havana", conversation_id="conv-9"),
            user_id="user-1",
        )
    ]
    events = _lines(chunks)
    assert events[0] == {"type": "conversation_id", "content": "conv-9"}
    assert events[-1]["type"] == "done"
    # Resume input carries only the new message, not a fresh full state.
    assert fake_graph.seen_inputs[0]["query"] == "and in Havana"
    assert "requirements" not in fake_graph.seen_inputs[0]
