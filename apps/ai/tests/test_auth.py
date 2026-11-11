"""
Unit tests for authentication dependency.

Tests follow the Given-When-Then pattern and focus on behavior:
- Given: A specific authentication scenario
- When: The auth dependency is called
- Then: The expected authentication result occurs

All tests are modular and test behavior, not implementation.
"""

import pytest
from fastapi import HTTPException
from unittest.mock import AsyncMock, MagicMock, patch

from app.dependencies.auth import get_current_user, get_supabase_client
from fastapi.security import HTTPAuthorizationCredentials


@pytest.mark.unit
@pytest.mark.auth
class TestAuthentication:
    """Test suite for authentication functionality."""

    @pytest.mark.asyncio
    async def test_get_current_user_with_valid_token_returns_user_data(
        self, mock_supabase_client, valid_auth_token
    ):
        """
        Given: A valid JWT token from Supabase
        When: get_current_user is called
        Then: User data is returned successfully
        """
        # Given
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=valid_auth_token
        )
        
        with patch('app.dependencies.auth.get_supabase_client', return_value=mock_supabase_client):
            # When
            result = await get_current_user(credentials)
            
            # Then
            assert result is not None
            assert result["id"] == "test-user-123"
            assert result["email"] == "test@example.com"
            mock_supabase_client.auth.get_user.assert_called_once_with(valid_auth_token)

    @pytest.mark.asyncio
    async def test_get_current_user_with_invalid_token_raises_unauthorized(
        self, invalid_auth_token
    ):
        """
        Given: An invalid or expired JWT token
        When: get_current_user is called
        Then: HTTPException with 401 status is raised
        """
        # Given
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=invalid_auth_token
        )
        
        mock_client = MagicMock()
        mock_client.auth.get_user.return_value = MagicMock(user=None)
        
        with patch('app.dependencies.auth.get_supabase_client', return_value=mock_client):
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
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=""
        )
        
        mock_client = MagicMock()
        mock_client.auth.get_user.side_effect = Exception("Invalid token")
        
        with patch('app.dependencies.auth.get_supabase_client', return_value=mock_client):
            # When / Then
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(credentials)
            
            assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_get_current_user_with_supabase_error_raises_unauthorized(
        self, valid_auth_token
    ):
        """
        Given: Supabase service is unavailable or errors
        When: get_current_user is called
        Then: HTTPException with 401 status and error message is raised
        """
        # Given
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=valid_auth_token
        )
        
        mock_client = MagicMock()
        mock_client.auth.get_user.side_effect = Exception("Supabase connection error")
        
        with patch('app.dependencies.auth.get_supabase_client', return_value=mock_client):
            # When / Then
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(credentials)
            
            assert exc_info.value.status_code == 401
            assert "Authentication error" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_get_current_user_with_malformed_user_object_raises_unauthorized(
        self, valid_auth_token
    ):
        """
        Given: Supabase returns a malformed user object
        When: get_current_user is called
        Then: HTTPException with 401 status is raised
        """
        # Given
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=valid_auth_token
        )
        
        mock_client = MagicMock()
        # Return object without 'user' attribute
        mock_client.auth.get_user.return_value = MagicMock(spec=[])
        
        with patch('app.dependencies.auth.get_supabase_client', return_value=mock_client):
            # When / Then
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(credentials)
            
            assert exc_info.value.status_code == 401

    def test_get_supabase_client_returns_configured_client(self):
        """
        Given: Valid Supabase configuration in settings
        When: get_supabase_client is called
        Then: A configured Supabase client is returned
        """
        # Given / When
        with patch('app.dependencies.auth.create_client') as mock_create_client:
            mock_client = MagicMock()
            mock_create_client.return_value = mock_client
            
            client = get_supabase_client()
            
            # Then
            assert client is not None
            mock_create_client.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_current_user_validates_token_format(self, valid_auth_token):
        """
        Given: A token with correct JWT format
        When: get_current_user validates the token
        Then: The token is passed to Supabase for verification
        """
        # Given
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=valid_auth_token
        )
        
        mock_client = MagicMock()
        mock_user = MagicMock()
        mock_user.user = {"id": "123", "email": "test@example.com"}
        mock_client.auth.get_user.return_value = mock_user
        
        with patch('app.dependencies.auth.get_supabase_client', return_value=mock_client):
            # When
            await get_current_user(credentials)
            
            # Then
            mock_client.auth.get_user.assert_called_once_with(valid_auth_token)

    @pytest.mark.asyncio
    async def test_get_current_user_preserves_user_metadata(
        self, mock_supabase_client, valid_auth_token
    ):
        """
        Given: A valid token with user metadata
        When: get_current_user is called
        Then: All user data including metadata is preserved
        """
        # Given
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=valid_auth_token
        )
        
        with patch('app.dependencies.auth.get_supabase_client', return_value=mock_supabase_client):
            # When
            result = await get_current_user(credentials)
            
            # Then
            assert "user_metadata" in result
            assert result["user_metadata"]["username"] == "testuser"
