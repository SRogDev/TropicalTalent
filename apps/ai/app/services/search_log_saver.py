"""Search logs persistence service."""

import asyncio
import json
from typing import List, Optional
from uuid import UUID


from app.core.database import get_supabase_client
from app.core.logging import get_logger

logger = get_logger("tropicaltalent.search_log_saver")


async def save_search_log(
    user_id: str,
    query: str,
    enriched_query: str,
    results: List[str],
    query_vector: List[float],
    log_id: str,
    similarity_score: float,
    original_query_top_score: Optional[float] = None,
) -> Optional[str]:
    """
    Save search log with query vector to PostgreSQL for analytics and recommendations.

    Stores the search query, enriched query, results, and the embedding vector
    for later use in personalized recommendations.

    Args:
        user_id: UUID of the user performing the search
        query: Original search query from user
        enriched_query: AI-enriched version of the query
        results: List of user IDs returned in search results
        query_vector: Embedding vector of the enriched query
        log_id: Pre-generated UUID for frontend traceability
        similarity_score: Top Pinecone cosine score from enriched query
        original_query_top_score: Top score from original (non-enriched) query.
            Used to measure whether enrichment improves or worsens results.

    Returns:
        UUID string of the created search log record, or None if failed
    """
    try:
        # Await the async factory function
        supabase = await get_supabase_client()

        # Prepare data for insertion
        log_data = {
            "id": log_id,              # Pre-generated so caller can reference it before INSERT
            "user_id": user_id,
            "content": enriched_query,  # Store enriched query for better context
            "original_query": query,    # Store original query for enrichment analysis
            "results": results,          # Array of user IDs
            "embedding": query_vector,   # Embedding vector
            "similarity_score": similarity_score,  # Top Pinecone cosine score at search time
        }

        # Track enrichment effectiveness: compare enriched vs original query scores
        if original_query_top_score is not None:
            log_data["original_query_top_score"] = original_query_top_score

        logger.info(
            "Saving search log",
            log_id=log_id,
            user_id=user_id,
            results_count=len(results),
            similarity_score=round(similarity_score, 4),
        )

        # Insert into search_logs table using run_in_executor for sync supabase-py library
        response = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: supabase._client.table("search_logs").insert(log_data).execute(),
        )

        if response.data and len(response.data) > 0:
            log_id = response.data[0]["id"]
            logger.info("Search log saved successfully", log_id=log_id, user_id=user_id)
            return log_id
        else:
            logger.warning("Search log insert returned no data", user_id=user_id)
            return None

    except Exception as e:
        logger.error(
            "Failed to save search log",
            error=str(e),
            error_type=type(e).__name__,
            user_id=user_id,
        )
        # Don't fail the search if logging fails
        return None


async def get_recent_search_vectors(user_id: str, limit: int = 21) -> List[List[float]]:
    """
    Retrieve recent search vectors for a user.

    Used for calculating average search preferences for personalized recommendations.
    21 is the maximum, but will work with any number from 1-21 without errors.

    Args:
        user_id: UUID of the user
        limit: Maximum number of recent searches to retrieve (default: 21, max: 21)

    Returns:
        List of embedding vectors from recent searches (0-21 vectors)

    Example:
        >>> vectors = await get_recent_search_vectors(
        ...     user_id="123e4567-e89b-12d3-a456-426614174000",
        ...     limit=21
        ... )
        >>> print(f"Retrieved {len(vectors)} search vectors")
    """
    try:
        logger.info("Fetching recent search vectors", user_id=user_id, limit=limit)

        # Await the async factory function
        supabase = await get_supabase_client()

        # Query last N search logs for user, ordered by most recent
        # Using run_in_executor because supabase-py is synchronous
        response = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: supabase._client.table("search_logs")
            .select("embedding")
            .eq("user_id", user_id)
            .not_.is_("embedding", "null")
            .order("created_at", desc=True)
            .limit(limit)
            .execute(),
        )

        if not response.data:
            logger.info("No search history found for user", user_id=user_id)
            return []

        # Extract embedding vectors from response
       
        raw_vectors = [log["embedding"] for log in response.data if log.get("embedding")]

        # Parse JSON strings to float lists if needed
        vectors = []
        for v in raw_vectors:
            if isinstance(v, str):
                vectors.append(json.loads(v))
            else:
                vectors.append(v)

        logger.info("Retrieved search vectors", user_id=user_id, count=len(vectors))

        return vectors

    except Exception as e:
        logger.error(
            "Failed to retrieve search vectors",
            error=str(e),
            error_type=type(e).__name__,
            user_id=user_id,
        )
        return []
