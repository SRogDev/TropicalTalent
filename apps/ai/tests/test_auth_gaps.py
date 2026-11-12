"""
Auth-gap regression tests (Cubora Phase 5, apps/ai).

Covers the gaps from the Phase 0 audit (CUBORA_PHASE0_AUDIT.md §7.2):
  1a. GET /search — JWT auth required; user_id comes from the token, never
      from a caller-supplied query param.
  1b. GET /generate-feedback-insights and /generate-search-insights — auth
      required; no internal error details leaked to the client.
  1c. POST /api/vectorize — the user_id being vectorized must match the JWT
      subject (403 on mismatch).
  1d. POST /api/webhooks/vectorize — fail CLOSED when QStash signing keys
      are absent: unsigned requests are rejected in production and in dev
      unless the explicit QSTASH_ALLOW_UNSIGNED dev flag is set.
  1e. sentry_sdk.push_scope (deprecated in sentry-sdk 2.x, removed in the
      next major) is replaced by new_scope on the error paths.
  3.  Client-facing error details are generic; internals stay in logs.

These tests mint REAL HS256 JWTs (signed with the test SUPABASE_JWT_SECRET
from conftest) so they exercise the real get_current_user dependency.
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import status

from tests.fakes import FakeSupabase


def _search_response(user_id="test-user-123", query="Python developer"):
    from app.models.search import SearchResponse

    return SearchResponse(
        user_id=user_id,
        query=query,
        results=[],
        total_results=0,
        search_time_ms=1,
    )


@pytest.mark.integration
class TestSearchRequiresAuth:
    """1a — GET /search: JWT required, user_id from the token."""

    def test_search_without_auth_returns_401(self, client):
        # FastAPI's HTTPBearer answers 401 "Not authenticated" when no
        # credentials are presented.
        response = client.get(
            "/search", params={"query": "Python developer"}
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_search_with_auth_uses_token_subject_not_query_param(
        self, client, auth_headers
    ):
        """A caller-supplied user_id must be ignored; the token sub wins."""
        with patch(
            "app.routes.internals.search.search_users",
            new=AsyncMock(return_value=_search_response()),
        ) as mock_search:
            response = client.get(
                "/search",
                params={"user_id": "someone-else", "query": "Python developer"},
                headers=auth_headers,
            )

        assert response.status_code == status.HTTP_200_OK
        mock_search.assert_awaited_once()
        request = mock_search.call_args[0][0]
        assert request.user_id == "test-user-123"
        assert request.query == "Python developer"

    def test_search_error_returns_generic_detail(self, client, auth_headers):
        """A service failure is a generic 500 — no internals leaked."""
        with patch(
            "app.routes.internals.search.search_users",
            new=AsyncMock(side_effect=RuntimeError("pinecone exploded")),
        ):
            response = client.get(
                "/search",
                params={"query": "Python developer"},
                headers=auth_headers,
            )

        assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        assert response.json()["detail"] == "Search failed"
        assert "pinecone exploded" not in response.text


@pytest.mark.integration
class TestInsightsRequireAuth:
    """1b — the two insights endpoints: auth required, generic errors."""

    def test_feedback_insights_without_auth_returns_401(self, client):
        response = client.get("/generate-feedback-insights")
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_search_insights_without_auth_returns_401(self, client):
        response = client.get("/generate-search-insights")
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_feedback_insights_with_auth_and_no_feedback(
        self, client, auth_headers
    ):
        """Empty feedback table → the static no-feedback summary (no Gemini)."""
        fake = FakeSupabase({"feedback_messages": []})
        with patch("app.routes.feedback.create_client", return_value=fake):
            response = client.get(
                "/generate-feedback-insights", headers=auth_headers
            )

        assert response.status_code == status.HTTP_200_OK
        assert "No feedback received" in response.json()["summary"]

    def test_search_insights_with_auth_and_no_searches(
        self, client, auth_headers
    ):
        """Empty search_logs → the static empty-insights response (no Gemini)."""
        fake = FakeSupabase({"search_logs": []})
        with patch("app.routes.search_insights.create_client", return_value=fake):
            response = client.get(
                "/generate-search-insights", headers=auth_headers
            )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["high_demand_low_supply"] == []
        assert data["high_demand_high_supply"] == []

    def test_feedback_insights_error_returns_generic_detail(
        self, client, auth_headers
    ):
        """A Supabase failure is a generic 500 — the exception is not leaked."""
        with patch(
            "app.routes.feedback.create_client",
            side_effect=RuntimeError("supabase exploded"),
        ):
            response = client.get(
                "/generate-feedback-insights", headers=auth_headers
            )

        assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        assert response.json()["detail"] == "Failed to generate feedback insights"
        assert "supabase exploded" not in response.text


@pytest.mark.integration
class TestVectorizeOwnership:
    """1c — POST /api/vectorize: user_id must match the JWT subject."""

    def test_vectorize_for_other_user_returns_403(self, client, auth_headers):
        response = client.post(
            "/api/vectorize",
            headers=auth_headers,
            data={
                "user_id": "someone-else",
                "profile_json": json.dumps({"username": "victim"}),
            },
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "another user" in response.json()["detail"]

    def test_vectorize_for_self_succeeds(self, client, auth_headers, sample_profile_data):
        from app.models.vectorize import VectorizeProfileResponse

        result = VectorizeProfileResponse(
            user_id="test-user-123",
            vector_id="user-test-user-123",
            success=True,
            message="Profile vectorized successfully",
        )
        with patch(
            "app.routes.vectorize.vectorize_profile",
            new=AsyncMock(return_value=result),
        ) as mock_vectorize:
            response = client.post(
                "/api/vectorize",
                headers=auth_headers,
                data={
                    "user_id": "test-user-123",
                    "profile_json": json.dumps(sample_profile_data),
                },
            )

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["success"] is True
        mock_vectorize.assert_awaited_once()

    def test_vectorize_invalid_profile_json_returns_generic_400(
        self, client, auth_headers
    ):
        """The JSON parse error detail is logged, not returned to the client."""
        response = client.post(
            "/api/vectorize",
            headers=auth_headers,
            data={"user_id": "test-user-123", "profile_json": "invalid-json{{"},
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.json()["detail"] == "Invalid profile JSON"
        assert "invalid-json" not in response.text


@pytest.mark.integration
class TestQStashWebhookFailsClosed:
    """1d — the QStash webhook rejects unsigned requests when keys are absent."""

    def test_webhook_without_signature_and_without_keys_returns_401(
        self, client
    ):
        """Dev defaults (no keys, no flag) → unsigned delivery rejected."""
        response = client.post("/api/webhooks/vectorize", json={"userId": "u1"})
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.asyncio
    async def test_verify_rejects_when_keys_absent_in_production(self, monkeypatch):
        """Production + no keys → reject, even if the dev flag is set."""
        from app.routes import webhooks
        from fastapi import HTTPException

        for allow_unsigned in (False, True):
            settings = SimpleNamespace(
                qstash_current_signing_key=None,
                qstash_next_signing_key=None,
                sentry_environment="production",
                debug=False,
                qstash_allow_unsigned=allow_unsigned,
            )
            monkeypatch.setattr(webhooks, "settings", settings)
            with pytest.raises(HTTPException) as exc_info:
                await webhooks._verify_qstash_signature(MagicMock(), "sig-123")
            assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.asyncio
    async def test_verify_rejects_when_keys_absent_in_dev_without_flag(
        self, monkeypatch
    ):
        """Dev + no keys + no flag → reject (fail closed everywhere by default)."""
        from app.routes import webhooks
        from fastapi import HTTPException

        settings = SimpleNamespace(
            qstash_current_signing_key=None,
            qstash_next_signing_key=None,
            sentry_environment="development",
            debug=True,
            qstash_allow_unsigned=False,
        )
        monkeypatch.setattr(webhooks, "settings", settings)
        with pytest.raises(HTTPException) as exc_info:
            await webhooks._verify_qstash_signature(MagicMock(), "sig-123")
        assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.asyncio
    async def test_verify_allows_unsigned_only_with_dev_flag(self, monkeypatch):
        """Dev + no keys + explicit QSTASH_ALLOW_UNSIGNED=true → skip check."""
        from app.routes import webhooks

        settings = SimpleNamespace(
            qstash_current_signing_key=None,
            qstash_next_signing_key=None,
            sentry_environment="development",
            debug=True,
            qstash_allow_unsigned=True,
        )
        monkeypatch.setattr(webhooks, "settings", settings)
        # Must not raise.
        await webhooks._verify_qstash_signature(MagicMock(), "sig-123")

    @pytest.mark.asyncio
    async def test_verify_rejects_missing_signature_header(self, monkeypatch):
        """Keys configured but no signature header → 401."""
        from app.routes import webhooks
        from fastapi import HTTPException

        settings = SimpleNamespace(
            qstash_current_signing_key="current-key",
            qstash_next_signing_key="next-key",
            sentry_environment="development",
            debug=True,
            qstash_allow_unsigned=False,
        )
        monkeypatch.setattr(webhooks, "settings", settings)
        with pytest.raises(HTTPException) as exc_info:
            await webhooks._verify_qstash_signature(MagicMock(), None)
        assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.unit
class TestSentryScopeReplacement:
    """1e — push_scope is gone; capture_exception works with extra data."""

    def test_capture_exception_with_extra_data_uses_new_scope(self):
        """sentry_sdk.push_scope is deprecated in SDK 2.x (removed in the
        next major); capture_exception must use new_scope instead."""
        from app.core import capture_exception

        with (
            patch("sentry_sdk.new_scope") as mock_new_scope,
            patch("sentry_sdk.capture_exception") as mock_capture,
        ):
            mock_new_scope.return_value.__enter__.return_value = MagicMock()
            capture_exception(ValueError("boom"), {"endpoint": "search"})
        mock_new_scope.assert_called_once()
        mock_capture.assert_called_once()

    def test_agent_stream_error_leaks_nothing(self, client, auth_headers):
        """A failure mid-stream must not leak internals to the client.

        NOTE: the agent handler's try/except only covers response setup —
        the generator body runs during streaming, after the response has
        started, so a streaming failure ends the stream instead of raising
        a 500. The observable contract is: no exception detail ever
        reaches the client.
        """
        from fastapi.testclient import TestClient

        from app.main import app

        quiet_client = TestClient(app, raise_server_exceptions=False)
        with patch(
            "app.routes.agent.stream_agent_response",
            side_effect=RuntimeError("agent exploded"),
        ):
            response = quiet_client.post(
                "/api/agent",
                headers=auth_headers,
                json={"message": "hello"},
            )
        assert b"agent exploded" not in response.content
