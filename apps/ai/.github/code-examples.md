# Code examples — patterns to copy

Short, copy-pasteable patterns used across the repo.

Router → Service (thin router):

```py
@router.post("/search")
async def search(req: SearchRequest, svc: SearchService = Depends(get_search_service)):
    return await svc.search(req)
```

Service orchestration (async, use DI):

```py
class SearchService:
    async def search(self, req):
        emb = await self.embedding_service.embed(req.query)
        results = await self.vector_store.query(emb, top_k=req.top_k)
        return results
```

Concurrency example: use `asyncio.gather(...)` in `creative/services/vectorize.py`.

Tests: create fixtures in `tests/conftest.py` and keep tests in `tests/` following `test_<module>.py`.

# Code examples (short)

Use these minimal patterns as the canonical style in this repo.

Router (thin):

- Location: `creative/routers/*.py`
- Use FastAPI, depend on a service via `Depends`.

Service (orchestrator):

- Location: `creative/services/*.py`
- Orchestrates I/O, calls infra clients in `app/core/`.

Model (Pydantic):

- Location: `creative/models/*.py`
- Use for request validation and response shapes.

Concurrency:

- Use `asyncio.gather(...)` for independent I/O calls (see `vectorize.py`).

Vector/embedding pattern:

- Generate embeddings in `creative/services/embedding_service.py`.
- Query vector store via `app/core/vector_store.py` or `app/core/embedding_search.py`.

Follow these examples exactly when adding new endpoints or services.

# Code Examples - TropicalTalent AI Backend

This file provides reference implementations following our conventions.

## Service Orchestration Pattern

### Complete Example: Search Service

```python
"""Professional search service implementation."""

from typing import Dict, Any, List, Optional
from datetime import datetime

import sentry_sdk
from app.business.models import (
    DirectSearchRequest,
    DirectSearchResponse,
    ProfessionalResult,
)
from app.core.logging import LoggerMixin
from app.services import EmbeddingService, PineconeClient, SupabaseClient


class DirectSearchService(LoggerMixin):
    """
    Service for searching professionals using semantic search.

    Orchestrates embedding generation, vector search, and result enrichment.
    """

    def __init__(
        self,
        supabase_client: SupabaseClient,
        pinecone_client: PineconeClient,
        embedding_service: EmbeddingService,
    ):
        """
        Initialize search service with dependencies.

        Args:
            supabase_client: Database client for user data
            pinecone_client: Vector database client
            embedding_service: Service for generating embeddings
        """
        self.supabase_client = supabase_client
        self.pinecone_client = pinecone_client
        self.embedding_service = embedding_service

    async def search_professionals(
        self, request: DirectSearchRequest
    ) -> DirectSearchResponse:
        """
        Search for professionals matching the query.

        Args:
            request: Search request with query and filters

        Returns:
            Search response with ranked results

        Raises:
            ValueError: If query is empty or invalid
            HTTPException: If external service fails

        Example:
            >>> request = DirectSearchRequest(
            ...     query="Python developer with AI experience",
            ...     user_id="123e4567-e89b-12d3-a456-426614174000",
            ...     filters={"location": "Madrid"}
            ... )
            >>> response = await service.search_professionals(request)
            >>> print(f"Found {len(response.results)} professionals")
        """
        start_time = datetime.utcnow()

        try:
            self.logger.info(
                "Starting professional search",
                user_id=request.user_id,
                query_length=len(request.query),
                has_filters=bool(request.filters),
            )

            # Generate embedding for search query
            embedding = await self.embedding_service.generate_embedding(
                request.query
            )

            # Search vector database
            vector_results = await self.pinecone_client.query(
                vector=embedding,
                top_k=20,
                include_metadata=True,
                filter=request.filters,
            )

            # Transform results
            results = self._transform_results(vector_results)

            # Enrich with additional data if needed
            if request.include_full_profile:
                results = await self._enrich_results(results)

            duration = (datetime.utcnow() - start_time).total_seconds()

            self.logger.info(
                "Search completed",
                results_count=len(results),
                duration_seconds=duration,
            )

            return DirectSearchResponse(
                results=results,
                total_count=len(results),
                query=request.query,
                filters=request.filters,
            )

        except Exception as e:
            self.logger.error(
                "Search failed",
                error=str(e),
                error_type=type(e).__name__,
                user_id=request.user_id,
            )
            sentry_sdk.capture_exception(e)
            raise

    def _transform_results(
        self, vector_results: List[Any]
    ) -> List[ProfessionalResult]:
        """Transform vector search results to professional results."""
        return [
            ProfessionalResult(
                user_id=match.id,
                score=match.score,
                bio=match.metadata.get("bio") if match.metadata else None,
                tags=match.metadata.get("tags", []) if match.metadata else [],
            )
            for match in vector_results
        ]

    async def _enrich_results(
        self, results: List[ProfessionalResult]
    ) -> List[ProfessionalResult]:
        """Enrich results with additional profile data."""
        user_ids = [result.user_id for result in results]
        profiles = await self.supabase_client.get_user_profiles(user_ids)

        # Merge profile data
        profile_map = {p.user_id: p for p in profiles}
        for result in results:
            if profile := profile_map.get(result.user_id):
                result.full_name = profile.full_name
                result.avatar_url = profile.avatar_url

        return results
```

