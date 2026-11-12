"""
Integration tests for API endpoints.

Tests follow the Given-When-Then pattern and focus on end-to-end behavior:
- Given: Specific application state and request data
- When: An HTTP request is made to an endpoint
- Then: The expected HTTP response is returned

All tests are integration tests that verify complete request/response cycles.

NOTE (Phase 5, 2026-11-12): this file was updated for the current
implementation — the old version used pre-fusion paths (/vectorize,
/recommendations, /internals/search), the removed
app.dependencies.auth.get_supabase_client mock, a non-JWT
"valid-test-jwt-token-12345" bearer, and an AgentRequest {"query": ...}
payload. Auth now uses real HS256 JWTs (conftest auth_headers fixture),
patch targets are the route modules' own bindings, and /search and
/api/recommendations take the user_id from the token, not the caller.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import status

from app.models.recommendations import RecommendationsResponse, UserRecommendation
from app.models.search import SearchResponse, UserSearchResult
from app.models.vectorize import VectorizeProfileResponse


@pytest.mark.integration
class TestVectorizeEndpoint:
    """Integration tests for /api/vectorize endpoint."""

    def test_vectorize_with_valid_auth_and_data_returns_success(
        self, client, auth_headers, sample_profile_data
    ):
        """
        Given: A valid auth token and complete profile data
        When: POST /api/vectorize is called
        Then: 200 OK response with vectorization result is returned
        """
        # Given
        result = VectorizeProfileResponse(
            user_id="test-user-123",
            vector_id="user-test-user-123",
            success=True,
            message="Profile vectorized successfully",
        )
        with patch(
            "app.routes.vectorize.vectorize_profile",
            new=AsyncMock(return_value=result),
        ):
            # When
            response = client.post(
                "/api/vectorize",
                headers=auth_headers,
                data={
                    "user_id": "test-user-123",
                    "profile_json": json.dumps(sample_profile_data),
                },
            )

            # Then
            assert response.status_code == status.HTTP_200_OK
            data = response.json()
            assert data["success"] is True
            assert data["userId"] == "test-user-123"

    def test_vectorize_without_auth_returns_unauthorized(
        self, client, sample_profile_data
    ):
        """
        Given: No authentication token
        When: POST /api/vectorize is called
        Then: 401 Unauthorized response is returned
        """
        # Given / When
        response = client.post(
            "/api/vectorize",
            data={
                "user_id": "test-user-123",
                "profile_json": json.dumps(sample_profile_data),
            },
        )

        # Then
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_vectorize_with_invalid_profile_json_returns_bad_request(
        self, client, auth_headers
    ):
        """
        Given: Valid auth but invalid JSON in profile_json
        When: POST /api/vectorize is called
        Then: 400 Bad Request response is returned
        """
        # Given / When
        response = client.post(
            "/api/vectorize",
            headers=auth_headers,
            data={"user_id": "test-user-123", "profile_json": "invalid-json{{"},
        )

        # Then
        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.integration
class TestRecommendationsEndpoint:
    """Integration tests for /api/recommendations endpoint."""

    def test_recommendations_with_valid_auth_returns_results(
        self, client, auth_headers
    ):
        """
        Given: A valid auth token and existing user
        When: GET /api/recommendations is called
        Then: 200 OK with recommended users is returned
        """
        # Given
        mock_result = RecommendationsResponse(
            user_id="test-user-123",
            recommendations=[
                UserRecommendation(
                    user_id="user-1", username="john_doe", bio="Developer"
                )
            ],
            total_recommendations=1,
            based_on_searches=1,
        )
        with patch(
            "app.routes.recommendations.get_recommendations",
            new=AsyncMock(return_value=mock_result),
        ) as mock_recs:
            # When
            response = client.get("/api/recommendations", headers=auth_headers)

            # Then
            assert response.status_code == status.HTTP_200_OK
            data = response.json()
            assert data["userId"] == "test-user-123"
            assert len(data["recommendations"]) > 0
            # The service is called with the token subject.
            mock_recs.assert_awaited_once_with("test-user-123")

    def test_recommendations_without_auth_returns_unauthorized(self, client):
        """
        Given: No authentication token
        When: GET /api/recommendations is called
        Then: 401 Unauthorized response is returned
        """
        # Given / When
        response = client.get("/api/recommendations")

        # Then
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_recommendations_ignores_caller_supplied_user_id(
        self, client, auth_headers
    ):
        """
        Given: Valid auth and a caller-supplied user_id query param
        When: GET /api/recommendations is called
        Then: The token subject is used, not the query param
        """
        # Given
        mock_result = RecommendationsResponse(
            user_id="test-user-123",
            recommendations=[],
            total_recommendations=0,
            based_on_searches=0,
        )
        with patch(
            "app.routes.recommendations.get_recommendations",
            new=AsyncMock(return_value=mock_result),
        ) as mock_recs:
            # When
            response = client.get(
                "/api/recommendations",
                params={"user_id": "someone-else"},
                headers=auth_headers,
            )

            # Then
            assert response.status_code == status.HTTP_200_OK
            mock_recs.assert_awaited_once_with("test-user-123")


@pytest.mark.integration
class TestSearchEndpoint:
    """Integration tests for /search endpoint."""

    def test_search_with_valid_query_returns_results(self, client, auth_headers):
        """
        Given: Valid search parameters and auth
        When: GET /search is called
        Then: 200 OK with search results is returned
        """
        # Given
        mock_result = SearchResponse(
            user_id="test-user-123",
            query="Python developer",
            results=[
                UserSearchResult(
                    user_id="user-1",
                    score=0.95,
                    bio="Python expert",
                    tags=["python", "fastapi"],
                )
            ],
            total_results=1,
            search_time_ms=150,
        )
        with patch(
            "app.routes.internals.search.search_users",
            new=AsyncMock(return_value=mock_result),
        ):
            # When
            response = client.get(
                "/search",
                params={"query": "Python developer"},
                headers=auth_headers,
            )

            # Then
            assert response.status_code == status.HTTP_200_OK
            data = response.json()
            assert data["query"] == "Python developer"
            assert len(data["results"]) > 0

    def test_search_with_short_query_returns_bad_request(
        self, client, auth_headers
    ):
        """
        Given: Query shorter than minimum length (3 characters)
        When: GET /search is called
        Then: 400 Bad Request response is returned
        """
        # Given / When
        response = client.get(
            "/search",
            params={"query": "ab"},  # Too short
            headers=auth_headers,
        )

        # Then
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_search_with_long_query_returns_bad_request(
        self, client, auth_headers
    ):
        """
        Given: Query longer than maximum length (500 characters)
        When: GET /search is called
        Then: 400 Bad Request response is returned
        """
        # Given
        long_query = "a" * 501  # Too long

        # When
        response = client.get(
            "/search",
            params={"query": long_query},
            headers=auth_headers,
        )

        # Then
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_search_without_auth_returns_unauthorized(self, client):
        """
        Given: No authentication token
        When: GET /search is called
        Then: 401 Unauthorized response is returned
        """
        # Given / When
        response = client.get(
            "/search", params={"query": "Python developer"}
        )

        # Then
        assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.integration
class TestAgentEndpoint:
    """Integration tests for /api/agent endpoint."""

    def test_agent_with_valid_auth_streams_response(
        self, client, auth_headers
    ):
        """
        Given: Valid auth token and agent request
        When: POST /api/agent is called
        Then: 200 OK with SSE stream is returned
        """
        # Given
        async def mock_generator():
            yield 'data: {"type": "start", "content": "Starting"}\n\n'
            yield 'data: {"type": "chunk", "content": "Hello"}\n\n'
            yield 'data: {"type": "end", "content": "Done"}\n\n'

        with patch(
            "app.routes.agent.stream_agent_response",
            return_value=mock_generator(),
        ):
            # When
            response = client.post(
                "/api/agent",
                headers=auth_headers,
                json={"message": "Tell me about AI"},
            )

            # Then
            assert response.status_code == status.HTTP_200_OK
            assert response.headers["content-type"] == "text/event-stream; charset=utf-8"

    def test_agent_without_auth_returns_unauthorized(self, client):
        """
        Given: No authentication token
        When: POST /api/agent is called
        Then: 401 Unauthorized response is returned
        """
        # Given / When
        response = client.post("/api/agent", json={"message": "Tell me about AI"})

        # Then
        assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.integration
class TestRootEndpoint:
    """Integration tests for root endpoint."""

    def test_root_endpoint_returns_api_info(self, client):
        """
        Given: The API is running
        When: GET / is called
        Then: 200 OK with API information is returned
        """
        # Given / When
        response = client.get("/")

        # Then
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "service" in data
        assert "version" in data
