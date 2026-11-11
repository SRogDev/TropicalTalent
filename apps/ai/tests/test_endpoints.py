"""
Integration tests for API endpoints.

Tests follow the Given-When-Then pattern and focus on end-to-end behavior:
- Given: Specific application state and request data
- When: An HTTP request is made to an endpoint
- Then: The expected HTTP response is returned

All tests are integration tests that verify complete request/response cycles.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import status


@pytest.mark.integration
class TestVectorizeEndpoint:
    """Integration tests for /vectorize endpoint."""

    @pytest.mark.asyncio
    async def test_vectorize_with_valid_auth_and_data_returns_success(
        self, client, valid_auth_token, sample_profile_data
    ):
        """
        Given: A valid auth token and complete profile data
        When: POST /vectorize is called
        Then: 200 OK response with vectorization result is returned
        """
        # Given
        with patch('app.dependencies.auth.get_supabase_client') as mock_get_client:
            mock_client = MagicMock()
            mock_user = MagicMock()
            mock_user.user = {"id": "test-user-123", "email": "test@example.com"}
            mock_client.auth.get_user.return_value = mock_user
            mock_get_client.return_value = mock_client
            
            with patch('app.services.vectorize.vectorize_profile') as mock_vectorize:
                mock_vectorize.return_value = {
                    "user_id": "test-user-123",
                    "vector_id": "vec-123",
                    "success": True,
                    "message": "Profile vectorized successfully",
                    "timestamp": "2025-12-05T10:00:00"
                }
                
                # When
                response = client.post(
                    "/vectorize",
                    headers={"Authorization": f"Bearer {valid_auth_token}"},
                    data={
                        "user_id": "test-user-123",
                        "profile_json": json.dumps(sample_profile_data)
                    }
                )
                
                # Then
                assert response.status_code == status.HTTP_200_OK
                data = response.json()
                assert data["success"] is True
                assert data["user_id"] == "test-user-123"

    @pytest.mark.asyncio
    async def test_vectorize_without_auth_returns_unauthorized(
        self, client, sample_profile_data
    ):
        """
        Given: No authentication token
        When: POST /vectorize is called
        Then: 401 Unauthorized response is returned
        """
        # Given / When
        response = client.post(
            "/vectorize",
            data={
                "user_id": "test-user-123",
                "profile_json": json.dumps(sample_profile_data)
            }
        )
        
        # Then
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.asyncio
    async def test_vectorize_with_invalid_profile_json_returns_bad_request(
        self, client, valid_auth_token
    ):
        """
        Given: Valid auth but invalid JSON in profile_json
        When: POST /vectorize is called
        Then: 400 Bad Request response is returned
        """
        # Given
        with patch('app.dependencies.auth.get_supabase_client') as mock_get_client:
            mock_client = MagicMock()
            mock_user = MagicMock()
            mock_user.user = {"id": "test-user-123", "email": "test@example.com"}
            mock_client.auth.get_user.return_value = mock_user
            mock_get_client.return_value = mock_client
            
            # When
            response = client.post(
                "/vectorize",
                headers={"Authorization": f"Bearer {valid_auth_token}"},
                data={
                    "user_id": "test-user-123",
                    "profile_json": "invalid-json{{"
                }
            )
            
            # Then
            assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.integration
class TestRecommendationsEndpoint:
    """Integration tests for /recommendations endpoint."""

    @pytest.mark.asyncio
    async def test_recommendations_with_valid_auth_returns_results(
        self, client, valid_auth_token
    ):
        """
        Given: A valid auth token and existing user
        When: GET /recommendations is called
        Then: 200 OK with recommended users is returned
        """
        # Given
        with patch('app.dependencies.auth.get_supabase_client') as mock_get_client:
            mock_client = MagicMock()
            mock_user = MagicMock()
            mock_user.user = {"id": "test-user-123", "email": "test@example.com"}
            mock_client.auth.get_user.return_value = mock_user
            mock_get_client.return_value = mock_client
            
            with patch('app.services.recommendations.get_recommendations') as mock_recs:
                mock_recs.return_value = {
                    "user_id": "test-user-123",
                    "recommendations": [
                        {
                            "user_id": "user-1",
                            "score": 0.95,
                            "username": "john_doe",
                            "bio": "Developer"
                        }
                    ],
                    "total_results": 1,
                    "timestamp": "2025-12-05T10:00:00"
                }
                
                # When
                response = client.get(
                    "/recommendations",
                    params={"user_id": "test-user-123"},
                    headers={"Authorization": f"Bearer {valid_auth_token}"}
                )
                
                # Then
                assert response.status_code == status.HTTP_200_OK
                data = response.json()
                assert data["user_id"] == "test-user-123"
                assert len(data["recommendations"]) > 0

    @pytest.mark.asyncio
    async def test_recommendations_without_auth_returns_unauthorized(self, client):
        """
        Given: No authentication token
        When: GET /recommendations is called
        Then: 401 Unauthorized response is returned
        """
        # Given / When
        response = client.get(
            "/recommendations",
            params={"user_id": "test-user-123"}
        )
        
        # Then
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.asyncio
    async def test_recommendations_with_empty_user_id_returns_bad_request(
        self, client, valid_auth_token
    ):
        """
        Given: Valid auth but empty user_id
        When: GET /recommendations is called
        Then: 400 Bad Request response is returned
        """
        # Given
        with patch('app.dependencies.auth.get_supabase_client') as mock_get_client:
            mock_client = MagicMock()
            mock_user = MagicMock()
            mock_user.user = {"id": "test-user-123", "email": "test@example.com"}
            mock_client.auth.get_user.return_value = mock_user
            mock_get_client.return_value = mock_client
            
            # When
            response = client.get(
                "/recommendations",
                params={"user_id": "   "},
                headers={"Authorization": f"Bearer {valid_auth_token}"}
            )
            
            # Then
            assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.integration
class TestSearchEndpoint:
    """Integration tests for /internals/search endpoint."""

    @pytest.mark.asyncio
    async def test_search_with_valid_query_returns_results(self, client):
        """
        Given: Valid search parameters
        When: GET /internals/search is called
        Then: 200 OK with search results is returned
        """
        # Given
        with patch('app.services.search.search_users') as mock_search:
            mock_search.return_value = {
                "user_id": "test-user-123",
                "query": "Python developer",
                "results": [
                    {
                        "user_id": "user-1",
                        "score": 0.95,
                        "bio": "Python expert",
                        "tags": ["python", "fastapi"]
                    }
                ],
                "total_results": 1,
                "search_time_ms": 150,
                "timestamp": "2025-12-05T10:00:00"
            }
            
            # When
            response = client.get(
                "/internals/search",
                params={
                    "user_id": "test-user-123",
                    "query": "Python developer"
                }
            )
            
            # Then
            assert response.status_code == status.HTTP_200_OK
            data = response.json()
            assert data["query"] == "Python developer"
            assert len(data["results"]) > 0

    @pytest.mark.asyncio
    async def test_search_with_short_query_returns_bad_request(self, client):
        """
        Given: Query shorter than minimum length (3 characters)
        When: GET /internals/search is called
        Then: 400 Bad Request response is returned
        """
        # Given / When
        response = client.get(
            "/internals/search",
            params={
                "user_id": "test-user-123",
                "query": "ab"  # Too short
            }
        )
        
        # Then
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.asyncio
    async def test_search_with_long_query_returns_bad_request(self, client):
        """
        Given: Query longer than maximum length (500 characters)
        When: GET /internals/search is called
        Then: 400 Bad Request response is returned
        """
        # Given
        long_query = "a" * 501  # Too long
        
        # When
        response = client.get(
            "/internals/search",
            params={
                "user_id": "test-user-123",
                "query": long_query
            }
        )
        
        # Then
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.asyncio
    async def test_search_without_user_id_returns_bad_request(self, client):
        """
        Given: Missing user_id parameter
        When: GET /internals/search is called
        Then: 400 Bad Request response is returned
        """
        # Given / When
        response = client.get(
            "/internals/search",
            params={
                "user_id": "   ",
                "query": "Python developer"
            }
        )
        
        # Then
        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.integration
class TestAgentEndpoint:
    """Integration tests for /api/agent endpoint."""

    @pytest.mark.asyncio
    async def test_agent_with_valid_auth_streams_response(
        self, client, valid_auth_token
    ):
        """
        Given: Valid auth token and agent request
        When: POST /api/agent is called
        Then: 200 OK with SSE stream is returned
        """
        # Given
        with patch('app.dependencies.auth.get_supabase_client') as mock_get_client:
            mock_client = MagicMock()
            mock_user = MagicMock()
            mock_user.user = {"id": "test-user-123", "email": "test@example.com"}
            mock_client.auth.get_user.return_value = mock_user
            mock_get_client.return_value = mock_client
            
            with patch('app.services.agent_service.stream_agent_response') as mock_stream:
                # Mock SSE stream
                async def mock_generator():
                    yield 'data: {"type": "start", "content": "Starting"}\n\n'
                    yield 'data: {"type": "chunk", "content": "Hello"}\n\n'
                    yield 'data: {"type": "end", "content": "Done"}\n\n'
                
                mock_stream.return_value = mock_generator()
                
                # When
                response = client.post(
                    "/api/agent",
                    headers={"Authorization": f"Bearer {valid_auth_token}"},
                    json={"query": "Tell me about AI"}
                )
                
                # Then
                assert response.status_code == status.HTTP_200_OK
                assert response.headers["content-type"] == "text/event-stream; charset=utf-8"

    @pytest.mark.asyncio
    async def test_agent_without_auth_returns_unauthorized(self, client):
        """
        Given: No authentication token
        When: POST /api/agent is called
        Then: 401 Unauthorized response is returned
        """
        # Given / When
        response = client.post(
            "/api/agent",
            json={"query": "Tell me about AI"}
        )
        
        # Then
        assert response.status_code == status.HTTP_403_FORBIDDEN


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
