"""
Profile vectorization orchestration service.

This service orchestrates the complete vectorization workflow by coordinating
multiple specialized services:
- Text processing (normalization, lemmatization)
- Image analysis (tag extraction)
- YouTube analysis (video summary)
- Embedding generation
- Vector storage (Pinecone)

The service follows the Service Orchestration Pattern where this module
only contains coordination logic and delegates actual work to specialized services.
"""

from typing import List, Optional

import sentry_sdk
from fastapi import UploadFile
from supabase import create_client

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.pinecone_client import get_pinecone_index
from app.models.vectorize import VectorizeProfileRequest, VectorizeProfileResponse
from app.services.embedding_service import generate_embedding
from app.services.image_analyzer import analyze_image
from app.services.pdf_analyzer import analyze_pdf
from app.services.city_normalizer import normalize_city
from app.services.sparse_encoder import build_sparse_text_for_profile, encode_sparse
from app.services.text_processor import (
    lemmatize_texts_batch,
    normalize_text,
)
from app.services.youtube_analyzer import analyze_youtube_video

logger = get_logger("tropicaltalent.vectorize")


async def get_location_string(location_id: Optional[int]) -> str:
    """
    Fetch location string from Supabase locations table.

    Args:
        location_id: ID of the location to fetch

    Returns:
        Location string formatted as "City, Country" or empty string if not found
    """
    if not location_id:
        return ""

    try:
        settings = get_settings()
        supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)

        response = supabase.table("locations").select("city, county, country").eq("id", location_id).single().execute()

        if response.data:
            city = response.data.get("city", "")
            country = response.data.get("country", "")

            # Format as "City, Country" or just "Country" if no city
            if city and country:
                return f"{city}, {country}"
            elif city:
                return city
            elif country:
                return country

        return ""

    except Exception as e:  # pylint: disable=broad-except
        logger.warning(f"Failed to fetch location {location_id}: {str(e)}")
        return ""


async def combine_sources_with_prompt(
    profile_text: str,
    image_tags: Optional[List[str]] = None,
    video_summary: Optional[str] = None,
    backstory_tags: Optional[List[str]] = None,
    passion: Optional[str] = None,
    tags: Optional[List[str]] = None,
) -> str:
    """
    Combine all data sources into a weighted embedding text.

    Weight strategy (higher weight = more influence on the vector):
      passion + tags   × 3  — defines role & skills, most searched
      image_tags       × 2  — visual/aesthetic profile, highly relevant
      bio, location    × 1  — context
      video_summary    × 1  — supplementary
      backstory_tags   × 1  — background

    Implemented via repetition (model gives more weight to repeated tokens)
    and by placing high-priority fields at the top of the prompt
    (position bias in embeddings).

    Args:
        profile_text:   Already lemmatised full profile string (bio+tags+passion+location).
        image_tags:     Tags from image analysis.
        video_summary:  Summary from YouTube transcript.
        backstory_tags: Tags from backstory PDF.
        passion:        Raw passion/role string for repetition boost.
        tags:           Raw skills/tag list for repetition boost.

    Returns:
        Combined weighted text ready for embedding generation.
    """
    parts: list[str] = []

    # ------------------------------------------------------------------ #
    # HIGH WEIGHT (×3): passion + tags placed at top, repeated three times  #
    # ------------------------------------------------------------------ #
    tags_str = ", ".join(tags) if tags else ""
    if passion or tags_str:
        for _ in range(3):
            if passion and tags_str:
                parts.append(f"Role and specialization: {passion}. Core skills: {tags_str}.")
            elif passion:
                parts.append(f"Creative role: {passion}.")
            else:
                parts.append(f"Skills: {tags_str}.")

    # ------------------------------------------------------------------ #
    # HIGH WEIGHT (×2): image tags                                         #
    # ------------------------------------------------------------------ #
    if image_tags:
        image_str = ", ".join(image_tags)
        parts.append(f"Visual portfolio style: {image_str}.")
        parts.append(f"Aesthetic and visual identity: {image_str}.")

    # ------------------------------------------------------------------ #
    # NORMAL WEIGHT (×1): remaining fields                                 #
    # ------------------------------------------------------------------ #
    if profile_text:
        parts.append(f"Full profile: {profile_text}")
    if video_summary:
        parts.append(f"Video work summary: {video_summary}")
    if backstory_tags:
        parts.append(f"Background and experience: {', '.join(backstory_tags)}")

    combined_text = "\n".join(parts)

    logger.info(
        "Combined weighted embedding text",
        sources=len([p for p in [profile_text, image_tags, video_summary, backstory_tags] if p]),
        passion_weight=3 if (passion or tags) else 0,
        image_weight=2 if image_tags else 0,
        total_chars=len(combined_text),
    )

    return combined_text



