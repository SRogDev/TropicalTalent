"""
Pytest configuration and shared fixtures for the test suite.

This module provides common fixtures and configuration for all tests,
following the Given-When-Then pattern and focusing on behavior testing.
"""

import os
from typing import AsyncGenerator, Generator
from unittest.mock import AsyncMock, MagicMock, Mock

import pytest
from fastapi.testclient import TestClient
from httpx import AsyncClient

# Set test environment variables before importing app
os.environ.update({
    "PINECONE_API_KEY": "test_pinecone_key",
    "SUPABASE_URL": "https://test.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "test_supabase_key",
    "GEMINI_API_KEY": "test_gemini_key",
    "SUPABASE_JWT_SECRET": "test_jwt_secret",
    "INTERNAL_API_KEY": "test_internal_key",
    "DEBUG": "true",
    "LOG_LEVEL": "INFO",
})

from app.main import app


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    """
    Provide a test client for synchronous API testing.
    
    Given: A FastAPI application
    When: Tests need to make HTTP requests
    Then: A test client is provided
    """
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
async def async_client() -> AsyncGenerator[AsyncClient, None]:
    """
    Provide an async client for asynchronous API testing.
    
    Given: A FastAPI application
    When: Tests need to make async HTTP requests
    Then: An async client is provided
    """
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac


@pytest.fixture
def mock_supabase_client() -> Mock:
    """
    Provide a mocked Supabase client for authentication testing.
    
    Given: Tests need to mock Supabase auth
    When: Authentication is required
    Then: A mocked Supabase client is provided
    """
    mock_client = MagicMock()
    mock_auth = MagicMock()
    
    # Mock successful authentication
    mock_user = MagicMock()
    mock_user.user = {
        "id": "test-user-123",
        "email": "test@example.com",
        "user_metadata": {"username": "testuser"}
    }
    mock_auth.get_user.return_value = mock_user
    mock_client.auth = mock_auth
    
    return mock_client


@pytest.fixture
def mock_pinecone_client() -> Mock:
    """
    Provide a mocked Pinecone client for vector operations.
    
    Given: Tests need to mock Pinecone operations
    When: Vector search/upsert is required
    Then: A mocked Pinecone client is provided
    """
    mock_client = MagicMock()
    mock_index = MagicMock()
    
    # Mock query response
    mock_index.query.return_value = {
        "matches": [
            {
                "id": "user-1",
                "score": 0.95,
                "metadata": {
                    "user_id": "user-1",
                    "username": "john_doe",
                    "bio": "Developer",
                }
            },
            {
                "id": "user-2",
                "score": 0.87,
                "metadata": {
                    "user_id": "user-2",
                    "username": "jane_smith",
                    "bio": "Designer",
                }
            }
        ]
    }
    
    # Mock upsert response
    mock_index.upsert.return_value = {"upserted_count": 1}
    
    mock_client.Index.return_value = mock_index
    return mock_client


@pytest.fixture
def mock_embeddings() -> AsyncMock:
    """
    Provide mocked embedding generation.
    
    Given: Tests need to mock AI embeddings
    When: Embedding generation is required
    Then: A mocked embedding service is provided
    """
    mock = AsyncMock()
    # Return a 1536-dimensional embedding (standard for text-embedding-3-small)
    mock.embed_query.return_value = [0.1] * 1536
    mock.aembed_query.return_value = [0.1] * 1536
    return mock


@pytest.fixture
def valid_auth_token() -> str:
    """
    Provide a valid authentication token for testing.

    Given: Tests need authentication
    When: A valid token is required
    Then: A test JWT token is provided
    """
    return "valid-test-jwt-token-12345"


@pytest.fixture
def auth_token() -> str:
    """
    Mint a REAL HS256 JWT the app's get_current_user dependency accepts.

    Signed with the test SUPABASE_JWT_SECRET from this conftest, audience
    "authenticated", subject "test-user-123". Use this (not
    valid_auth_token, which is not a parseable JWT) for endpoint tests
    that go through the real auth dependency.
    """
    import time

    from jose import jwt

    now = int(time.time())
    return jwt.encode(
        {
            "sub": "test-user-123",
            "aud": "authenticated",
            "exp": now + 3600,
            "iat": now,
        },
        os.environ["SUPABASE_JWT_SECRET"],
        algorithm="HS256",
    )


@pytest.fixture
def auth_headers(auth_token) -> dict:
    """Authorization header carrying a real test JWT."""
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.fixture(autouse=True)
def _reset_in_process_rate_limit():
    """
    Clear the in-process rate-limit window between tests.

    The fallback limiter is keyed by client IP ("testclient" for every
    TestClient request), so without a reset the suite would share one
    60/min budget and fail depending on test order/count.
    """
    from app.dependencies import rate_limiting

    rate_limiting._requests.clear()
    yield
    rate_limiting._requests.clear()


@pytest.fixture
def invalid_auth_token() -> str:
    """
    Provide an invalid authentication token for testing.
    
    Given: Tests need to verify auth failure
    When: An invalid token is required
    Then: An invalid test token is provided
    """
    return "invalid-token"


@pytest.fixture
def sample_profile_data() -> dict:
    """
    Provide sample profile data for testing.
    
    Given: Tests need user profile data
    When: Profile operations are tested
    Then: Valid sample profile data is provided
    """
    return {
        "username": "john_doe",
        "avatar": "https://example.com/avatar.jpg",
        "bio": "Passionate software developer with 5 years of experience",
        "tags": ["python", "fastapi", "ai", "ml"],
        "passion": "Building AI-powered applications",
        "location": "San Francisco, CA"
    }


@pytest.fixture
def sample_search_request() -> dict:
    """
    Provide sample search request for testing.
    
    Given: Tests need search request data
    When: Search operations are tested
    Then: Valid search request data is provided
    """
    return {
        "user_id": "test-user-123",
        "query": "Python developer with AI experience"
    }


# Pytest configuration
def pytest_configure(config):
    """Configure pytest with custom markers."""
    config.addinivalue_line("markers", "unit: Unit tests for individual components")
    config.addinivalue_line("markers", "integration: Integration tests for API endpoints")
    config.addinivalue_line("markers", "slow: Slow-running tests")
    config.addinivalue_line("markers", "auth: Authentication-related tests")
