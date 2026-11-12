"""
Unit tests for critical services.

Tests follow the Given-When-Then pattern and focus on service behavior:
- Given: Specific inputs and mocked dependencies
- When: A service method is called
- Then: The expected output or side effect occurs

All tests are modular and test behavior, not implementation details.

NOTE (Phase 5, 2026-11-12): this file was rewritten against the current
service seams. The old version patched `Pinecone` /
`GoogleGenerativeAIEmbeddings` classes that no longer exist in these
modules and imported an `EmbeddingService` class that was replaced by
module-level functions. Patch targets are now the seams the services
actually use: get_pinecone_index, generate_embedding, extract_search_intent,
enrich_search_query, get_recent_search_vectors, and the analyzer functions
in app.services.vectorize. Pinecone query mocks apply the metadata filter
the service passes (notably {"user_id": {"$ne": ...}}), modelling what
Pinecone itself does server-side.
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _pinecone_index(matches):
    """Mock Pinecone index whose query() honours the user_id $ne filter."""
    index = MagicMock()

    def _query(**kwargs):
        result_matches = list(matches)
        user_filter = (kwargs.get("filter") or {}).get("user_id") or {}
        excluded = user_filter.get("$ne")
        if excluded is not None:
            result_matches = [
                m for m in result_matches
                if (m.metadata or {}).get("user_id", m.id) != excluded
            ]
        return SimpleNamespace(matches=result_matches)

    index.query.side_effect = _query
    index.fetch.return_value = SimpleNamespace(vectors={})
    index.upsert.return_value = {"upserted_count": 1}
    return index


def _match(user_id, score, **metadata):
    meta = {"user_id": user_id, "username": metadata.get("username", user_id)}
    meta.update(metadata)
    return SimpleNamespace(id=f"user-{user_id}", score=score, metadata=meta)


@pytest.mark.unit
class TestSearchService:
    """Unit tests for search service."""

    @pytest.mark.asyncio
    async def test_search_users_with_valid_query_returns_relevant_results(
        self, sample_search_request
    ):
        """
        Given: A valid search query and mocked vector search
        When: search_users is called
        Then: Relevant user results are returned sorted by score
        """
        # Given
        from app.models.search import SearchRequest
        from app.services.intent_extractor import SearchIntent
        from app.services.search import search_users

        matches = [
            _match("user-1", 0.95, username="john_doe", bio="Developer"),
            _match("user-2", 0.87, username="jane_smith", bio="Designer"),
        ]
        request = SearchRequest(**sample_search_request)

        with (
            patch("app.services.search.extract_search_intent",
                  new=AsyncMock(return_value=SearchIntent())),
            patch("app.services.search.enrich_search_query",
                  new=AsyncMock(return_value=request.query)),
            patch("app.services.search.generate_embedding",
                  new=AsyncMock(return_value=[0.1] * 3072)),
            patch("app.services.search.get_pinecone_index",
                  return_value=_pinecone_index(matches)),
            patch("app.services.search.get_search_cache", return_value=None),
            patch("app.services.search.set_search_cache"),
            patch("app.services.search.get_user_vector_cache"),
            patch("app.services.search.save_search_log", new=AsyncMock()),
        ):
            # When
            result = await search_users(request)

        # Then
        assert result.total_results > 0
        assert result.query == sample_search_request["query"]
        assert len(result.results) > 0
        # Results should be sorted by score descending
        if len(result.results) > 1:
            assert result.results[0].score >= result.results[1].score

    @pytest.mark.asyncio
    async def test_search_users_with_empty_results_returns_empty_list(
        self, sample_search_request
    ):
        """
        Given: A search query that returns no matches
        When: search_users is called
        Then: Empty results list is returned with zero total_results
        """
        # Given
        from app.models.search import SearchRequest
        from app.services.intent_extractor import SearchIntent
        from app.services.search import search_users

        request = SearchRequest(**sample_search_request)

        with (
            patch("app.services.search.extract_search_intent",
                  new=AsyncMock(return_value=SearchIntent())),
            patch("app.services.search.enrich_search_query",
                  new=AsyncMock(return_value=request.query)),
            patch("app.services.search.generate_embedding",
                  new=AsyncMock(return_value=[0.1] * 3072)),
            patch("app.services.search.get_pinecone_index",
                  return_value=_pinecone_index([])),
            patch("app.services.search.get_search_cache", return_value=None),
            patch("app.services.search.set_search_cache"),
            patch("app.services.search.get_user_vector_cache"),
            patch("app.services.search.save_search_log", new=AsyncMock()),
        ):
            # When
            result = await search_users(request)

            # Then
            assert result.total_results == 0
            assert len(result.results) == 0

    @pytest.mark.asyncio
    async def test_search_users_logs_query_to_supabase(
        self, sample_search_request
    ):
        """
        Given: A successful search operation
        When: search_users is called
        Then: Search query is logged to Supabase for analytics
        """
        # Given
        from app.models.search import SearchRequest
        from app.services.intent_extractor import SearchIntent
        from app.services.search import search_users

        request = SearchRequest(**sample_search_request)
        matches = [_match("user-1", 0.95, username="john_doe", bio="Developer")]

        with (
            patch("app.services.search.extract_search_intent",
                  new=AsyncMock(return_value=SearchIntent())),
            patch("app.services.search.enrich_search_query",
                  new=AsyncMock(return_value=request.query)),
            patch("app.services.search.generate_embedding",
                  new=AsyncMock(return_value=[0.1] * 3072)),
            patch("app.services.search.get_pinecone_index",
                  return_value=_pinecone_index(matches)),
            patch("app.services.search.get_search_cache", return_value=None),
            patch("app.services.search.set_search_cache"),
            patch("app.services.search.get_user_vector_cache"),
            patch("app.services.search.save_search_log", new=AsyncMock()) as mock_save,
        ):
            # When
            await search_users(request)
            # save_search_log is scheduled with asyncio.create_task — let
            # the loop run it before asserting.
            await asyncio.sleep(0)

            # Then
            mock_save.assert_awaited_once()
            assert mock_save.call_args.kwargs["user_id"] == request.user_id
            assert mock_save.call_args.kwargs["query"] == request.query


@pytest.mark.unit
class TestEmbeddingService:
    """Unit tests for embedding service."""

    @pytest.mark.asyncio
    async def test_generate_embedding_with_valid_text_returns_vector(self):
        """
        Given: Valid text input
        When: generate_embedding is called
        Then: A 1536-dimensional embedding vector is returned
        """
        # Given
        text = "Python developer with AI experience"

        mock_model = AsyncMock()
        mock_model.aembed_query.return_value = [0.1] * 1536

        with patch(
            "app.services.embedding_service.get_embeddings_model",
            return_value=mock_model,
        ):
            from app.services.embedding_service import generate_embedding

            # When
            result = await generate_embedding(text)

            # Then
            assert isinstance(result, list)
            assert len(result) == 1536
            assert all(isinstance(x, (int, float)) for x in result)

    @pytest.mark.asyncio
    async def test_generate_embedding_with_empty_text_handles_gracefully(self):
        """
        Given: Empty text input
        When: generate_embedding is called
        Then: None is returned (the documented graceful handling)
        """
        # Given
        text = ""

        with patch(
            "app.services.embedding_service.get_embeddings_model",
            return_value=AsyncMock(),
        ):
            from app.services.embedding_service import generate_embedding

            # When
            result = await generate_embedding(text)

            # Then
            assert result is None

    @pytest.mark.asyncio
    async def test_generate_embedding_returns_same_vector_for_same_text(self):
        """
        Given: The same text is embedded multiple times
        When: generate_embedding is called repeatedly
        Then: The same embedding is returned each time

        NOTE: there is no caching layer in the embedding service — the
        model is simply called again; this test pins determinism of the
        call, not a cache.
        """
        # Given
        text = "Test text for caching"

        mock_model = AsyncMock()
        mock_model.aembed_query.return_value = [0.1] * 1536

        with patch(
            "app.services.embedding_service.get_embeddings_model",
            return_value=mock_model,
        ):
            from app.services.embedding_service import generate_embedding

            # When
            result1 = await generate_embedding(text)
            result2 = await generate_embedding(text)

            # Then
            assert result1 == result2


@pytest.mark.unit
class TestVectorizeService:
    """Unit tests for vectorize service."""

    @pytest.mark.asyncio
    async def test_vectorize_profile_with_complete_data_creates_vector(
        self, sample_profile_data
    ):
        """
        Given: Complete profile data with all fields
        When: vectorize_profile is called
        Then: Profile is vectorized and stored in Pinecone
        """
        # Given
        from app.models.vectorize import ProfileData, VectorizeProfileRequest
        from app.services.vectorize import vectorize_profile

        profile = ProfileData(**sample_profile_data)
        request = VectorizeProfileRequest(
            user_id="test-user-123",
            profile=profile
        )

        index = _pinecone_index([])
        with (
            patch("app.services.vectorize.get_pinecone_index",
                  return_value=index),
            patch("app.services.vectorize.generate_embedding",
                  new=AsyncMock(return_value=[0.1] * 3072)),
            patch("app.services.vectorize.lemmatize_texts_batch",
                  new=AsyncMock(side_effect=lambda texts: texts)),
        ):
            # When
            result = await vectorize_profile(request)

            # Then
            assert result.success is True
            assert result.user_id == "test-user-123"
            assert result.vector_id is not None
            index.upsert.assert_called_once()

    @pytest.mark.asyncio
    async def test_vectorize_profile_with_youtube_url_analyzes_video(
        self, sample_profile_data
    ):
        """
        Given: Profile data with YouTube URL
        When: vectorize_profile is called
        Then: YouTube video is analyzed and summary is included
        """
        # Given
        from app.models.vectorize import ProfileData, VectorizeProfileRequest
        from app.services.vectorize import vectorize_profile

        profile = ProfileData(**sample_profile_data)
        request = VectorizeProfileRequest(
            user_id="test-user-123",
            profile=profile,
            youtube_url="https://www.youtube.com/watch?v=test123"
        )

        mock_youtube_summary = "Video about AI and machine learning"

        index = _pinecone_index([])
        with (
            patch("app.services.vectorize.get_pinecone_index",
                  return_value=index),
            patch("app.services.vectorize.generate_embedding",
                  new=AsyncMock(return_value=[0.1] * 3072)),
            patch("app.services.vectorize.lemmatize_texts_batch",
                  new=AsyncMock(side_effect=lambda texts: texts)),
            patch("app.services.vectorize.analyze_youtube_video",
                  new=AsyncMock(return_value=mock_youtube_summary)) as mock_youtube,
        ):
            # When
            result = await vectorize_profile(request)

            # Then
            assert result.video_summary is not None
            mock_youtube.assert_called_once()

    @pytest.mark.asyncio
    async def test_vectorize_profile_with_image_extracts_tags(
        self, sample_profile_data
    ):
        """
        Given: Profile data with image file
        When: vectorize_profile is called
        Then: Image is analyzed and tags are extracted
        """
        # Given
        from app.models.vectorize import ProfileData, VectorizeProfileRequest
        from app.services.vectorize import vectorize_profile

        profile = ProfileData(**sample_profile_data)
        request = VectorizeProfileRequest(
            user_id="test-user-123",
            profile=profile
        )

        mock_image_file = MagicMock()
        mock_image_file.filename = "profile.jpg"
        mock_image_file.read = AsyncMock(return_value=b"fake image data")

        mock_image_tags = ["portrait", "professional", "smiling"]

        index = _pinecone_index([])
        with (
            patch("app.services.vectorize.get_pinecone_index",
                  return_value=index),
            patch("app.services.vectorize.generate_embedding",
                  new=AsyncMock(return_value=[0.1] * 3072)),
            patch("app.services.vectorize.lemmatize_texts_batch",
                  new=AsyncMock(side_effect=lambda texts: texts)),
            patch("app.services.vectorize.analyze_image",
                  new=AsyncMock(return_value=mock_image_tags)),
        ):
            # When
            result = await vectorize_profile(request, image_file=mock_image_file)

            # Then
            assert result.image_tags is not None
            assert len(result.image_tags) > 0


@pytest.mark.unit
class TestRecommendationsService:
    """Unit tests for recommendations service."""

    @pytest.mark.asyncio
    async def test_get_recommendations_for_existing_user_returns_similar_users(self):
        """
        Given: An existing user with a vector in Pinecone
        When: get_recommendations is called
        Then: Similar users are returned based on vector similarity
        """
        # Given
        user_id = "test-user-123"
        matches = [
            _match("user-1", 0.95, username="john_doe", bio="Developer"),
            _match("user-2", 0.87, username="jane_smith", bio="Designer"),
        ]

        with (
            patch("app.services.recommendations.get_recent_search_vectors",
                  new=AsyncMock(return_value=[[0.1] * 3072])),
            patch("app.services.recommendations.get_pinecone_index",
                  return_value=_pinecone_index(matches)),
            # Supabase enrichment is best-effort in the service; force its
            # failure path so the test never touches the network.
            patch("app.services.recommendations.get_supabase_client",
                  new=AsyncMock(side_effect=Exception("no db in tests"))),
        ):
            from app.services.recommendations import get_recommendations

            # When
            result = await get_recommendations(user_id)

            # Then
            assert result.user_id == user_id
            assert len(result.recommendations) > 0
            assert [r.user_id for r in result.recommendations] == [
                "user-1",
                "user-2",
            ]

    @pytest.mark.asyncio
    async def test_get_recommendations_excludes_requesting_user(self):
        """
        Given: A user requesting recommendations
        When: get_recommendations is called
        Then: The requesting user is excluded from results
        """
        # Given
        user_id = "test-user-123"

        # Mock Pinecone to include the requesting user in results — the
        # service's {"user_id": {"$ne": user_id}} filter must exclude them.
        matches = [
            _match(user_id, 1.0, username="self"),
            _match("user-2", 0.9, username="jane_smith"),
        ]

        with (
            patch("app.services.recommendations.get_recent_search_vectors",
                  new=AsyncMock(return_value=[[0.1] * 3072])),
            patch("app.services.recommendations.get_pinecone_index",
                  return_value=_pinecone_index(matches)),
            patch("app.services.recommendations.get_supabase_client",
                  new=AsyncMock(side_effect=Exception("no db in tests"))),
        ):
            from app.services.recommendations import get_recommendations

            # When
            result = await get_recommendations(user_id)

            # Then
            # Verify requesting user is not in recommendations
            user_ids = [rec.user_id for rec in result.recommendations]
            assert user_id not in user_ids
            assert user_ids == ["user-2"]

    @pytest.mark.asyncio
    async def test_get_recommendations_for_nonexistent_user_handles_gracefully(self):
        """
        Given: A user ID that doesn't exist in Pinecone
        When: get_recommendations is called
        Then: Empty recommendations are returned
        """
        # Given
        user_id = "nonexistent-user"

        with (
            patch("app.services.recommendations.get_recent_search_vectors",
                  new=AsyncMock(return_value=[])),
            patch("app.services.recommendations.get_pinecone_index",
                  return_value=_pinecone_index([])),
        ):
            from app.services.recommendations import get_recommendations

            # When
            result = await get_recommendations(user_id)

            # Then — no search history means no recommendations (and no
            # Pinecone query is even attempted).
            assert result.total_recommendations == 0
            assert result.recommendations == []
