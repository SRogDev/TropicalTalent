"""Search endpoint router."""

import sentry_sdk
from fastapi import APIRouter, Depends, HTTPException, status

from app.core import get_logger
from app.dependencies.rate_limiting import rate_limit
from app.models.search import SearchRequest, SearchResponse
from app.services.search import search_users

router = APIRouter(tags=["Internal - Agent Tools"])
logger = get_logger("tropicaltalent.router.search")


@router.get("/search", response_model=SearchResponse)
async def search(
    user_id: str, query: str, _rl: None = Depends(rate_limit)
) -> SearchResponse:
    """
    Semantic user search.

    Searches for users similar to the query using Google embeddings.
    Returns metadata including user_id, username, and avatar for each match.
    """
    try:
        logger.info("Search endpoint called", user_id=user_id, query_length=len(query) if query else 0)

        # Validate parameters
        if not user_id or not user_id.strip():
            logger.warning("Invalid or missing user_id in search request")
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid user_id")

        if not query or not query.strip():
            logger.warning("Invalid or missing query in search request", user_id=user_id)
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Query is required")

        if len(query.strip()) < 3:
            logger.warning("Query too short", user_id=user_id, query_length=len(query.strip()))
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Query must be at least 3 characters")

        if len(query) > 500:
            logger.warning("Query too long", user_id=user_id, query_length=len(query))
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Query must be 500 characters or less")

        user_id_clean = user_id.strip()
        query_clean = query.strip()

        logger.debug("Calling search_users service", user_id=user_id_clean, query=query_clean[:50])
        request = SearchRequest(user_id=user_id_clean, query=query_clean)
        result = await search_users(request)

        logger.info(
            "Search completed successfully",
            user_id=user_id_clean,
            results_count=len(result.results) if result.results else 0,
        )

        return result

    except HTTPException:
        raise
    except Exception as e:  # pylint: disable=broad-except
        # Catch any unexpected errors during search process
        logger.error(
            "Error in search endpoint",
            user_id=user_id,
            query_length=len(query) if query else 0,
            error=str(e),
            error_type=type(e).__name__,
        )
        with sentry_sdk.push_scope() as scope:
            scope.set_extra("endpoint", "search")
            scope.set_extra("user_id", user_id)
            scope.set_extra("query_length", len(query) if query else 0)
            sentry_sdk.capture_exception(e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Search failed",
        )
