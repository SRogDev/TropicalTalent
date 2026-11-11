"""
Search service orchestrator.

Coordinates search workflow by delegating to specialized services:
- Intent extraction (city/username/passion detection)
- Query enrichment (AI-powered query expansion, intent-aware)
- Embedding generation
- Vector search (Pinecone) with dynamic metadata filters + graceful fallback
- Gemini reranking: selects the 1-3 best candidates from up to 15 matches
- Search log persistence
"""

import asyncio
import json
from datetime import datetime
from uuid import uuid4

from app.core import capture_exception, get_logger, get_user_vector_cache
from app.core.pinecone_client import get_pinecone_index
from app.core.search_cache import get_search_cache, set_search_cache
from app.models.search import SearchRequest, SearchResponse, UserSearchResult
from app.services.embedding_service import generate_embedding
from app.services.intent_extractor import SearchIntent, extract_search_intent
from app.services.query_enricher import enrich_search_query, get_gemini_reranking_model
from app.services.search_log_saver import save_search_log
from app.services.sparse_encoder import encode_sparse, hybrid_score_norm

logger = get_logger("tropicaltalent.search")

# Fetch up to 15 candidates from Pinecone — Gemini reranks down to 1-3.
_TOP_K = 15
_MAX_RESULTS = 3


def _build_pinecone_filter(user_id: str, intent: SearchIntent) -> dict:
    """Build Pinecone metadata pre-filter from extracted intent.

    Priority: username > city (mutually exclusive — username is more specific).
    Always excludes the searching user.
    """
    base = {"user_id": {"$ne": user_id}}

    if intent.username:
        base["username"] = {"$eq": intent.username}
    elif intent.location_city:
        base["city"] = {"$eq": intent.location_city}

    return base


async def _rerank_with_gemini(query: str, candidates: list) -> list:
    """Use Gemini (structured JSON output) to select the 1-3 most relevant candidates.

    Sends FULL metadata (bio, tags, image_tags, video_summary, backstory_tags)
    to maximize reranking quality. Uses response_mime_type="application/json"
    to guarantee parseable output.

    Args:
        query: Original user query (not enriched — closest to their intent)
        candidates: Pinecone matches already filtered by similarity threshold

    Returns:
        Reranked subset of candidates (1–3), ordered by relevance.
        Falls back to top-3 by similarity score if reranking fails.
    """
    if len(candidates) <= _MAX_RESULTS:
        return candidates

    try:
        model = get_gemini_reranking_model()

        # Build comprehensive profile summaries with ALL available metadata
        lines = []
        for i, match in enumerate(candidates, start=1):
            meta = match.metadata or {}
            bio = meta.get("bio") or ""
            tags = ", ".join(meta.get("tags") or [])
            image_tags = ", ".join(meta.get("image_tags") or [])
            backstory_tags = ", ".join(meta.get("backstory_tags") or [])
            video_summary = (meta.get("video_summary") or "")[:300]

            parts = [
                f"{i}. username={meta.get('username', '?')}",
                f"passion={meta.get('passion', '')}",
                f"location={meta.get('location', '')}",
                f"score={match.score:.3f}",
            ]
            if bio:
                parts.append(f"bio={bio}")
            if tags:
                parts.append(f"tags=[{tags}]")
            if image_tags:
                parts.append(f"image_tags=[{image_tags}]")
            if backstory_tags:
                parts.append(f"backstory_tags=[{backstory_tags}]")
            if video_summary:
                parts.append(f"video_summary={video_summary}")

            lines.append(" | ".join(parts))

        candidates_text = "\n".join(lines)

        prompt = (
            "You are a talent relevance ranker for TropicalTalent, a talent networking platform.\n\n"
            f'User search query: "{query}"\n\n'
            f"Candidates ({len(candidates)}):\n{candidates_text}\n\n"
            "Evaluate each candidate against the search query considering:\n"
            "1. Relevance to the role/skill requested — including semantically related roles "
            "(e.g. 'videographer' is highly relevant for filmmakers and cinematographers, "
            "'photographer' is relevant for visual artists, 'designer' for illustrators, etc.)\n"
            "2. Portfolio evidence from video_summary and backstory_tags\n"
            "3. Relevance of image_tags and general tags to the query\n"
            "4. Geographic relevance if location was mentioned\n"
            "5. Bio alignment with what the user is looking for\n\n"
            f"Select the 1 to {_MAX_RESULTS} most relevant profiles. "
            "Return fewer if some candidates are clearly irrelevant.\n\n"
            "Return a JSON object with:\n"
            '- "selected": array of 1-based indices ordered by relevance (best first)\n'
            '- "reasoning": one sentence explaining your selection\n\n'
            'Example: {"selected": [3, 1], "reasoning": "Candidate 3 is a direct role match..."}'
        )

        response = await model.ainvoke(prompt)
        content = (getattr(response, "content", "") or "").strip()

        parsed = json.loads(content)
        indices = parsed.get("selected", [])

        if not isinstance(indices, list) or not indices:
            raise ValueError("Invalid rerank response: no selected indices")

        # Map 1-based indices back to candidates, guard against out-of-range
        reranked = []
        for idx in indices:
            if isinstance(idx, int) and 1 <= idx <= len(candidates):
                reranked.append(candidates[idx - 1])
            if len(reranked) >= _MAX_RESULTS:
                break

        if not reranked:
            raise ValueError("No valid indices returned")

        logger.info(
            "Gemini reranking complete",
            original_count=len(candidates),
            reranked_count=len(reranked),
            selected_indices=indices,
            reasoning=parsed.get("reasoning", ""),
        )

        return reranked

    except Exception as e:  # pylint: disable=broad-except
        logger.warning(
            "Gemini reranking failed, using top similarity scores",
            error=str(e),
        )
        return candidates[:_MAX_RESULTS]