### Router Implementation

```python
"""Professional search router."""

from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.business.models import DirectSearchRequest, DirectSearchResponse
from app.business.services import DirectSearchService
from app.core import get_logger
from app.services import (
    get_embedding_service,
    get_pinecone_client,
    get_supabase_client,
)

router = APIRouter(prefix="/business", tags=["business-search"])
logger = get_logger("business.search")


async def verify_api_key(x_api_key: str = Header(...)) -> None:
    """
    Verify API key from request header.

    Args:
        x_api_key: API key from X-API-Key header

    Raises:
        HTTPException: If API key is invalid
    """
    from app.core import get_settings

    settings = get_settings()
    if x_api_key != settings.internal_api_key:
        logger.warning("Invalid API key attempt")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key"
        )


async def get_search_service(
    supabase_client=Depends(get_supabase_client),
    pinecone_client=Depends(get_pinecone_client),
    embedding_service=Depends(get_embedding_service),
) -> DirectSearchService:
    """Dependency injection for search service."""
    return DirectSearchService(
        supabase_client,
        pinecone_client,
        embedding_service,
    )


@router.post(
    "/direct-search",
    response_model=DirectSearchResponse,
    dependencies=[Depends(verify_api_key)],
    summary="Search for professionals",
    description="Semantic search for professionals using natural language queries",
)
async def search_professionals(
    request: DirectSearchRequest,
    service: DirectSearchService = Depends(get_search_service),
) -> DirectSearchResponse:
    """
    Search for professionals matching the query.

    This endpoint performs semantic search using embeddings to find
    professionals that match the natural language query.

    Args:
        request: Search request with query and optional filters
        service: Injected search service instance

    Returns:
        Search response with ranked professional results

    Raises:
        HTTPException: For authentication or validation errors
    """
    try:
        logger.info(
            "Received search request",
            user_id=request.user_id,
            has_filters=bool(request.filters),
        )

        response = await service.search_professionals(request)

        logger.info(
            "Search request completed",
            results_count=len(response.results),
        )

        return response

    except ValueError as e:
        logger.warning("Invalid search request", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        logger.error("Search request failed", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Search service temporarily unavailable",
        )
```

## Pydantic Models

```python
"""Search request and response models."""

from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field, validator


class DirectSearchRequest(BaseModel):
    """
    Request model for professional search.

    Example:
        >>> request = DirectSearchRequest(
        ...     query="Senior Python developer",
        ...     user_id="123e4567-e89b-12d3-a456-426614174000",
        ...     filters={"location": "Madrid", "years_experience": {"$gte": 5}}
        ... )
    """

    query: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Natural language search query"
    )
    user_id: str = Field(
        ...,
        description="UUID of the user performing the search"
    )
    filters: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional metadata filters for search refinement"
    )
    top_k: int = Field(
        default=10,
        ge=1,
        le=100,
        description="Maximum number of results to return"
    )
    include_full_profile: bool = Field(
        default=False,
        description="Whether to include full profile data"
    )

    @validator('query')
    def validate_query(cls, v: str) -> str:
        """Ensure query is not just whitespace."""
        if not v.strip():
            raise ValueError("Query cannot be empty or only whitespace")
        return v.strip()

    @validator('user_id')
    def validate_user_id(cls, v: str) -> str:
        """Validate user ID format (UUID)."""
        import uuid
        try:
            uuid.UUID(v)
        except ValueError:
            raise ValueError("user_id must be a valid UUID")
        return v


class ProfessionalResult(BaseModel):
    """Individual professional search result."""

    user_id: str = Field(..., description="Professional's user ID")
    score: float = Field(..., description="Relevance score (0-1)")
    bio: Optional[str] = Field(None, description="Professional bio")
    tags: List[str] = Field(default_factory=list, description="Skill tags")
    full_name: Optional[str] = Field(None, description="Full name if enriched")
    avatar_url: Optional[str] = Field(None, description="Avatar URL if enriched")


class DirectSearchResponse(BaseModel):
    """Response model for professional search."""

    results: List[ProfessionalResult] = Field(
        ...,
        description="List of matching professionals"
    )
    total_count: int = Field(..., description="Total number of results")
    query: str = Field(..., description="Original search query")
    filters: Optional[Dict[str, Any]] = Field(
        None,
        description="Applied filters"
    )
```

