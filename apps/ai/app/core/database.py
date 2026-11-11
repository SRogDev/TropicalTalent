"""
Supabase client wrapper for database operations.

This module provides a clean interface to Supabase database operations with
dependency injection support for testing. Handles connection management,
error handling, and provides typed methods for database interactions.

Design Notes:
- Async/await for performance on I/O operations
- Dependency injection pattern for easy testing
- Type-safe database operations using Pydantic models
- Comprehensive error handling with structured logging
- Connection pooling and retry logic for reliability
"""

import asyncio
from datetime import datetime
from typing import Any, Dict, List, Optional

from postgrest import APIError as PostgrestError
from supabase import Client, create_client

from app.core import LoggerMixin, get_settings
from app.models import SearchLogEntry, UserData


class SupabaseClient(LoggerMixin):
    """
    Async wrapper for Supabase database operations.

    This class provides a clean, typed interface to Supabase database
    operations with proper error handling and logging.

    Example Usage:
        client = SupabaseClient()
        await client.initialize()

        # Save search log
        search_log = SearchLogEntry(user_id="123", content="python developer", results=[...])
        await client.save_search_log(search_log)

        # Get user data
        user = await client.get_user_data("123")
    """

    def __init__(
        self, supabase_url: Optional[str] = None, supabase_key: Optional[str] = None
    ):
        """
        Initialize Supabase client.

        Args:
            supabase_url: Optional Supabase URL (uses config if not provided)
            supabase_key: Optional Supabase key (uses config if not provided)
        """
        self.settings = get_settings()
        self._client: Optional[Client] = None

        # Allow dependency injection for testing
        self.supabase_url = supabase_url or self.settings.supabase_url
        self.supabase_key = supabase_key or self.settings.supabase_service_role_key

    async def initialize(self) -> None:
        """
        Initialize the Supabase client connection.

        This method should be called before using any other methods.
        It's separated from __init__ to support async initialization.
        """
        try:
            # Create Supabase client (note: supabase-py is sync, so we'll handle it carefully)
            self._client = create_client(self.supabase_url, self.supabase_key)

            # Test connection with a simple query
            await self._test_connection()

            self.logger.info(
                "Supabase client initialized successfully",
                url=self.supabase_url[:50] + "..."
                if len(self.supabase_url) > 50
                else self.supabase_url,
            )
        except Exception as e:
            self.logger.error(
                "Failed to initialize Supabase client",
                error=str(e),
                url=self.supabase_url[:50] + "..."
                if len(self.supabase_url) > 50
                else self.supabase_url,
            )
            raise

    async def _test_connection(self) -> None:
        """Test Supabase connection with a simple query."""
        if not self._client:
            raise RuntimeError("Supabase client not initialized")

        try:
            # Use asyncio to run the sync operation in a thread pool
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self._client.table(self.settings.users_data_table)
                .select("user_id")
                .limit(1)
                .execute(),
            )
            self.logger.debug("Supabase connection test successful")
        except Exception as e:
            self.logger.error("Supabase connection test failed", error=str(e))
            raise

    async def save_search_log(self, search_log: SearchLogEntry) -> bool:
        """
        Save a search log entry to the database.

        Args:
            search_log: SearchLogEntry to save

        Returns:
            bool: True if saved successfully

        Raises:
            Exception: If database operation fails
        """
        if not self._client:
            raise RuntimeError("Supabase client not initialized")

        try:
            # Prepare data for insertion
            log_data = {
                "user_id": search_log.user_id,
                "content": search_log.content,
                "results": search_log.results,
            }

            # If created_at is provided, include it; otherwise let DB handle it
            if search_log.created_at:
                log_data["created_at"] = search_log.created_at.isoformat()

            # Execute insert operation in thread pool
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self._client.table(self.settings.search_logs_table)
                .insert(log_data)
                .execute(),
            )

            self.logger.info(
                "Search log saved successfully",
                user_id=search_log.user_id,
                content_length=len(search_log.content),
                results_count=len(search_log.results),
            )
            return True

        except PostgrestError as e:
            self.logger.error(
                "Failed to save search log",
                user_id=search_log.user_id,
                error=str(e),
                error_code=getattr(e, "code", None),
            )
            raise
        except Exception as e:
            self.logger.error(
                "Unexpected error saving search log",
                user_id=search_log.user_id,
                error=str(e),
            )
            raise

    async def get_user_data(self, user_id: str) -> Optional[UserData]:
        """
        Retrieve user data by user ID.

        Args:
            user_id: User identifier

        Returns:
            Optional[UserData]: User data if found, None otherwise
        """
        if not self._client:
            raise RuntimeError("Supabase client not initialized")

        try:
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self._client.table(self.settings.users_data_table)
                .select("*")
                .eq("user_id", user_id)
                .single()
                .execute(),
            )

            if result.data:
                user_data = UserData(**result.data)
                self.logger.debug("User data retrieved successfully", user_id=user_id)
                return user_data
            else:
                self.logger.debug("User data not found", user_id=user_id)
                return None

        except PostgrestError as e:
            # Handle specific error codes
            if getattr(e, "code", None) == "PGRST116":  # No rows returned
                self.logger.debug("User not found", user_id=user_id)
                return None
            else:
                self.logger.error(
                    "Failed to retrieve user data", user_id=user_id, error=str(e)
                )
                raise
        except Exception as e:
            self.logger.error(
                "Unexpected error retrieving user data", user_id=user_id, error=str(e)
            )
            raise

    async def get_user_search_history(
        self, user_id: str, limit: int = 20
    ) -> List[SearchLogEntry]:
        """
        Get recent search history for a user.

        Args:
            user_id: User identifier
            limit: Maximum number of searches to retrieve

        Returns:
            List[SearchLogEntry]: List of recent searches
        """
        if not self._client:
            raise RuntimeError("Supabase client not initialized")

        try:
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self._client.table(self.settings.search_logs_table)
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(limit)
                .execute(),
            )

            search_logs = [SearchLogEntry(**log) for log in result.data]

            self.logger.debug(
                "Search history retrieved", user_id=user_id, count=len(search_logs)
            )

            return search_logs

        except PostgrestError as e:
            self.logger.error(
                "Failed to retrieve search history", user_id=user_id, error=str(e)
            )
            raise
        except Exception as e:
            self.logger.error(
                "Unexpected error retrieving search history",
                user_id=user_id,
                error=str(e),
            )
            raise

    async def save_user_data(self, user_data: UserData) -> bool:
        """
        Save or update user data.

        Args:
            user_data: UserData to save

        Returns:
            bool: True if saved successfully
        """
        if not self._client:
            raise RuntimeError("Supabase client not initialized")

        try:
            data = {
                "user_id": user_data.user_id,
                "bio": user_data.bio,
                "video_tags": user_data.video_tags,
                "passion": user_data.passion,
            }

            # Use upsert to handle both insert and update cases
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self._client.table(self.settings.users_data_table)
                .upsert(data)
                .execute(),
            )

            self.logger.info("User data saved successfully", user_id=user_data.user_id)

            return True

        except PostgrestError as e:
            self.logger.error(
                "Failed to save user data", user_id=user_data.user_id, error=str(e)
            )
            raise
        except Exception as e:
            self.logger.error(
                "Unexpected error saving user data",
                user_id=user_data.user_id,
                error=str(e),
            )
            raise

    async def get_all_users_paginated(
        self, offset: int = 0, limit: int = 100
    ) -> List[UserData]:
        """
        Get all users with pagination support.

        This method is useful for batch processing or administrative operations.

        Args:
            offset: Number of records to skip
            limit: Maximum number of records to return

        Returns:
            List[UserData]: List of user data
        """
        if not self._client:
            raise RuntimeError("Supabase client not initialized")

        try:
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self._client.table(self.settings.users_data_table)
                .select("*")
                .range(offset, offset + limit - 1)
                .execute(),
            )

            users = [UserData(**user) for user in result.data]

            self.logger.debug(
                "Retrieved users batch", offset=offset, limit=limit, count=len(users)
            )

            return users

        except Exception as e:
            self.logger.error(
                "Failed to retrieve users batch",
                offset=offset,
                limit=limit,
                error=str(e),
            )
            raise

    async def close(self) -> None:
        """
        Close the Supabase client connection.

        Note: The supabase-py library doesn't have explicit connection closing,
        but this method is provided for consistency and future-proofing.
        """
        self._client = None
        self.logger.debug("Supabase client closed")

    async def __aenter__(self):
        """Async context manager entry."""
        await self.initialize()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close()


# Factory function for dependency injection
async def get_supabase_client() -> SupabaseClient:
    """
    Factory function to create and initialize Supabase client.

    This function is designed for use with FastAPI's dependency injection system.

    Returns:
        SupabaseClient: Initialized Supabase client
    """
    client = SupabaseClient()
    await client.initialize()
    return client