async def search_users(request: SearchRequest) -> SearchResponse:
    """
    Orchestrate semantic user search workflow.

    Workflow:
    1. Extract structured intent (location_city, username, passion)
    2. Enrich query with AI, intent-aware (strips location/username)
    3. Generate embedding from enriched query
    4. Search Pinecone with dynamic metadata filter (city or username), top_k=15
    5. Graceful fallback: retry without location/username filter if 0 results
    6. Filter by similarity threshold (>= 0.75), keep all matching (up to 15)
    7. Gemini reranks candidates → selects 1-3 most relevant for the query
    8. Save search log in background

    Args:
        request: Search request with query and user_id

    Returns:
        SearchResponse with 1-3 best matching users after reranking
    """
    start_time = datetime.utcnow()

    try:
        # Fast path: return cached results for repeated identical queries
        cached = get_search_cache(request.user_id, request.query)
        if cached:
            logger.info(
                "Search cache hit — skipping AI pipeline",
                user_id=request.user_id,
            )
            from app.models.search import SearchResponse as _SR  # avoid circular at module level
            response = _SR.model_validate(cached)
            # Patch timing to reflect this request
            response.search_time_ms = int(
                (datetime.utcnow() - start_time).total_seconds() * 1000
            )
            return response

        logger.info(
            "Starting search orchestration",
            user_id=request.user_id,
            query=request.query,
        )

        # Step 1: Extract structured intent signals from raw query
        intent = await extract_search_intent(request.query)

        # Step 2: Enrich query with AI (intent-aware: strips location/username noise)
        enriched_query = await enrich_search_query(request.query, intent=intent)
        logger.info(
            "Query enrichment complete",
            original_query=request.query,
            enriched_length=len(enriched_query),
        )

        # Step 3: Generate embeddings — enriched query (primary) + original query (A/B tracking)
        # Also generate sparse vectors for hybrid search (BM25-style keyword matching)
        enriched_emb_task = generate_embedding(enriched_query)
        original_emb_task = generate_embedding(request.query)
        query_embedding, original_embedding = await asyncio.gather(
            enriched_emb_task, original_emb_task
        )

        if not query_embedding:
            raise ValueError("Failed to generate query embedding")

        # Sparse vectors for hybrid search
        query_sparse = encode_sparse(enriched_query)
        original_sparse = encode_sparse(request.query)

        # Apply Pinecone-recommended alpha weighting (0.75 = 75% semantic, 25% keyword).
        # This scales the dense and sparse vectors before querying since Pinecone
        # has no built-in alpha param — the weighting lives in the vector values.
        if query_sparse.get("indices"):
            query_dense_scaled, query_sparse_scaled = hybrid_score_norm(
                query_embedding, query_sparse, alpha=0.75
            )
        else:
            query_dense_scaled, query_sparse_scaled = query_embedding, query_sparse

        if original_sparse.get("indices"):
            orig_dense_scaled, orig_sparse_scaled = hybrid_score_norm(
                original_embedding, original_sparse, alpha=0.75
            )
        else:
            orig_dense_scaled, orig_sparse_scaled = original_embedding, original_sparse

        logger.info(
            "Embeddings generated (dense + sparse, alpha=0.75)",
            dense_dimension=len(query_embedding),
            sparse_indices=len(query_sparse.get("indices", [])),
        )

        # Step 4: Build dynamic Pinecone filter and hybrid search (dense + sparse)
        index = get_pinecone_index()
        pinecone_filter = _build_pinecone_filter(request.user_id, intent)
        has_strict_filter = bool(intent.username or intent.location_city)

        logger.info(
            "Querying Pinecone (hybrid search)",
            top_k=_TOP_K,
            has_username_filter=bool(intent.username),
            has_city_filter=bool(intent.location_city),
        )

        # Build query kwargs — include sparse_vector only if available
        query_kwargs = dict(
            vector=query_dense_scaled,
            top_k=_TOP_K,
            include_metadata=True,
            filter=pinecone_filter,
        )
        if query_sparse_scaled.get("indices"):
            query_kwargs["sparse_vector"] = query_sparse_scaled

        results = index.query(**query_kwargs)

        # Step 5: Graceful fallback — if strict filter returned nothing, retry without it
        used_fallback = False
        if not results.matches and has_strict_filter:
            logger.info(
                "No results with metadata filter, retrying without",
                username_filter=intent.username,
                city_filter=intent.location_city,
            )
            fallback_kwargs = dict(
                vector=query_dense_scaled,
                top_k=_TOP_K,
                include_metadata=True,
                filter={"user_id": {"$ne": request.user_id}},
            )
            if query_sparse_scaled.get("indices"):
                fallback_kwargs["sparse_vector"] = query_sparse_scaled

            results = index.query(**fallback_kwargs)
            used_fallback = True

        logger.info(
            "Pinecone search complete",
            matches_count=len(results.matches),
            used_fallback=used_fallback,
        )

        # Step 6: Filter all matches by minimum similarity threshold (>= 0.75)
        from app.core.config import get_settings

        settings = get_settings()

        all_matches = results.matches
        threshold_matches = [
            m for m in all_matches if m.score >= settings.minimum_match_threshold
        ]
        filtered_count = len(all_matches) - len(threshold_matches)

        logger.info(
            "Threshold filter applied",
            total=len(all_matches),
            above_threshold=len(threshold_matches),
            filtered_out=filtered_count,
        )

        # Step 7: Gemini reranks candidates → returns 1-3 best
        final_matches = await _rerank_with_gemini(request.query, threshold_matches)

        # Assess quality based on top score after reranking
        def assess_quality(matches) -> str:
            if not matches:
                return "poor"
            max_score = max(m.score for m in matches)
            if max_score >= settings.excellent_match_threshold:
                return "excellent"
            elif max_score >= settings.similarity_threshold:
                return "good"
            else:
                return "poor"

        results_quality = assess_quality(final_matches)

        logger.info(
            "Final results ready",
            reranked_count=len(final_matches),
            quality=results_quality,
        )

        # Convert to search results with metadata
        search_results = []
        result_user_ids = []

        for match in final_matches:
            metadata = match.metadata or {}
            user_id = metadata.get("user_id", match.id)
            result_user_ids.append(user_id)

            search_results.append(
                UserSearchResult(
                    user_id=user_id,
                    score=match.score,
                    username=metadata.get("username", ""),
                    avatar=metadata.get("avatar") or None,
                    bio=metadata.get("bio"),
                    tags=metadata.get("tags", []),
                    passion=metadata.get("passion"),
                    metadata={
                        "user_id": user_id,
                        "username": metadata.get("username", ""),
                        "avatar": metadata.get("avatar", ""),
                        "location": metadata.get("location", ""),
                    },
                )
            )

        # Step 8: Pre-generate log_id for the frontend before background INSERT
        log_id = str(uuid4())
        top_similarity = max((m.score for m in final_matches), default=0.0)

        # Enrichment A/B: query Pinecone with original embedding (hybrid) to compare scores
        original_query_top_score = None
        if original_embedding and final_matches:
            try:
                orig_kwargs = dict(
                    vector=orig_dense_scaled,
                    top_k=3,
                    include_metadata=False,
                    filter={"user_id": {"$ne": request.user_id}},
                )
                if orig_sparse_scaled.get("indices"):
                    orig_kwargs["sparse_vector"] = orig_sparse_scaled

                orig_results = index.query(**orig_kwargs)
                if orig_results.matches:
                    original_query_top_score = max(m.score for m in orig_results.matches)
                    logger.info(
                        "Enrichment A/B comparison",
                        enriched_top=round(top_similarity, 4),
                        original_top=round(original_query_top_score, 4),
                        enrichment_delta=round(top_similarity - original_query_top_score, 4),
                    )
            except Exception:  # pylint: disable=broad-except
                pass  # Non-critical — don't fail the search for analytics

        logger.info(
            "Pre-generated search log id — saving in background",
            log_id=log_id,
            top_similarity=round(top_similarity, 4),
            user_id=request.user_id,
        )

        asyncio.create_task(
            save_search_log(
                user_id=request.user_id,
                query=request.query,
                enriched_query=enriched_query,
                results=result_user_ids,
                query_vector=query_embedding,
                log_id=log_id,
                similarity_score=top_similarity,
                original_query_top_score=original_query_top_score,
            )
        )

        cache = get_user_vector_cache()
        cache.invalidate_user(request.user_id)

        duration = int((datetime.utcnow() - start_time).total_seconds() * 1000)
        logger.info(
            "Search orchestration complete",
            user_id=request.user_id,
            results_count=len(search_results),
            duration_ms=duration,
        )

        response = SearchResponse(
            user_id=request.user_id,
            query=request.query,
            results=search_results,
            total_results=len(search_results),
            search_time_ms=duration,
            results_quality=results_quality,
            filtered_count=filtered_count,
            log_id=log_id,
        )

        # Cache positive results so repeated identical queries skip the AI pipeline
        if search_results:
            set_search_cache(request.user_id, request.query, response.model_dump())

        return response

    except Exception as e:  # pylint: disable=broad-except
        capture_exception(e, {"user_id": request.user_id, "operation": "search"})
        logger.error(
            "Search orchestration failed",
            user_id=request.user_id,
            error=str(e),
            error_type=type(e).__name__,
        )
        raise
