"""Recommendations endpoint router."""

import sentry_sdk
from fastapi import APIRouter, Depends, HTTPException, status

from app.core import get_logger
from app.dependencies.auth import get_current_user
from app.dependencies.rate_limiting import rate_limit
from app.models.recommendations import RecommendationsResponse
from app.services.recommendations import get_recommendations

router = APIRouter(prefix="/api", tags=["Recommendations"])
logger = get_logger("tropicaltalent.router.recommendations")


@router.get("/recommendations", response_model=RecommendationsResponse)
async def recommendations(
    current_user: dict = Depends(get_current_user),
    _rl: None = Depends(rate_limit),
) -> RecommendationsResponse:
    """
    Personalized user recommendations.

    Returns recommended users based on the user's own profile vector.
    Returns metadata including user_id, username, and avatar for each match.

    The user_id always comes from the verified JWT subject — it is never
    accepted from the caller (same rule as GET /search).
    """
    # The identity being recommended for comes from the verified token only.
    user_id = current_user.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    try:
        logger.info(
            "Recommendations endpoint called",
            user_id=user_id,
            authenticated_user=current_user.get("sub"),
        )

        user_id_clean = user_id.strip()
        logger.debug("Calling get_recommendations service", user_id=user_id_clean)
        result = await get_recommendations(user_id_clean)

        logger.info(
            "Recommendations retrieved successfully",
            user_id=user_id_clean,
            recommendations_count=len(result.recommendations) if result.recommendations else 0,
        )

        return result

    except HTTPException:
        raise
    except Exception as e:  # pylint: disable=broad-except
        # Catch any unexpected errors during recommendations process
        logger.error(
            "Error in recommendations endpoint",
            user_id=user_id,
            error=str(e),
            error_type=type(e).__name__,
        )
        # sentry_sdk.push_scope was deprecated in SDK 2.x (removed in the
        # next major); new_scope is its replacement.
        with sentry_sdk.new_scope() as scope:
            scope.set_extra("endpoint", "recommendations")
            scope.set_extra("user_id", user_id)
            scope.set_extra("authenticated_user", current_user.get("sub"))
            sentry_sdk.capture_exception(e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Recommendations failed",
        )
