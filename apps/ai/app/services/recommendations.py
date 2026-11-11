"""
Recommendations service orchestrator.

Generates personalized recommendations based on user's search history.
Calculates average vector from last 21 search logs and queries Pinecone.
"""

from datetime import datetime

import numpy as np

from app.core import capture_exception, get_logger
from app.core.pinecone_client import get_pinecone_index
from app.models.recommendations import RecommendationsResponse, UserRecommendation
from app.services.search_log_saver import get_recent_search_vectors
from app.core.database import get_supabase_client

logger = get_logger("tropicaltalent.recommendations")


async def get_recommendations(user_id: str, limit: int = 7) -> RecommendationsResponse:
    """
    Orchestrate personalized recommendations workflow.

    Workflow:
    1. Fetch last 21 search vectors from search_logs (search_log_saver service)
    2. Calculate average vector using numpy
    3. Query Pinecone with average vector
    4. Return top 7 recommendations

    Args:
        user_id: UUID of the user
        limit: Maximum number of recommendations (default: 7)

    Returns:
        RecommendationsResponse with personalized recommendations

    Raises:
        Exception: If recommendation generation fails
    """
    start_time = datetime.utcnow()

    try:
        logger.info(
            "Starting recommendations orchestration", user_id=user_id, limit=limit
        )

        # Step 1: Fetch recent search vectors (up to 21)
        search_vectors = await get_recent_search_vectors(user_id, limit=21)

        if not search_vectors:
            logger.info(
                "No search history found, returning empty recommendations",
                user_id=user_id,
            )
            return RecommendationsResponse(
                user_id=user_id,
                recommendations=[],
                total_recommendations=0,
                based_on_searches=0,
            )

        logger.info(
            "Retrieved search vectors",
            user_id=user_id,
            vectors_count=len(search_vectors),
        )

        # Step 2: Calculate average vector
        # Convert list of vectors to numpy array for efficient computation
        vectors_array = np.array(search_vectors)
        average_vector = np.mean(vectors_array, axis=0).tolist()

        logger.info(
            "Calculated average search vector",
            user_id=user_id,
            dimension=len(average_vector),
            based_on_searches=len(search_vectors),
        )

        # Step 3: Query Pinecone with average vector
        index = get_pinecone_index()  # FastAPI dependency injection pattern
        results = index.query(
            vector=average_vector,
            top_k=limit + 1,  # +1 to account for potential self-match
            include_metadata=True,
            filter={"user_id": {"$ne": user_id}},  # Exclude self
        )

        logger.info("Pinecone query complete", matches_count=len(results.matches))

        # Step 4: Convert to recommendations with metadata
        recommendations = []
        
        # Enrich with fresh Supabase data
        try:
            supabase = await get_supabase_client()
            match_user_ids = [m.metadata.get("user_id", m.id) for m in results.matches]
            db_result = supabase._client.table("users").select(
                "id, username, avatar, creative_data(passion)"
            ).in_("id", match_user_ids).execute()
            db_map = {p["id"]: p for p in (db_result.data or [])}
        except Exception as e:
            logger.warning("Failed to enrich recommendations from Supabase", error=str(e))
            db_map = {}
        
        for match in results.matches:
            metadata = match.metadata or {}
            uid = metadata.get("user_id", match.id)
            db = db_map.get(uid, {})
            creative = db.get("creative_data") or {}
            recommendations.append(
                UserRecommendation(
                    user_id=uid,
                    username=db.get("username") or metadata.get("username", ""),
                    avatar=db.get("avatar") or metadata.get("avatar") or None,
                    bio=metadata.get("bio"),
                    tags=metadata.get("tags", []),
                    passion=creative.get("passion") or metadata.get("passion"),
                    metadata={
                        "user_id": uid,
                        "username": db.get("username") or metadata.get("username", ""),
                        "avatar": db.get("avatar") or metadata.get("avatar", ""),
                    },
                )
            )
        

        # Limit to requested number (top 7)
        recommendations = recommendations[:limit]

        duration = int((datetime.utcnow() - start_time).total_seconds() * 1000)
        logger.info(
            "Recommendations orchestration complete",
            user_id=user_id,
            recommendations_count=len(recommendations),
            based_on_searches=len(search_vectors),
            duration_ms=duration,
        )

        return RecommendationsResponse(
            user_id=user_id,
            recommendations=recommendations,
            total_recommendations=len(recommendations),
            based_on_searches=len(search_vectors),
        )

    except Exception as e:  # pylint: disable=broad-except
        # Catch any unexpected errors during recommendations orchestration
        capture_exception(e, {"user_id": user_id, "operation": "recommendations"})
        logger.error(
            "Recommendations orchestration failed",
            user_id=user_id,
            error=str(e),
            error_type=type(e).__name__,
        )
        raise