async def vectorize_profile(
    request: VectorizeProfileRequest,
    image_file: Optional[UploadFile] = None,
    pdf_file: Optional[UploadFile] = None,
) -> VectorizeProfileResponse:
    """
    Orchestrate complete profile vectorization workflow.

    This service acts as an orchestrator that coordinates multiple specialized services
    to create a comprehensive user profile embedding. It does NOT contain business logic
    itself, but delegates to domain-specific services.

    Workflow (Service Orchestration Pattern):
    1. Convert profile object to string (internal)
    2. Call image_analyzer service to extract tags
    3. Call youtube_analyzer service to extract summary
    4. Call text_processor service to normalize text
    5. Call text_processor service to lemmatize text
    6. Combine all sources with structured prompt (internal)
    7. Call embedding_service to generate vector
    8. Store in Pinecone (internal)

    Args:
        request: Profile data to vectorize
        image_file: Optional image file for analysis

    Returns:
        VectorizeProfileResponse with success status and metadata

    Raises:
        Exception: If any service in the pipeline fails
    """
    try:
        logger.info(
            "Starting profile vectorization orchestration", user_id=request.user_id
        )

        # Step 0a: Fetch existing vector metadata from Pinecone (cached tags fallback)
        index = get_pinecone_index()
        vector_id = f"user-{request.user_id}"
        cached_metadata = {}

        try:
            existing = index.fetch(ids=[vector_id])
            if existing.vectors and vector_id in existing.vectors:
                cached_metadata = existing.vectors[vector_id].metadata or {}
                logger.info(
                    "Existing vector found, cached metadata available",
                    user_id=request.user_id,
                    has_cached_image_tags=bool(cached_metadata.get("image_tags")),
                    has_cached_backstory_tags=bool(cached_metadata.get("backstory_tags")),
                    has_cached_video_summary=bool(cached_metadata.get("video_summary")),
                )
            else:
                logger.info("No existing vector found, fresh vectorization", user_id=request.user_id)
        except Exception as e:  # pylint: disable=broad-except
            logger.warning(f"Failed to fetch existing vector: {str(e)}", user_id=request.user_id)

        # Step 0b: Fetch location string — use DB lookup when location_id is set,
        # otherwise fall back to the pre-resolved string sent by the webhook flow.
        if request.profile.location_id:
            location_string = await get_location_string(request.profile.location_id)
        else:
            location_string = request.profile.location or ""
        logger.info(f"Location resolved: {location_string or 'No location'}")

        # Step 1: Convert profile object to string
        profile_dict = {
            "username": request.profile.username,
            "bio": request.profile.bio or "",
            "tags": request.profile.tags or [],
            "passion": request.profile.passion or "",
            "location": location_string,
        }

        # Create structured profile text
        profile_parts = []
        if profile_dict["username"]:
            profile_parts.append(f"Username: {profile_dict['username']}")
        if profile_dict["bio"]:
            profile_parts.append(f"Bio: {profile_dict['bio']}")
        if profile_dict["tags"]:
            profile_parts.append(f"Skills/Tags: {', '.join(profile_dict['tags'])}")
        if profile_dict["passion"]:
            profile_parts.append(f"Passion: {profile_dict['passion']}")
        if profile_dict["location"]:
            profile_parts.append(f"Location: {profile_dict['location']}")

        profile_text = " ".join(profile_parts)

        if not profile_text.strip():
            return VectorizeProfileResponse(
                user_id=request.user_id,
                vector_id="",
                success=False,
                message="No content to vectorize",
            )

        logger.info(f"Profile text created: {len(profile_text)} characters")

        # Step 2: Image tags - analyze new file or use cached from Pinecone
        image_tags = None
        if image_file:
            logger.info("Calling image_analyzer service (new image)", user_id=request.user_id)
            image_tags = await analyze_image(image_file)
            if image_tags:
                logger.info(
                    "Image analysis complete",
                    tags_count=len(image_tags),
                    user_id=request.user_id,
                )
        elif cached_metadata.get("image_tags"):
            image_tags = cached_metadata["image_tags"]
            logger.info(
                "Using cached image tags from Pinecone",
                tags_count=len(image_tags),
                user_id=request.user_id,
            )

        # Step 2b: Backstory tags - analyze new file or use cached from Pinecone
        backstory_tags = None
        if pdf_file:
            logger.info("Calling pdf_analyzer service (new PDF)", user_id=request.user_id)
            backstory_tags = await analyze_pdf(pdf_file)
            if backstory_tags:
                logger.info(
                    "Backstory PDF analysis complete",
                    tags_count=len(backstory_tags),
                    user_id=request.user_id,
                )
        elif cached_metadata.get("backstory_tags"):
            backstory_tags = cached_metadata["backstory_tags"]
            logger.info(
                "Using cached backstory tags from Pinecone",
                tags_count=len(backstory_tags),
                user_id=request.user_id,
            )

        # Step 3: Video summary - analyze new URL or use cached from Pinecone
        video_summary = None
        if request.youtube_url:
            # Only re-analyze if URL is different from cached one
            cached_video_url = cached_metadata.get("youtube_url")
            if cached_video_url == request.youtube_url and cached_metadata.get("video_summary"):
                # Same URL as before, use cached summary
                video_summary = cached_metadata["video_summary"]
                logger.info(
                    "Video URL unchanged, using cached summary from Pinecone",
                    summary_length=len(video_summary),
                    user_id=request.user_id,
                )
            else:
                # New URL or no cache, analyze it
                logger.info("Calling youtube_analyzer service (new video URL)", user_id=request.user_id)
                video_summary = await analyze_youtube_video(request.youtube_url)
                if video_summary:
                    logger.info(
                        "Video analysis complete",
                        summary_length=len(video_summary),
                        user_id=request.user_id,
                    )
        elif cached_metadata.get("video_summary"):
            # No URL provided, but we have cached summary from before
            video_summary = cached_metadata["video_summary"]
            logger.info(
                "Using cached video summary from Pinecone",
                summary_length=len(video_summary),
                user_id=request.user_id,
            )

        # Step 4: Call text_processor service to normalize all text sources
        logger.info("Calling text_processor service for normalization")
        normalized_profile = normalize_text(profile_text)

        normalized_image_tags = None
        if image_tags:
            # Normalize each tag separately using text_processor service
            normalized_image_tags = [normalize_text(tag) for tag in image_tags]

        normalized_video = None
        if video_summary:
            normalized_video = normalize_text(video_summary)

        normalized_backstory_tags = None
        if backstory_tags:
            normalized_backstory_tags = [normalize_text(tag) for tag in backstory_tags]

        logger.info("Text normalization complete for all sources")

        # Step 5: Batch lemmatize ALL content in a single API call for efficiency
        logger.info("Calling text_processor service for batch lemmatization")

        # Collect all texts to lemmatize in one batch
        texts_to_lemmatize = [normalized_profile]  # Always include profile
        text_indices = {"profile": 0}  # Track which index corresponds to what
        current_index = 1

        if normalized_image_tags:
            text_indices["image_tags_start"] = current_index
            text_indices["image_tags_end"] = current_index + len(normalized_image_tags)
            texts_to_lemmatize.extend(normalized_image_tags)
            current_index += len(normalized_image_tags)

        if normalized_backstory_tags:
            text_indices["backstory_tags_start"] = current_index
            text_indices["backstory_tags_end"] = current_index + len(
                normalized_backstory_tags
            )
            texts_to_lemmatize.extend(normalized_backstory_tags)
            current_index += len(normalized_backstory_tags)

        if normalized_video:
            text_indices["video"] = current_index
            texts_to_lemmatize.append(normalized_video)
            current_index += 1

        # Single batch call to lemmatize everything
        lemmatized_all = await lemmatize_texts_batch(texts_to_lemmatize)
        logger.info(
            f"Batch lemmatization complete: {len(texts_to_lemmatize)} texts in 1 API call"
        )

        # Extract results from batch
        lemmatized_profile = lemmatized_all[text_indices["profile"]]
        logger.info("Profile lemmatization complete", chars=len(lemmatized_profile))

        lemmatized_image_tags = None
        if "image_tags_start" in text_indices:
            start = text_indices["image_tags_start"]
            end = text_indices["image_tags_end"]
            lemmatized_image_tags = lemmatized_all[start:end]
            logger.info(
                "Image tags lemmatization complete",
                tags_count=len(lemmatized_image_tags),
            )

        lemmatized_backstory_tags = None
        if "backstory_tags_start" in text_indices:
            start = text_indices["backstory_tags_start"]
            end = text_indices["backstory_tags_end"]
            lemmatized_backstory_tags = lemmatized_all[start:end]
            logger.info(
                "Backstory tags lemmatization complete",
                tags_count=len(lemmatized_backstory_tags),
            )

        lemmatized_video = None
        if "video" in text_indices:
            lemmatized_video = lemmatized_all[text_indices["video"]]
            logger.info("Video lemmatization complete", chars=len(lemmatized_video))

        # Step 6: Combine all sources using structured prompt
        logger.info("Combining all sources with structured prompt")
        combined_text = await combine_sources_with_prompt(
            profile_text=lemmatized_profile,
            image_tags=lemmatized_image_tags,
            video_summary=lemmatized_video,
            backstory_tags=lemmatized_backstory_tags,
            passion=request.profile.passion,
            tags=request.profile.tags,
        )

        logger.info(f"Combined text ready: {len(combined_text)} characters")

        # Step 7: Generate dense embedding + sparse vector for hybrid search
        logger.info("Calling embedding_service to generate dense vector")
        final_embedding = await generate_embedding(combined_text)

        if not final_embedding:
            return VectorizeProfileResponse(
                user_id=request.user_id,
                vector_id="",
                success=False,
                message="Failed to generate embedding from combined text",
            )

        # Generate sparse vector from profile fields (BM25-style keyword matching)
        sparse_text = build_sparse_text_for_profile(
            profile_text=lemmatized_profile,
            tags=request.profile.tags,
            passion=request.profile.passion,
            image_tags=image_tags,
            backstory_tags=backstory_tags,
            video_summary=video_summary,
        )
        sparse_values = encode_sparse(sparse_text)

        logger.info(
            "Embedding generation complete (dense + sparse)",
            dense_dimension=len(final_embedding),
            sparse_indices=len(sparse_values.get("indices", [])),
            user_id=request.user_id,
        )

        # Step 8: Store vector in Pinecone with metadata (including extracted tags for cache)
        # Extract city separately for exact metadata filtering (e.g. "London" from "London, UK")
        # Normalize city so aliases match between search-time intent and vectorization-time metadata
        raw_city = location_string.split(",")[0].strip() if location_string else ""
        city = normalize_city(raw_city) if raw_city else ""

        metadata = {
            "user_id": request.user_id,
            "username": request.profile.username,
            "avatar": request.profile.avatar or "",
            "bio": request.profile.bio or "",
            "tags": request.profile.tags or [],
            "passion": request.profile.passion or "",
            "location": location_string,
            "city": city,
            "has_video": video_summary is not None and len(video_summary) > 0,
            "has_backstory": backstory_tags is not None and len(backstory_tags) > 0,
            "image_tags": image_tags or [],
            "backstory_tags": backstory_tags or [],
            "video_summary": video_summary or "",
            "youtube_url": request.youtube_url or "",
        }

        logger.info("Storing vector in Pinecone (hybrid: dense + sparse)", user_id=request.user_id)

        upsert_vector = {
            "id": vector_id,
            "values": final_embedding,
            "metadata": metadata,
        }

        # Include sparse values for hybrid search if available
        if sparse_values.get("indices"):
            upsert_vector["sparse_values"] = sparse_values

        index.upsert(vectors=[upsert_vector])

        logger.info(
            "Vectorization orchestration complete - profile stored successfully",
            user_id=request.user_id,
            vector_id=vector_id,
        )

        return VectorizeProfileResponse(
            user_id=request.user_id,
            vector_id=f"user-{request.user_id}",
            success=True,
            message="Profile vectorized successfully",
            video_summary=video_summary,
            image_tags=image_tags,
            backstory_tags=backstory_tags,
        )

    except Exception as e:  # pylint: disable=broad-except
        # Catch any unexpected errors during vectorization orchestration
        sentry_sdk.capture_exception(e)
        logger.error(
            f"Vectorization failed for user {request.user_id}",
            error=str(e),
            error_type=type(e).__name__,
        )
        return VectorizeProfileResponse(
            user_id=request.user_id,
            vector_id="",
            success=False,
            message=f"Vectorization failed: {str(e)}",
        )
