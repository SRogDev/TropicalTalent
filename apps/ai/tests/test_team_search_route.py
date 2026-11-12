"""RED tests — Phase 3 Team Search re-enable.

POST /api/team-search must be mounted again, behind the same JWT auth
as the agent routes (unauthenticated -> 401), streaming the LangGraph
team-search events. The graph itself is stubbed here; its nodes are
covered by the existing team-search unit tests.
"""

from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage

from app.dependencies.auth import get_current_user
from app.main import app


class _FakeTeamGraph:
    def get_state(self, config):
        class _Snap:
            values = {}

        return _Snap()

    async def ainvoke(self, input_state, config=None):
        return {
            "status": "clarifying",
            "messages": [
                AIMessage(content="Which roles do you need on the team?")
            ],
            "selected_team": [],
            "search_results": {},
            "project_name": "",
            "project_id": None,
            "invitations_sent": [],
        }


def test_team_search_route_is_mounted():
    paths = [getattr(r, "path", "") for r in app.routes]
    assert "/api/team-search" in paths


def test_team_search_requires_auth():
    with TestClient(app) as client:
        resp = client.post(
            "/api/team-search", json={"message": "build me a team"}
        )
    assert resp.status_code == 401


def test_team_search_streams_clarification(monkeypatch):
    import app.routes.team_search as team_search_route

    monkeypatch.setattr(
        team_search_route, "get_team_search_graph",
        lambda: _FakeTeamGraph(),
    )
    monkeypatch.setattr(
        team_search_route, "_create_or_get_conversation",
        lambda user_id, conversation_id, title: "conv-team-1",
    )
    monkeypatch.setattr(
        team_search_route, "_save_message", lambda *a, **k: None
    )
    app.dependency_overrides[get_current_user] = lambda: {"sub": "user-1"}
    try:
        with TestClient(app) as client:
            resp = client.post(
                "/api/team-search",
                json={"message": "I need a photographer and an editor"},
            )
        assert resp.status_code == 200
        body = resp.text
        assert "team_question" in body
        assert "Which roles do you need" in body
        assert "conv-team-1" in body
        assert '"done"' in body
    finally:
        app.dependency_overrides.pop(get_current_user, None)