## Testing Examples

### Service Unit Test

```python
"""Unit tests for DirectSearchService."""

from unittest.mock import AsyncMock, Mock
import pytest

from app.business.models import DirectSearchRequest, DirectSearchResponse
from app.business.services import DirectSearchService


class TestDirectSearchService:
    """Test DirectSearchService with mocked dependencies."""

    @pytest.fixture
    async def service(self):
        """Create service instance with mocked dependencies."""
        supabase_client = AsyncMock()
        pinecone_client = AsyncMock()
        embedding_service = AsyncMock()

        return DirectSearchService(
            supabase_client=supabase_client,
            pinecone_client=pinecone_client,
            embedding_service=embedding_service,
        )

    @pytest.fixture
    def search_request(self):
        """Create sample search request."""
        return DirectSearchRequest(
            query="Python developer with AI experience",
            user_id="123e4567-e89b-12d3-a456-426614174000",
            filters={"location": "Madrid"},
            top_k=10,
        )

    async def test_search_professionals_with_valid_query_returns_results(
        self, service, search_request
    ):
        """Test search returns results for valid query."""
        # Arrange
        mock_embedding = [0.1] * 1536
        service.embedding_service.generate_embedding.return_value = mock_embedding

        mock_vector_results = [
            Mock(
                id="user-1",
                score=0.95,
                metadata={"bio": "AI Engineer", "tags": ["python", "ml"]}
            ),
            Mock(
                id="user-2",
                score=0.87,
                metadata={"bio": "Backend Dev", "tags": ["python", "api"]}
            ),
        ]
        service.pinecone_client.query.return_value = mock_vector_results

        # Act
        response = await service.search_professionals(search_request)

        # Assert
        assert isinstance(response, DirectSearchResponse)
        assert len(response.results) == 2
        assert response.results[0].user_id == "user-1"
        assert response.results[0].score == 0.95
        assert response.total_count == 2
        assert response.query == search_request.query

        # Verify service calls
        service.embedding_service.generate_embedding.assert_called_once_with(
            search_request.query
        )
        service.pinecone_client.query.assert_called_once_with(
            vector=mock_embedding,
            top_k=20,
            include_metadata=True,
            filter=search_request.filters,
        )

    async def test_search_professionals_with_empty_query_raises_validation_error(
        self, service
    ):
        """Test search raises error for empty query."""
        # Arrange
        with pytest.raises(ValueError, match="Query cannot be empty"):
            DirectSearchRequest(
                query="   ",  # Only whitespace
                user_id="123e4567-e89b-12d3-a456-426614174000",
            )

    async def test_search_professionals_with_service_failure_raises_exception(
        self, service, search_request
    ):
        """Test search handles service failures gracefully."""
        # Arrange
        service.embedding_service.generate_embedding.side_effect = Exception(
            "Service unavailable"
        )

        # Act & Assert
        with pytest.raises(Exception, match="Service unavailable"):
            await service.search_professionals(search_request)
```

### API Integration Test

```python
"""Integration tests for search API endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_search_endpoint_with_valid_request_returns_200(
    client: AsyncClient,
    valid_api_key: str,
):
    """Test search endpoint returns 200 for valid request."""
    # Arrange
    request_data = {
        "query": "Python developer",
        "user_id": "123e4567-e89b-12d3-a456-426614174000",
        "top_k": 5,
    }
    headers = {"X-API-Key": valid_api_key}

    # Act
    response = await client.post(
        "/business/direct-search",
        json=request_data,
        headers=headers,
    )

    # Assert
    assert response.status_code == 200
    data = response.json()
    assert "results" in data
    assert "total_count" in data
    assert isinstance(data["results"], list)


@pytest.mark.asyncio
async def test_search_endpoint_with_invalid_api_key_returns_401(
    client: AsyncClient,
):
    """Test search endpoint returns 401 for invalid API key."""
    # Arrange
    request_data = {
        "query": "Python developer",
        "user_id": "123e4567-e89b-12d3-a456-426614174000",
    }
    headers = {"X-API-Key": "invalid-key"}

    # Act
    response = await client.post(
        "/business/direct-search",
        json=request_data,
        headers=headers,
    )

    # Assert
    assert response.status_code == 401
```

## Async Patterns

### Concurrent Operations

