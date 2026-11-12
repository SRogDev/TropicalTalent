"""
Unit tests for authentication dependency.

Tests follow the Given-When-Then pattern and focus on behavior:
- Given: A specific authentication scenario
- When: The auth dependency is called
- Then: The expected authentication result occurs

NOTE (Phase 5, 2026-11-12): the old version of this file tested a
Supabase `auth.get_user()` flow (`get_supabase_client` in
`app.dependencies.auth`). That implementation was replaced by local JWT
verification with python-jose (`jwt.decode`, HS256, audience
"authenticated") and `get_supabase_client` moved to `app.core.database`.
These tests were rewritten against the current implementation, keeping
the same behavioral intent: a valid token returns the payload, anything
else is a 401.
"""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from jose import jwt

from app.dependencies.auth import get_current_user

TEST_SECRET = "test_jwt_secret"


def _mint_token(**claims):
    """Mint a real HS256 JWT the way Supabase would (for tests)."""
    now = int(time.time())
    payload = {"sub": "test-user-123", "aud": "authenticated", "exp": now + 3600, "iat": now}
    payload.update(claims)
    return jwt.encode(payload, TEST_SECRET, algorithm="HS256")


def _credentials(token):
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


@pytest.mark.unit
@pytest.mark.auth
class TestAuthentication:
    """Test suite for authentication functionality."""

    @pytest.mark.asyncio
    async def test_get_current_user_with_valid_token_returns_user_data(self):
        """
        Given: A valid JWT token from Supabase
        When: get_current_user is called
        Then: User data is returned successfully
        """
        # Given
        credentials = _credentials(_mint_token(email="test@example.com"))

        # When
        result = await get_current_user(credentials)

        # Then
        assert result is not None
        assert result["sub"] == "test-user-123"
        assert result["email"] == "test@example.com"

    @pytest.mark.asyncio
    async def test_get_current_user_with_invalid_token_raises_unauthorized(self):
        """
        Given: An invalid or expired JWT token
        When: get_current_user is called
        Then: HTTPException with 401 status is raised
        """
        # Given: token signed with the wrong secret
        bad_token = jwt.encode(
            {"sub": "test-user-123", "aud": "authenticated",
             "exp": int(time.time()) + 3600},
            "wrong-secret",
            algorithm="HS256",
        )
        credentials = _credentials(bad_token)

        # When / Then
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(credentials)

        assert exc_info.value.status_code == 401
        assert "Invalid or expired token" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_get_current_user_with_empty_token_raises_unauthorized(self):
        """
        Given: An empty token
        When: get_current_user is called
        Then: HTTPException with 401 status is raised
        """
        # Given
        credentials = _credentials("")

        # When / Then
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(credentials)

        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_get_current_user_with_expired_token_raises_unauthorized(self):
        """
        Given: An expired JWT token
        When: get_current_user is called
        Then: HTTPException with 401 status is raised
        """
        # Given
        credentials = _credentials(_mint_token(exp=int(time.time()) - 60))

        # When / Then
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(credentials)

        assert exc_info.value.status_code == 401
        assert "Invalid or expired token" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_get_current_user_with_wrong_audience_raises_unauthorized(self):
        """
        Given: A token whose audience is not "authenticated"
        When: get_current_user is called
        Then: HTTPException with 401 status is raised
        """
        # Given
        credentials = _credentials(_mint_token(aud="someone-else"))

        # When / Then
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(credentials)

        assert exc_info.value.status_code == 401

    def test_get_supabase_client_returns_configured_client(self):
        """
        Given: Valid Supabase configuration in settings
        When: get_supabase_client is called
        Then: A configured Supabase client is returned

        NOTE: get_supabase_client moved from app.dependencies.auth to
        app.core.database; this test follows the move.
        """
        import asyncio

        from app.core.database import SupabaseClient, get_supabase_client

        # Given / When — skip the real initialize() (network) and check
        # the factory builds a client pointed at the configured project.
        with patch.object(SupabaseClient, "initialize", new=AsyncMock()):
            client = asyncio.run(get_supabase_client())

            # Then
            assert client is not None
            assert isinstance(client, SupabaseClient)
            assert client.supabase_url == "https://test.supabase.co"

    @pytest.mark.asyncio
    async def test_get_current_user_validates_token_format(self):
        """
        Given: A token with correct JWT format
        When: get_current_user validates the token
        Then: The decoded payload is returned
        """
        # Given
        token = _mint_token()
        credentials = _credentials(token)

        # When
        result = await get_current_user(credentials)

        # Then
        assert result["sub"] == "test-user-123"
        assert result["aud"] == "authenticated"

    @pytest.mark.asyncio
    async def test_get_current_user_preserves_user_metadata(self):
        """
        Given: A valid token with user metadata
        When: get_current_user is called
        Then: All user data including metadata is preserved
        """
        # Given
        credentials = _credentials(
            _mint_token(user_metadata={"username": "testuser"})
        )

        # When
        result = await get_current_user(credentials)

        # Then
        assert "user_metadata" in result
        assert result["user_metadata"]["username"] == "testuser"
