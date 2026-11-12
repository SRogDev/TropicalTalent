"""Phase 3 discovery SSE events — the O12 structured-streaming contract.

Wire shape (see docs/architecture/ai-orchestration.md §2): one SSE line
per event, ``data: {"type": ..., "content": ...}\\n\\n``. The client
parses each line independently; unknown types are ignored, never fatal.

Event types (v1, stable):
  conversation_id  — {conversation_id} first event when a conversation
                     exists; the client sends it back on the next turn
  message          — a chunk of plain assistant text (concatenate in order)
  clarification    — {questions: [str], partial_offers: [OfferCard]}
  offers           — {offers: [OfferCard], query: str, partial: bool}
  sourcing_request — {id, status, query} (status is "open" on creation)
  profiles         — legacy passthrough from the AgentExecutor node
  search_log       — legacy passthrough ({log_id})
  error            — {message}; the stream still ends with done
  done             — content "end"; always the last event

An OfferCard is the web `Offer` JSON (camelCase, see
apps/web/modules/catalog/types.ts) for a row that exists in
`tropical_offers`. Events never carry invented supply: offers come
from the database only.
"""

from __future__ import annotations

import json
from typing import Any

EVENT_TYPES = frozenset(
    {
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
)


def message_event(text: str) -> dict:
    """One chunk of plain assistant text."""
    return {"type": "message", "content": text}


def clarification_event(
    questions: list, partial_offers: list | None = None
) -> dict:
    """Targeted questions, plus any preliminary matches found so far."""
    return {
        "type": "clarification",
        "content": {
            "questions": list(questions),
            "partial_offers": list(partial_offers or []),
        },
    }


def offers_event(offers: list, query: str, partial: bool = False) -> dict:
    """Inline offer cards for the conversation."""
    return {
        "type": "offers",
        "content": {
            "offers": list(offers),
            "query": query,
            "partial": bool(partial),
        },
    }


def sourcing_request_event(sourcing_request: dict) -> dict:
    """A sourcing request was created for a no-results turn."""
    return {
        "type": "sourcing_request",
        "content": {
            "id": sourcing_request.get("id"),
            "status": sourcing_request.get("status"),
            "query": sourcing_request.get("query"),
        },
    }


def error_event(message: str) -> dict:
    """A recoverable failure; the stream still ends with done."""
    return {"type": "error", "content": {"message": message}}


def done_event() -> dict:
    """Always the last event of a turn."""
    return {"type": "done", "content": "end"}


def format_sse(event: dict) -> str:
    """Serialize one event dict to a single SSE `data:` line."""
    return f"data: {json.dumps(event)}\n\n"


def parse_sse_line(line: str) -> dict | None:
    """Parse one SSE line back to an event dict.

    Returns None for heartbeats, blank lines, malformed JSON, and
    unknown event types — the client skips those, never crashes.
    """
    line = line.strip()
    if not line.startswith("data:"):
        return None
    try:
        payload = json.loads(line[len("data:"):].strip())
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(payload, dict) or payload.get("type") not in EVENT_TYPES:
        return None
    return payload