```python
"""Example of running operations concurrently."""

import asyncio
from typing import Tuple


async def fetch_user_and_generate_embedding(
    user_id: str,
    query: str,
) -> Tuple[UserData, List[float]]:
    """
    Fetch user data and generate embedding concurrently.

    This is more efficient than sequential operations.
    """
    # ✅ Correct - Run concurrently
    user_data, embedding = await asyncio.gather(
        supabase_client.get_user(user_id),
        embedding_service.generate_embedding(query),
    )

    return user_data, embedding


# ❌ Incorrect - Sequential execution
async def fetch_user_and_generate_embedding_slow(
    user_id: str,
    query: str,
) -> Tuple[UserData, List[float]]:
    """This is slower because operations run sequentially."""
    user_data = await supabase_client.get_user(user_id)
    embedding = await embedding_service.generate_embedding(query)
    return user_data, embedding
```

### Error Handling in Async

```python
"""Example of proper error handling in async functions."""

async def safe_batch_operation(items: List[str]) -> List[Result]:
    """Process items with proper error handling."""
    results = []

    for item in items:
        try:
            result = await process_item(item)
            results.append(result)
        except SpecificError as e:
            logger.warning(f"Failed to process item", item=item, error=str(e))
            # Continue with other items
            continue
        except Exception as e:
            logger.error(f"Unexpected error processing item", item=item)
            sentry_sdk.capture_exception(e)
            # Decide: continue or re-raise
            raise

    return results
```

## Configuration Examples

### Settings with Validation

```python
"""Configuration management example."""

from typing import Optional
from pydantic import BaseSettings, Field, SecretStr, validator


class Settings(BaseSettings):
    """Application settings with validation."""

    # Application
    app_name: str = Field(default="TropicalTalent AI", env="APP_NAME")
    app_version: str = Field(default="1.0.0", env="APP_VERSION")
    debug: bool = Field(default=False, env="DEBUG")

    # API Keys
    openai_api_key: SecretStr = Field(..., env="OPENAI_API_KEY")
    pinecone_api_key: SecretStr = Field(..., env="PINECONE_API_KEY")
    internal_api_key: SecretStr = Field(..., env="INTERNAL_API_KEY")

    # Supabase
    supabase_url: str = Field(..., env="SUPABASE_URL")
    supabase_key: SecretStr = Field(..., env="SUPABASE_KEY")

    # Pinecone
    pinecone_environment: str = Field(default="us-west1-gcp", env="PINECONE_ENV")
    pinecone_index_name: str = Field(..., env="PINECONE_INDEX")

    # Sentry (optional)
    sentry_dsn: Optional[str] = Field(default=None, env="SENTRY_DSN")
    sentry_environment: str = Field(default="development", env="SENTRY_ENV")

    @validator('openai_api_key', 'pinecone_api_key', 'internal_api_key')
    def validate_api_keys(cls, v: SecretStr) -> SecretStr:
        """Ensure API keys are not empty."""
        if not v.get_secret_value().strip():
            raise ValueError("API key cannot be empty")
        return v

    @validator('supabase_url')
    def validate_supabase_url(cls, v: str) -> str:
        """Ensure Supabase URL is valid."""
        if not v.startswith('https://'):
            raise ValueError("Supabase URL must use HTTPS")
        return v

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False
```

## Logging Examples

```python
"""Structured logging examples."""

from app.core import get_logger

logger = get_logger("my_module")


# ✅ Good - Structured logging with context
logger.info(
    "User search completed",
    user_id=user_id,
    query=query,
    results_count=len(results),
    duration_ms=duration * 1000,
)

# ✅ Good - Error logging with context
logger.error(
    "Failed to generate embedding",
    user_id=user_id,
    query_length=len(query),
    error=str(e),
    error_type=type(e).__name__,
)

# ❌ Bad - Unstructured logging
logger.info(f"User {user_id} searched for {query} and got {len(results)} results")
```

## Common Patterns

### Retry Logic

```python
"""Retry pattern for external services."""

from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=4, max=10),
    retry=retry_if_exception_type(ConnectionError),
)
async def call_external_api(data: Dict[str, Any]) -> Response:
    """
    Call external API with retry logic.

    Retries up to 3 times with exponential backoff for connection errors.
    """
    response = await client.post("/api/endpoint", json=data)
    return response
```

### Caching Pattern

```python
"""Simple caching pattern."""

from functools import lru_cache
from typing import Dict, Any

# In-memory cache for frequently accessed data
_cache: Dict[str, Any] = {}


async def get_user_profile_with_cache(user_id: str) -> UserProfile:
    """Get user profile with caching."""
    # Check cache first
    if user_id in _cache:
        logger.debug("Cache hit for user profile", user_id=user_id)
        return _cache[user_id]

    # Fetch from database
    profile = await supabase_client.get_user_profile(user_id)

    # Store in cache
    _cache[user_id] = profile

    return profile
```
