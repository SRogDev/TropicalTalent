"""
Supabase service for opportunity and matching operations.

This module provides a clean interface for interacting with Supabase tables
related to opportunities and matching results, following FastAPI best practices.

Design Notes:
- Uses dependency injection pattern for testability
- Comprehensive error handling with structured logging
- Type-safe operations with Pydantic models
- Async/await for non-blocking database operations
"""

import asyncio
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from postgrest.exceptions import APIError as PostgrestAPIError
from supabase import Client as SupabaseClient

from app.core import LoggerMixin, get_settings
from app.models import (
    MatchedUser,
    MatchingMetadata,
    MatchingResult,
    OpportunityCreate,
    OpportunityStatus,
)


class SupabaseOpportunityService(LoggerMixin):
    """
    Service for managing opportunities in Supabase.

    Handles CRUD operations for opportunities table with proper error handling
    and logging.
    """

    def __init__(self, client: SupabaseClient):
        """
        Initialize the opportunity service.

        Args:
            client: Initialized Supabase client
        """
        self.client = client
        self.settings = get_settings()
        self.table_name = self.settings.opportunities_table

    async def create_opportunity(
        self, opportunity: OpportunityCreate, opportunity_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a new opportunity in Supabase.

        Args:
            opportunity: Opportunity data to create
            opportunity_id: Optional custom UUID (generates if not provided)

        Returns:
            Dict containing the created opportunity data

        Raises:
            Exception: If database operation fails
        """
        try:
            opp_id = opportunity_id or str(uuid4())

            data = {
                "id": opp_id,
                "description": opportunity.description,
                "payment_range": opportunity.payment_range,
                "status": OpportunityStatus.PENDING.value,
                "created_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat(),
                "metadata": {},
            }

            self.logger.info(
                "Creating opportunity",
                opportunity_id=opp_id,
                description_length=len(opportunity.description),
            )

            # Execute insert
            result = await asyncio.to_thread(
                self.client.table(self.table_name).insert(data).execute
            )

            self.logger.info("Opportunity created successfully", opportunity_id=opp_id)

            return result.data[0] if result.data else data

        except PostgrestAPIError as e:
            self.logger.error(
                "Failed to create opportunity",
                error=str(e),
                error_code=e.code if hasattr(e, "code") else None,
            )
            raise Exception(f"Database error creating opportunity: {e}")
        except Exception as e:
            self.logger.error(
                "Unexpected error creating opportunity", error=str(e), exc_info=True
            )
            raise

    async def get_opportunity(self, opportunity_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve an opportunity by ID.

        Args:
            opportunity_id: UUID of the opportunity

        Returns:
            Opportunity data or None if not found
        """
        try:
            result = await asyncio.to_thread(
                self.client.table(self.table_name)
                .select("*")
                .eq("id", opportunity_id)
                .single()
                .execute
            )

            return result.data if result.data else None

        except Exception as e:
            self.logger.error(
                "Error fetching opportunity",
                opportunity_id=opportunity_id,
                error=str(e),
            )
            return None

    async def update_opportunity_status(
        self,
        opportunity_id: str,
        status: OpportunityStatus,
        error_message: Optional[str] = None,
    ) -> bool:
        """
        Update the status of an opportunity.

        Args:
            opportunity_id: UUID of the opportunity
            status: New status
            error_message: Optional error message if status is FAILED

        Returns:
            True if update successful, False otherwise
        """
        try:
            update_data = {
                "status": status.value,
                "updated_at": datetime.utcnow().isoformat(),
            }

            if error_message and status == OpportunityStatus.FAILED:
                update_data["error_message"] = error_message

            self.logger.info(
                "Updating opportunity status",
                opportunity_id=opportunity_id,
                new_status=status.value,
            )

            result = await asyncio.to_thread(
                self.client.table(self.table_name)
                .update(update_data)
                .eq("id", opportunity_id)
                .execute
            )

            success = bool(result.data)

            if success:
                self.logger.info(
                    "Opportunity status updated",
                    opportunity_id=opportunity_id,
                    status=status.value,
                )
            else:
                self.logger.warning(
                    "Opportunity not found for status update",
                    opportunity_id=opportunity_id,
                )

            return success

        except Exception as e:
            self.logger.error(
                "Error updating opportunity status",
                opportunity_id=opportunity_id,
                error=str(e),
            )
            return False

    async def list_opportunities(
        self,
        status: Optional[OpportunityStatus] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """
        List opportunities with optional filtering.

        Args:
            status: Filter by status (optional)
            limit: Maximum number of results
            offset: Number of results to skip

        Returns:
            List of opportunities
        """
        try:
            query = self.client.table(self.table_name).select("*")

            if status:
                query = query.eq("status", status.value)

            result = await asyncio.to_thread(
                query.order("created_at", desc=True)
                .range(offset, offset + limit - 1)
                .execute
            )

            return result.data if result.data else []

        except Exception as e:
            self.logger.error("Error listing opportunities", error=str(e))
            return []

    # Alias for update_opportunity_status (for consistency with internal.py)
    async def update_status(
        self,
        opportunity_id: str,
        status: OpportunityStatus,
        error_message: Optional[str] = None,
    ) -> bool:
        """
        Alias for update_opportunity_status.

        Args:
            opportunity_id: UUID of the opportunity
            status: New status
            error_message: Optional error message if status is FAILED

        Returns:
            True if update successful, False otherwise
        """
        return await self.update_opportunity_status(
            opportunity_id=opportunity_id, status=status, error_message=error_message
        )

    async def save_matching_results(
        self, opportunity_id: str, matched_users: List[Dict[str, Any]]
    ) -> bool:
        """
        Save matching results for an opportunity.

        This method creates a record in the matching_results table
        with the list of matched users and their scores.

        Args:
            opportunity_id: UUID of the opportunity
            matched_users: List of matched users with scores

        Returns:
            True if save successful, False otherwise
        """
        try:
            # Limit to top 10 matches
            top_matches = matched_users[:10]

            data = {
                "opportunity_id": opportunity_id,
                "matched_users": top_matches,
                "total_matches": len(top_matches),
                "created_at": datetime.utcnow().isoformat(),
                "metadata": {},
            }

            self.logger.info(
                "Saving matching results",
                opportunity_id=opportunity_id,
                num_matches=len(top_matches),
            )

            # Use the matching service to save results
            # For now, we'll just insert directly
            result = await asyncio.to_thread(
                self.client.table(self.settings.matching_results_table)
                .insert(data)
                .execute
            )

            success = bool(result.data)

            if success:
                self.logger.info(
                    "Matching results saved", opportunity_id=opportunity_id
                )

            return success

        except Exception as e:
            self.logger.error(
                "Error saving matching results",
                opportunity_id=opportunity_id,
                error=str(e),
            )
            return False


class SupabaseMatchingService(LoggerMixin):
    """
    Service for managing matching results in Supabase.

    Handles storage and retrieval of user matching results for opportunities.
    """

    def __init__(self, client: SupabaseClient):
        """
        Initialize the matching service.

        Args:
            client: Initialized Supabase client
        """
        self.client = client
        self.settings = get_settings()
        self.table_name = self.settings.matching_results_table

    async def store_matching_result(
        self,
        opportunity_id: str,
        matched_users: List[MatchedUser],
        metadata: Optional[MatchingMetadata] = None,
    ) -> bool:
        """
        Store matching results for an opportunity.

        Args:
            opportunity_id: UUID of the opportunity
            matched_users: List of matched users (max 10)
            metadata: Optional matching process metadata

        Returns:
            True if storage successful, False otherwise
        """
        try:
            # Validate matched users count
            if len(matched_users) > 10:
                self.logger.warning(
                    "Too many matched users, truncating to 10", count=len(matched_users)
                )
                matched_users = matched_users[:10]

            # Convert to JSON-serializable format
            matched_users_data = [user.model_dump() for user in matched_users]
            metadata_data = metadata.model_dump() if metadata else {}

            data = {
                "opportunity_id": opportunity_id,
                "matched_users": matched_users_data,
                "matching_metadata": metadata_data,
                "created_at": datetime.utcnow().isoformat(),
            }

            self.logger.info(
                "Storing matching results",
                opportunity_id=opportunity_id,
                matched_count=len(matched_users),
            )

            # Upsert (insert or replace if exists)
            result = await asyncio.to_thread(
                self.client.table(self.table_name)
                .upsert(data, on_conflict="opportunity_id")
                .execute
            )

            success = bool(result.data)

            if success:
                self.logger.info(
                    "Matching results stored successfully",
                    opportunity_id=opportunity_id,
                )

            return success

        except Exception as e:
            self.logger.error(
                "Error storing matching results",
                opportunity_id=opportunity_id,
                error=str(e),
                exc_info=True,
            )
            return False

    async def get_matching_result(
        self, opportunity_id: str
    ) -> Optional[MatchingResult]:
        """
        Retrieve matching results for an opportunity.

        Args:
            opportunity_id: UUID of the opportunity

        Returns:
            MatchingResult or None if not found
        """
        try:
            result = await asyncio.to_thread(
                self.client.table(self.table_name)
                .select("*")
                .eq("opportunity_id", opportunity_id)
                .single()
                .execute
            )

            if not result.data:
                return None

            # Convert to MatchingResult model
            data = result.data
            matched_users = [MatchedUser(**user) for user in data["matched_users"]]
            metadata = (
                MatchingMetadata(**data["matching_metadata"])
                if data.get("matching_metadata")
                else None
            )

            return MatchingResult(
                opportunity_id=data["opportunity_id"],
                matched_users=matched_users,
                matching_metadata=metadata,
                created_at=data["created_at"],
            )

        except Exception as e:
            self.logger.error(
                "Error retrieving matching results",
                opportunity_id=opportunity_id,
                error=str(e),
            )
            return None

    async def delete_matching_result(self, opportunity_id: str) -> bool:
        """
        Delete matching results for an opportunity.

        Args:
            opportunity_id: UUID of the opportunity

        Returns:
            True if deletion successful, False otherwise
        """
        try:
            self.logger.info("Deleting matching results", opportunity_id=opportunity_id)

            result = await asyncio.to_thread(
                self.client.table(self.table_name)
                .delete()
                .eq("opportunity_id", opportunity_id)
                .execute
            )

            return bool(result.data)

        except Exception as e:
            self.logger.error(
                "Error deleting matching results",
                opportunity_id=opportunity_id,
                error=str(e),
            )
            return False


# ============================================================================
# Convenience functions for dependency injection
# ============================================================================

_opportunity_service: Optional[SupabaseOpportunityService] = None
_matching_service: Optional[SupabaseMatchingService] = None


def get_opportunity_service(client: SupabaseClient) -> SupabaseOpportunityService:
    """
    Get or create opportunity service instance.

    Args:
        client: Supabase client

    Returns:
        SupabaseOpportunityService instance
    """
    return SupabaseOpportunityService(client)


def get_matching_service(client: SupabaseClient) -> SupabaseMatchingService:
    """
    Get or create matching service instance.

    Args:
        client: Supabase client

    Returns:
        SupabaseMatchingService instance
    """
    return SupabaseMatchingService(client)
