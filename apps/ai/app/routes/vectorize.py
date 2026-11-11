"""Vectorize endpoint router."""

import json
from typing import Optional

import sentry_sdk
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.core import get_logger
from app.core import get_user_vector_cache
from app.core.pinecone_client import get_pinecone_index
from app.dependencies.auth import get_current_user
from app.dependencies.rate_limiting import rate_limit
from app.models.vectorize import (
    ProfileData,
    VectorizeProfileRequest,
    VectorizeProfileResponse,
)
from app.services.vectorize import vectorize_profile

router = APIRouter(prefix="/api", tags=["Vectorize"])
logger = get_logger("tropicaltalent.router.vectorize")


@router.post("/vectorize", response_model=VectorizeProfileResponse)
async def vectorize(
    user_id: str = Form(None),
    profile_json: str = Form(None),
    youtube_url: Optional[str] = Form(None),
    image_file: Optional[UploadFile] = File(None),
    pdf_file: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user),
    _rl: None = Depends(rate_limit),
) -> VectorizeProfileResponse:
    """
    Vectorize user profile with optional YouTube video and image.

    This endpoint accepts:
    - user_id: User identifier
    - profile_json: JSON string with profile data (username, avatar, bio, tags, passion, location_id)
    - youtube_url: Optional YouTube video URL to analyze
    - image_file: Optional image file to analyze
    - pdf_file: Optional PDF file (portfolio/backstory) to analyze

    The service will:
    1. Fetch location details from database (if location_id provided)
    2. Analyze YouTube video (if provided)
    3. Extract tags from image (if provided)
    4. Extract tags from PDF (if provided)
    5. Generate weighted embeddings
    6. Store in Pinecone with metadata
    """
    try:
        logger.info(
            "Vectorize endpoint called",
            user_id=user_id,
            authenticated_user=current_user.get("sub"),
            has_image=image_file is not None,
            has_pdf=pdf_file is not None,
            has_youtube=youtube_url is not None,
        )

        # Validate required fields
        if not user_id:
            logger.warning("Missing user_id in vectorize request")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="user_id is required"
            )

        if not profile_json:
            logger.warning("Missing profile_json in vectorize request", user_id=user_id)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="profile_json is required"
            )

        # Parse profile JSON
        try:
            logger.debug("Parsing profile JSON", user_id=user_id)
            profile_dict = json.loads(profile_json)
            profile = ProfileData(**profile_dict)
            logger.debug("Profile JSON parsed successfully", user_id=user_id)
        except json.JSONDecodeError as e:
            logger.error(
                "Invalid JSON in profile_json",
                user_id=user_id,
                error=str(e),
                json_sample=profile_json[:100],
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid profile JSON: {str(e)}",
            )
        except (ValueError, TypeError) as e:
            logger.error(
                "Invalid profile data validation",
                user_id=user_id,
                error=str(e),
                error_type=type(e).__name__,
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid profile data: {str(e)}",
            )

        # Create request object
        logger.debug("Creating VectorizeProfileRequest", user_id=user_id)
        # Use youtube_url from Form if provided, otherwise use from profile_dict['video'] as fallback
        final_youtube_url = youtube_url
        if not final_youtube_url and "video" in profile_dict:
            final_youtube_url = profile_dict["video"]
            logger.debug("Using youtube_url from userData.video fallback", user_id=user_id)

        request = VectorizeProfileRequest(
            user_id=user_id,
            profile=profile,
            youtube_url=final_youtube_url,
        )

        # Call vectorization service
        logger.info("Calling vectorize_profile service", user_id=user_id)
        result = await vectorize_profile(request, image_file, pdf_file)

        if result.success:
            logger.info(
                "Vectorization successful",
                user_id=user_id,
                vector_id=result.vector_id,
            )
        else:
            logger.warning(
                "Vectorization returned non-success",
                user_id=user_id,
                message=result.message,
            )

        return result

    except HTTPException:
        raise
    except Exception as e:  # pylint: disable=broad-except
        # Catch any unexpected errors during vectorization process
        logger.error(
            "Unexpected error in vectorize endpoint",
            user_id=user_id,
            error=str(e),
            error_type=type(e).__name__,
        )
        with sentry_sdk.push_scope() as scope:
            scope.set_extra("endpoint", "vectorize")
            scope.set_extra("user_id", user_id)
            scope.set_extra("authenticated_user", current_user.get("sub"))
            sentry_sdk.capture_exception(e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Vectorization failed",
        )


@router.delete("/vectorize/{user_id}", status_code=status.HTTP_200_OK)
async def delete_vector(
    user_id: str,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """
    Delete a user's Pinecone vector and invalidate their Redis cache.

    Called when a user deletes their account to ensure full data removal.
    The caller must be the owner of the vector (JWT sub must match user_id).
    """
    authenticated_user_id = current_user.get("sub")

    # Users can only delete their own vector
    if authenticated_user_id != user_id:
        logger.warning(
            "Unauthorized vector delete attempt",
            requested_user_id=user_id,
            authenticated_user=authenticated_user_id,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot delete another user's vector",
        )

    try:
        logger.info("Deleting Pinecone vector for user", user_id=user_id)

        vector_id = f"user-{user_id}"
        index = get_pinecone_index()
        index.delete(ids=[vector_id])

        # Invalidate Redis cache
        cache = get_user_vector_cache()
        cache.invalidate_user(user_id)

        logger.info("Vector deleted successfully", user_id=user_id, vector_id=vector_id)
        return {"success": True, "deleted_vector": vector_id}

    except HTTPException:
        raise
    except Exception as e:  # pylint: disable=broad-except
        logger.error(
            "Error deleting Pinecone vector",
            user_id=user_id,
            error=str(e),
        )
        with sentry_sdk.push_scope() as scope:
            scope.set_extra("endpoint", "delete_vector")
            scope.set_extra("user_id", user_id)
            sentry_sdk.capture_exception(e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete vector",
        )
