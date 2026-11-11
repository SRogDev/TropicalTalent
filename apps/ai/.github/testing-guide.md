# Testing guide — resumen para contributors

Breve y práctico: cómo escribir y ejecutar tests en este repo.

- Ejecutar la suite: `pytest -q` desde la raíz.
- Ejecutar tests específicos: `pytest -q -k <pattern>`.

Convenciones del proyecto:

- Tests bajo `tests/` con nombres `test_<module>.py`.
- Fixtures y mocks en `tests/conftest.py`.
- Tests nuevos: escribe primero el test que falla (TDD), luego implementa.

Focos importantes:

- Mockear clientes externos (Pinecone, Supabase, embeddings) usando fixtures.
- Mantener I/O async en tests de servicios (usar pytest-asyncio si es necesario).

Ejemplo rápido:

1. Crear test en `tests/test_myfeature.py`.
2. Usar fixtures de `conftest.py` para clientes.
3. Ejecutar `pytest -q -k myfeature` y ajustar hasta pasar.

Si necesitas más detalle, pídelo y genero ejemplos concretos extraídos de `tests/`.

# Testing Guide - TropicalTalent AI Backend

## Testing Philosophy

We follow **Test-Driven Development (TDD)** religiously:

1. **Red**: Write a failing test first
2. **Green**: Write minimal code to make it pass
3. **Refactor**: Improve code while keeping tests green

### Given-When-Then Pattern (BDD Style)

All tests MUST follow the **Given-When-Then** pattern for clarity and consistency:

- **Given** (Arrange): Set up preconditions and test data
- **When** (Act): Execute the behavior being tested
- **Then** (Assert): Verify the expected outcome

This pattern makes tests read like specifications and serves as living documentation.

## Test Structure

### Directory Organization

```
tests/
├── conftest.py                      # Shared fixtures and configuration
├── test_api.py                      # API endpoint integration tests
├── test_business.py                 # Business domain tests
├── test_creative_endpoints.py       # Creative endpoint tests
├── test_creative_services.py        # Creative service tests
├── test_models.py                   # Pydantic model validation tests
├── test_services.py                 # Service layer unit tests
└── test_vector_recommendations.py   # Vector recommendation tests
```

### Test File Naming

- **Files**: `test_<module>.py`
- **Classes**: `Test<ServiceName>` or `Test<Feature>`
- **Methods**: `test_<method>_<scenario>_<expected_result>`

### Test Method Naming Convention

Be descriptive and follow this pattern:

```
test_<method_name>_<scenario>_<expected_result>

Examples:
✅ test_search_professionals_with_valid_query_returns_results
✅ test_generate_embedding_with_empty_text_raises_error
✅ test_match_opportunities_with_filters_applies_constraints
✅ test_get_user_data_when_not_found_returns_none
✅ test_authenticate_with_invalid_key_raises_unauthorized

❌ test_search           # Too vague
❌ test_search_works     # Not descriptive
❌ test1                 # No meaning
```

## Unit vs Integration Tests: Key Differences

### Quick Decision Guide

**Choose UNIT test when**:

- Testing a single class/function/method
- Logic can be tested without external dependencies
- You want fast, focused tests
- Example: Service methods, utilities, validators

**Choose INTEGRATION test when**:

- Testing multiple components together
- Testing API endpoints (router + service + dependencies)
- Testing database operations
- Testing external API calls
- Example: HTTP endpoints, database queries, service orchestration

### Comparison Table

| Aspect | Unit Tests | Integration Tests |
|--------|-----------|-------------------|
| **Scope** | Single component | Multiple components |
| **Dependencies** | All mocked | Real or partial mocks |
| **Speed** | Fast (milliseconds) | Slower (seconds) |
| **Isolation** | Complete | Partial |
| **Purpose** | Verify logic correctness | Verify component interaction |
| **Failures** | Pinpoint exact issue | Broader failure indication |
| **Setup** | Minimal | More complex |
| **Example** | Service method logic | API endpoint flow |

### Visual Example

```
Unit Test:
┌─────────────────┐
│  Service Under  │ ← Test this only
│      Test       │
├─────────────────┤
│  Mock Client A  │ ← Mocked
│  Mock Client B  │ ← Mocked
│  Mock Service C │ ← Mocked
└─────────────────┘

Integration Test:
┌─────────────────┐
│     Router      │ ← Tests flow through all
├─────────────────┤
│     Service     │ ← Real component
├─────────────────┤
│  Mock Client A  │ ← Mocked external only
│  Mock Client B  │ ← Mocked external only
└─────────────────┘
```

### Real-World Examples

#### ❌ Wrong: Integration test disguised as unit test

```python
# BAD: Claims to be unit test but uses real database
async def test_search_service_unit():
    """Unit test for search service."""
    service = DirectSearchService(
        real_supabase_client,  # ❌ Real database!
        real_pinecone_client,   # ❌ Real vector DB!
        mock_embedding_service,
    )
    result = await service.search("query")
    assert result is not None
```

#### ✅ Correct: True unit test

```python
# GOOD: All dependencies mocked
async def test_search_service_processes_results_correctly():
    """
    Unit test: Verify service transforms vector results correctly.

    Given: Mocked vector search results
    When: Service processes the results
    Then: Results are correctly transformed and scored
    """
    # Given: All dependencies are mocked
    service = DirectSearchService(
        supabase_client=AsyncMock(),
        pinecone_client=AsyncMock(),
        embedding_service=AsyncMock(),
    )

    # Given: Mock returns predefined results
    service.pinecone_client.query.return_value = [
        Mock(id="user-1", score=0.95, metadata={"bio": "Test"})
    ]

    # When: Service is called
    result = await service.search_professionals(request)

    # Then: Results are transformed correctly
    assert result.results[0].user_id == "user-1"
```

#### ✅ Correct: True integration test

```python
# GOOD: Tests full endpoint flow
async def test_search_endpoint_returns_results():
    """
    Integration test: Full search flow through API.

    Given: Valid API request
    When: Request flows through router and service
    Then: Properly formatted response is returned
    """
    # Given: Valid HTTP request
    response = await client.post(
        "/business/direct-search",
        json={"query": "Python dev", "user_id": "123..."},
        headers={"X-API-Key": "valid-key"}
    )

    # Then: Full response cycle works
    assert response.status_code == 200
    assert "results" in response.json()
```

## Test Types

### 1. Unit Tests (Isolated Component Testing)

**Purpose**: Test individual functions/methods/classes in complete isolation with ALL dependencies mocked.

**Characteristics**:

- ✅ Fast execution (milliseconds)
- ✅ No external dependencies (DB, APIs, file system)
- ✅ Test one component at a time
- ✅ All dependencies are mocks/stubs
- ✅ Focus on business logic

**When to use**: Testing services, utilities, helpers, validators, transformers

```python
"""Unit test example using Given-When-Then."""

import pytest
from unittest.mock import AsyncMock, Mock

from app.business.services import DirectSearchService
from app.business.models import DirectSearchRequest, DirectSearchResponse


class TestDirectSearchService:
    """
    Unit tests for DirectSearchService.

    Tests service logic in isolation with mocked dependencies.
    """

    @pytest.fixture
    async def mock_supabase_client(self):
        """Given a mocked Supabase client."""
        return AsyncMock()

    @pytest.fixture
    async def mock_pinecone_client(self):
        """Given a mocked Pinecone client."""
        return AsyncMock()

    @pytest.fixture
    async def mock_embedding_service(self):
        """Given a mocked embedding service."""
        return AsyncMock()

    @pytest.fixture
    async def service(
        self,
        mock_supabase_client,
        mock_pinecone_client,
        mock_embedding_service,
    ):
        """Given a DirectSearchService with all dependencies mocked."""
        return DirectSearchService(
            supabase_client=mock_supabase_client,
            pinecone_client=mock_pinecone_client,
            embedding_service=mock_embedding_service,
        )

    async def test_search_professionals_with_valid_query_returns_results(
        self, service
    ):
        """
        Test that search returns professional results when given a valid query.

        Scenario: User searches for professionals with valid query
        Given: A valid search request
        When: The search is executed
        Then: Matching professionals are returned with scores
        """
        # Given: A valid search request
        request = DirectSearchRequest(
            query="Python developer with 5 years experience",
            user_id="123e4567-e89b-12d3-a456-426614174000",
            top_k=10,
        )

        # Given: Embedding service returns a valid embedding
        mock_embedding = [0.1] * 1536
        service.embedding_service.generate_embedding.return_value = mock_embedding

        # Given: Vector search returns matching results
        service.pinecone_client.query.return_value = [
            Mock(
                id="user-1",
                score=0.95,
                metadata={"bio": "Senior Python Developer", "tags": ["python", "django"]}
            ),
            Mock(
                id="user-2",
                score=0.87,
                metadata={"bio": "Backend Engineer", "tags": ["python", "fastapi"]}
            ),
        ]

        # When: The search is executed
        response = await service.search_professionals(request)

        # Then: A valid response is returned
        assert isinstance(response, DirectSearchResponse)

        # Then: Response contains expected number of results
        assert response.total_count == 2
        assert len(response.results) == 2

        # Then: Results are properly ordered by score
        assert response.results[0].user_id == "user-1"
        assert response.results[0].score == 0.95
        assert response.results[1].user_id == "user-2"
        assert response.results[1].score == 0.87

        # Then: Original query is preserved
        assert response.query == request.query

        # Then: Dependencies were called correctly
        service.embedding_service.generate_embedding.assert_called_once_with(
            request.query
        )
        service.pinecone_client.query.assert_called_once_with(
            vector=mock_embedding,
            top_k=20,
            include_metadata=True,
            filter=request.filters,
        )

    async def test_search_professionals_with_empty_results_returns_empty_list(
        self, service
    ):
        """
        Test that search returns empty list when no professionals match.

        Scenario: Search finds no matching professionals
        Given: A valid search request
        When: Vector search returns no results
        Then: An empty results list is returned
        """
        # Given: A valid search request
        request = DirectSearchRequest(
            query="COBOL developer",
            user_id="123e4567-e89b-12d3-a456-426614174000",
        )

        # Given: Embedding service returns embedding
        service.embedding_service.generate_embedding.return_value = [0.1] * 1536

        # Given: Vector search returns no results
        service.pinecone_client.query.return_value = []

        # When: The search is executed
        response = await service.search_professionals(request)

        # Then: Response has zero results
        assert response.total_count == 0
        assert len(response.results) == 0
        assert response.results == []

    async def test_search_professionals_with_embedding_failure_raises_exception(
        self, service
    ):
        """
        Test that search propagates exceptions from embedding service.

        Scenario: Embedding generation fails
        Given: A valid search request
        When: Embedding service fails
        Then: Exception is raised and logged
        """
        # Given: A valid search request
        request = DirectSearchRequest(
            query="Python developer",
            user_id="123e4567-e89b-12d3-a456-426614174000",
        )

        # Given: Embedding service fails
        service.embedding_service.generate_embedding.side_effect = Exception(
            "OpenAI API unavailable"
        )

        # When/Then: The search raises an exception
        with pytest.raises(Exception, match="OpenAI API unavailable"):
            await service.search_professionals(request)

    async def test_search_professionals_with_filters_applies_constraints(
        self, service
    ):
        """
        Test that search applies metadata filters correctly.

        Scenario: User searches with location and skill filters
        Given: A search request with filters
        When: The search is executed
        Then: Filters are passed to vector search
        """
        # Given: A search request with filters
        filters = {
            "location": {"$eq": "Madrid"},
            "years_experience": {"$gte": 5}
        }
        request = DirectSearchRequest(
            query="Senior developer",
            user_id="123e4567-e89b-12d3-a456-426614174000",
            filters=filters,
        )

        # Given: Services return valid responses
        service.embedding_service.generate_embedding.return_value = [0.1] * 1536
        service.pinecone_client.query.return_value = []

        # When: The search is executed
        await service.search_professionals(request)

        # Then: Filters were passed to Pinecone
        call_args = service.pinecone_client.query.call_args
        assert call_args.kwargs["filter"] == filters
```

### 2. Integration Tests (Component Interaction Testing)

**Purpose**: Test multiple components working together with real or partial dependencies.

**Characteristics**:

- ✅ Tests interactions between components
- ✅ May use real databases, APIs (test environment)
- ✅ Slower than unit tests (seconds)
- ✅ Validates data flow between layers
- ✅ Tests end-to-end scenarios

**When to use**: Testing routers with services, database operations, external API integrations

```python
"""Integration test example using Given-When-Then."""

import pytest
from httpx import AsyncClient
from unittest.mock import patch


class TestSearchEndpointIntegration:
    """
    Integration tests for search endpoint.

    Tests full request/response cycle through router and service layers.
    """

    @pytest.mark.asyncio
    async def test_search_endpoint_with_valid_request_returns_successful_response(
        self,
        client: AsyncClient,
        valid_api_key: str,
    ):
        """
        Test complete search flow from HTTP request to response.

        Scenario: User makes valid search request via API
        Given: A valid search request payload
        When: The request is sent to the search endpoint
        Then: A successful response with results is returned
        """
        # Given: A valid search request payload
        request_data = {
            "query": "Python developer with machine learning experience",
            "user_id": "123e4567-e89b-12d3-a456-426614174000",
            "top_k": 5,
            "filters": {
                "location": "Madrid"
            }
        }

        # Given: Valid authentication headers
        headers = {"X-API-Key": valid_api_key}

        # When: The request is sent to the search endpoint
        response = await client.post(
            "/business/direct-search",
            json=request_data,
            headers=headers,
        )

        # Then: Response status is 200 OK
        assert response.status_code == 200

        # Then: Response contains expected structure
        data = response.json()
        assert "results" in data
        assert "total_count" in data
        assert "query" in data

        # Then: Results is a list
        assert isinstance(data["results"], list)

        # Then: Query matches request
        assert data["query"] == request_data["query"]

        # Then: Each result has required fields
        for result in data["results"]:
            assert "user_id" in result
            assert "score" in result
            assert 0 <= result["score"] <= 1

    @pytest.mark.asyncio
    async def test_search_endpoint_with_invalid_api_key_returns_unauthorized(
        self,
        client: AsyncClient,
    ):
        """
        Test that invalid API key is rejected.

        Scenario: User attempts to access endpoint with invalid key
        Given: A search request with invalid API key
        When: The request is sent
        Then: 401 Unauthorized is returned
        """
        # Given: A valid request payload
        request_data = {
            "query": "Python developer",
            "user_id": "123e4567-e89b-12d3-a456-426614174000",
        }

        # Given: Invalid API key
        headers = {"X-API-Key": "invalid-key-12345"}

        # When: The request is sent
        response = await client.post(
            "/business/direct-search",
            json=request_data,
            headers=headers,
        )

        # Then: Response is 401 Unauthorized
        assert response.status_code == 401

        # Then: Error detail is provided
        data = response.json()
        assert "detail" in data

    @pytest.mark.asyncio
    async def test_search_endpoint_with_missing_required_fields_returns_validation_error(
        self,
        client: AsyncClient,
        valid_api_key: str,
    ):
        """
        Test that missing required fields trigger validation errors.

        Scenario: User sends incomplete request
        Given: A request missing required fields
        When: The request is sent
        Then: 422 Validation Error is returned
        """
        # Given: A request missing the query field
        request_data = {
            "user_id": "123e4567-e89b-12d3-a456-426614174000",
            # Missing "query" field
        }

        # Given: Valid authentication
        headers = {"X-API-Key": valid_api_key}

        # When: The request is sent
        response = await client.post(
            "/business/direct-search",
            json=request_data,
            headers=headers,
        )

        # Then: Response is 422 Unprocessable Entity
        assert response.status_code == 422

        # Then: Validation errors are detailed
        data = response.json()
        assert "detail" in data

    @pytest.mark.asyncio
    async def test_search_endpoint_with_invalid_uuid_returns_validation_error(
        self,
        client: AsyncClient,
        valid_api_key: str,
    ):
        """
        Test that invalid UUID format is rejected.

        Scenario: User sends request with malformed UUID
        Given: A request with invalid UUID format
        When: The request is sent
        Then: Validation error is returned
        """
        # Given: A request with invalid UUID
        request_data = {
            "query": "Python developer",
            "user_id": "not-a-valid-uuid",
        }

        # Given: Valid authentication
        headers = {"X-API-Key": valid_api_key}

        # When: The request is sent
        response = await client.post(
            "/business/direct-search",
            json=request_data,
            headers=headers,
        )

        # Then: Response indicates validation error
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_search_endpoint_handles_service_failures_gracefully(
        self,
        client: AsyncClient,
        valid_api_key: str,
    ):
        """
        Test that service failures return appropriate errors.

        Scenario: Backend service fails during request
        Given: A valid request
        When: The underlying service fails
        Then: 500 Internal Server Error is returned
        """
        # Given: A valid request
        request_data = {
            "query": "Python developer",
            "user_id": "123e4567-e89b-12d3-a456-426614174000",
        }
        headers = {"X-API-Key": valid_api_key}

        # Given: Embedding service will fail
        with patch('app.services.embedding_service.generate_embedding') as mock:
            mock.side_effect = Exception("Service unavailable")

            # When: The request is sent
            response = await client.post(
                "/business/direct-search",
                json=request_data,
                headers=headers,
            )

            # Then: Response indicates server error
            assert response.status_code == 500
```

### 3. Model Validation Tests

Test Pydantic models validate data correctly.

```python
"""Model validation test example."""

import pytest
from pydantic import ValidationError

from app.business.models import DirectSearchRequest


class TestDirectSearchRequest:
    """Test DirectSearchRequest validation."""

    def test_valid_request_passes_validation(self):
        """Test model accepts valid data."""
        # Arrange & Act
        request = DirectSearchRequest(
            query="Python developer",
            user_id="123e4567-e89b-12d3-a456-426614174000",
            top_k=10,
        )

        # Assert
        assert request.query == "Python developer"
        assert request.top_k == 10

    def test_empty_query_raises_validation_error(self):
        """Test model rejects empty query."""
        # Arrange & Act & Assert
        with pytest.raises(ValidationError, match="Query cannot be empty"):
            DirectSearchRequest(
                query="   ",  # Only whitespace
                user_id="123e4567-e89b-12d3-a456-426614174000",
            )

    def test_invalid_uuid_raises_validation_error(self):
        """Test model rejects invalid UUID format."""
        # Arrange & Act & Assert
        with pytest.raises(ValidationError, match="valid UUID"):
            DirectSearchRequest(
                query="Python developer",
                user_id="not-a-uuid",
            )

    def test_top_k_exceeds_maximum_raises_validation_error(self):
        """Test model rejects top_k above maximum."""
        # Arrange & Act & Assert
        with pytest.raises(ValidationError):
            DirectSearchRequest(
                query="Python developer",
                user_id="123e4567-e89b-12d3-a456-426614174000",
                top_k=101,  # Max is 100
            )
```

## Fixtures

### conftest.py Setup

```python
"""Shared test fixtures and configuration."""

import pytest
from httpx import AsyncClient
from unittest.mock import AsyncMock

from app.main import create_application


@pytest.fixture
def anyio_backend():
    """Configure async test backend."""
    return 'asyncio'


@pytest.fixture
async def app():
    """Create test application instance."""
    return create_application()


@pytest.fixture
async def client(app):
    """Create async test client."""
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac


@pytest.fixture
def valid_api_key():
    """Provide valid API key for tests."""
    return "test-api-key-123"


@pytest.fixture
def mock_supabase_client():
    """Create mocked Supabase client."""
    client = AsyncMock()
    client.get_user_profile.return_value = {
        "user_id": "test-user",
        "full_name": "Test User",
    }
    return client


@pytest.fixture
def mock_pinecone_client():
    """Create mocked Pinecone client."""
    client = AsyncMock()
    client.query.return_value = []
    return client


@pytest.fixture
def mock_embedding_service():
    """Create mocked embedding service."""
    service = AsyncMock()
    service.generate_embedding.return_value = [0.1] * 1536
    return service
```

## Mocking Strategies

### AsyncMock for Async Functions

```python
"""Example of mocking async functions."""

from unittest.mock import AsyncMock
import pytest


@pytest.fixture
async def service_with_mocks():
    """Service with all dependencies mocked."""
    service = MyService()

    # Mock async methods
    service.fetch_data = AsyncMock(return_value={"data": "test"})
    service.save_data = AsyncMock(return_value=True)

    return service


async def test_process_with_mocked_dependencies(service_with_mocks):
    """Test process method with mocked dependencies."""
    # Act
    result = await service_with_mocks.process({"input": "data"})

    # Assert
    assert result is not None
    service_with_mocks.fetch_data.assert_called_once()
    service_with_mocks.save_data.assert_called_once()
```

### Patch for External Dependencies

```python
"""Example of patching external dependencies."""

from unittest.mock import patch, Mock
import pytest


@patch('app.services.external_api.requests')
async def test_call_external_api_success(mock_requests):
    """Test external API call with mocked requests."""
    # Arrange
    mock_response = Mock()
    mock_response.json.return_value = {"status": "success"}
    mock_requests.post.return_value = mock_response

    # Act
    result = await call_external_api({"data": "test"})

    # Assert
    assert result["status"] == "success"
    mock_requests.post.assert_called_once()
```

## Testing Async Code

### Basic Async Test

```python
"""Basic async test example."""

import pytest


@pytest.mark.asyncio
async def test_async_function():
    """Test async function."""
    result = await async_function()
    assert result is not None
```

### Testing Concurrent Operations

```python
"""Test concurrent operations."""

import pytest
import asyncio


@pytest.mark.asyncio
async def test_concurrent_operations():
    """Test multiple async operations run concurrently."""
    # Arrange
    start_time = asyncio.get_event_loop().time()

    # Act - These should run concurrently
    results = await asyncio.gather(
        slow_operation_1(),
        slow_operation_2(),
        slow_operation_3(),
    )

    end_time = asyncio.get_event_loop().time()
    duration = end_time - start_time

    # Assert
    assert len(results) == 3
    # If operations were sequential, this would take 3+ seconds
    # Concurrent should take ~1 second (longest operation)
    assert duration < 1.5  # Some buffer for test execution
```

## Error Testing

### Testing Exceptions

```python
"""Test exception handling."""

import pytest
from fastapi import HTTPException


async def test_invalid_input_raises_validation_error():
    """Test service raises error for invalid input."""
    service = MyService()

    with pytest.raises(ValueError, match="Invalid input"):
        await service.process(invalid_data)


async def test_not_found_raises_http_exception():
    """Test endpoint raises 404 for missing resource."""
    with pytest.raises(HTTPException) as exc_info:
        await get_resource("nonexistent-id")

    assert exc_info.value.status_code == 404
    assert "not found" in exc_info.value.detail.lower()
```

### Testing Error Recovery

```python
"""Test error recovery and retry logic."""

import pytest
from unittest.mock import AsyncMock


async def test_retry_logic_on_failure():
    """Test function retries on failure."""
    # Arrange
    mock_client = AsyncMock()
    # Fail twice, then succeed
    mock_client.call.side_effect = [
        ConnectionError("Failed"),
        ConnectionError("Failed"),
        {"status": "success"},
    ]

    # Act
    result = await retry_function(mock_client)

    # Assert
    assert result["status"] == "success"
    assert mock_client.call.call_count == 3
```

## Test Coverage

### Running Tests with Coverage

```bash
# Run all tests with coverage
pytest --cov=app --cov-report=html --cov-report=term

# Run specific test file
pytest tests/test_services.py -v

# Run specific test
pytest tests/test_services.py::TestDirectSearchService::test_search_with_valid_query -v

# Run tests matching pattern
pytest -k "search" -v
```

### Coverage Goals

- **Target**: 85%+ code coverage
- **Critical paths**: 100% coverage (authentication, payments, data integrity)
- **Services**: 90%+ coverage
- **Routers**: 85%+ coverage
- **Models**: 100% coverage (validation tests)

### Coverage Reports

```bash
# Generate HTML coverage report
pytest --cov=app --cov-report=html

# View report
open htmlcov/index.html
```

## Testing Best Practices

### Given-When-Then Pattern (MANDATORY)

All tests MUST follow the Given-When-Then pattern with explicit comments:

```python
async def test_function_behavior():
    """
    Test that function returns success status when given valid input.

    Scenario: Function processes valid input successfully
    Given: Valid input data
    When: Function is executed
    Then: Success status is returned
    """
    # Given: Valid input data is prepared
    input_data = create_test_data()
    expected_result = {"status": "success"}

    # When: The function is executed with the input
    result = await function_under_test(input_data)

    # Then: The result matches expected success status
    assert result == expected_result
    assert result["status"] == "success"
```

**Pattern Breakdown**:

- **Given** (Arrange): Set up preconditions, test data, mocks
- **When** (Act): Execute the behavior/function being tested
- **Then** (Assert): Verify expected outcomes and side effects

### One Assertion Per Test (Generally)

```python
# ✅ Good - Focused test
async def test_search_returns_correct_count():
    """Test search returns correct number of results."""
    results = await search("query")
    assert len(results) == 5


async def test_search_returns_sorted_results():
    """Test search returns results sorted by score."""
    results = await search("query")
    scores = [r.score for r in results]
    assert scores == sorted(scores, reverse=True)


# ❌ Less ideal - Multiple unrelated assertions
async def test_search():
    """Test search function."""  # Vague description
    results = await search("query")
    assert len(results) == 5  # Testing count
    assert results[0].score > 0.8  # Testing score
    assert all(r.user_id for r in results)  # Testing IDs
    # Too many concerns in one test
```

### Test Independence

```python
# ✅ Good - Each test is independent
@pytest.fixture
async def fresh_service():
    """Create fresh service for each test."""
    return MyService()


async def test_function_a(fresh_service):
    """Test A doesn't affect other tests."""
    await fresh_service.do_something()
    assert fresh_service.state == "expected"


async def test_function_b(fresh_service):
    """Test B starts with clean state."""
    # Independent of test_function_a
    await fresh_service.do_other_thing()
    assert fresh_service.state == "different"
```

### Descriptive Test Names

```python
# ✅ Good - Clear what's being tested
async def test_search_with_filters_applies_location_constraint():
    """Test search correctly filters by location."""
    pass


async def test_embedding_generation_with_empty_text_raises_value_error():
    """Test embedding service rejects empty text input."""
    pass


# ❌ Bad - Unclear purpose
async def test_search():
    """Test search."""  # What about search?
    pass


async def test_error():
    """Test error."""  # What error? When?
    pass
```

## Common Test Patterns

### Testing API Endpoints

```python
"""Complete API endpoint test."""

@pytest.mark.asyncio
async def test_complete_search_flow(client: AsyncClient, valid_api_key: str):
    """Test complete search flow from request to response."""
    # Arrange
    request_data = {
        "query": "Python developer",
        "user_id": "123e4567-e89b-12d3-a456-426614174000",
        "filters": {"location": "Madrid"},
    }

    # Act
    response = await client.post(
        "/business/direct-search",
        json=request_data,
        headers={"X-API-Key": valid_api_key},
    )

    # Assert
    assert response.status_code == 200

    data = response.json()
    assert "results" in data
    assert "total_count" in data
    assert data["query"] == request_data["query"]
    assert isinstance(data["results"], list)

    # Verify result structure if results exist
    if data["results"]:
        first_result = data["results"][0]
        assert "user_id" in first_result
        assert "score" in first_result
        assert 0 <= first_result["score"] <= 1
```

### Testing Database Operations

```python
"""Database operation tests."""

@pytest.mark.asyncio
async def test_database_insert_and_retrieve():
    """Test data can be inserted and retrieved."""
    # Arrange
    test_data = {"user_id": "test-123", "name": "Test User"}

    # Act - Insert
    await db_client.insert("users", test_data)

    # Act - Retrieve
    result = await db_client.get("users", "test-123")

    # Assert
    assert result["user_id"] == test_data["user_id"]
    assert result["name"] == test_data["name"]

    # Cleanup
    await db_client.delete("users", "test-123")
```

### Parametrized Tests

```python
"""Parametrized test example."""

@pytest.mark.parametrize(
    "query,expected_count",
    [
        ("Python developer", 5),
        ("Java engineer", 3),
        ("DevOps specialist", 2),
    ]
)
async def test_search_returns_expected_count(query: str, expected_count: int):
    """Test search returns expected number of results for different queries."""
    results = await search(query)
    assert len(results) == expected_count
```

## TDD Workflow Example

### 1. Write Failing Test (Red)

```python
"""Step 1: Write the test first."""

async def test_calculate_relevance_score_returns_float_between_0_and_1():
    """Test relevance score calculation returns valid score."""
    # Arrange
    profile = UserProfile(bio="Python developer", tags=["python", "api"])
    query = "Python engineer"

    # Act
    score = calculate_relevance_score(profile, query)

    # Assert
    assert isinstance(score, float)
    assert 0 <= score <= 1
```

**Run test**: `pytest tests/test_relevance.py -v`
**Result**: ❌ FAIL - Function doesn't exist yet

### 2. Write Minimal Code (Green)

```python
"""Step 2: Implement minimal code to pass."""

def calculate_relevance_score(profile: UserProfile, query: str) -> float:
    """Calculate relevance score between profile and query."""
    # Minimal implementation to pass test
    return 0.5  # Simple stub that passes basic test
```

**Run test**: `pytest tests/test_relevance.py -v`
**Result**: ✅ PASS

### 3. Add More Tests

```python
"""Step 3: Add more comprehensive tests."""

async def test_calculate_relevance_score_with_exact_match_returns_high_score():
    """Test exact match returns high score."""
    profile = UserProfile(bio="Python developer", tags=["python"])
    query = "Python developer"

    score = calculate_relevance_score(profile, query)

    assert score > 0.8


async def test_calculate_relevance_score_with_no_match_returns_low_score():
    """Test no match returns low score."""
    profile = UserProfile(bio="Java developer", tags=["java"])
    query = "Python developer"

    score = calculate_relevance_score(profile, query)

    assert score < 0.3
```

**Run tests**: Some will fail now
**Result**: ❌ FAIL - Need real implementation

### 4. Refine Implementation

```python
"""Step 4: Implement actual logic."""

def calculate_relevance_score(profile: UserProfile, query: str) -> float:
    """
    Calculate relevance score between profile and query.

    Uses keyword matching and semantic similarity.
    """
    query_words = set(query.lower().split())
    bio_words = set(profile.bio.lower().split())
    tags = set(tag.lower() for tag in profile.tags)

    # Keyword overlap
    keyword_matches = query_words & bio_words
    tag_matches = query_words & tags

    # Calculate score
    keyword_score = len(keyword_matches) / len(query_words) if query_words else 0
    tag_score = len(tag_matches) / len(query_words) if query_words else 0

    # Weighted combination
    final_score = (keyword_score * 0.6) + (tag_score * 0.4)

    return min(1.0, max(0.0, final_score))
```

**Run tests**: `pytest tests/test_relevance.py -v`
**Result**: ✅ ALL PASS

### 5. Refactor (While Tests Pass)

```python
"""Step 5: Improve code quality."""

from typing import Set


def calculate_relevance_score(profile: UserProfile, query: str) -> float:
    """
    Calculate relevance score between profile and query using keyword matching.

    Args:
        profile: User profile to score
        query: Search query string

    Returns:
        Relevance score between 0.0 and 1.0

    Example:
        >>> profile = UserProfile(bio="Python dev", tags=["python"])
        >>> calculate_relevance_score(profile, "Python developer")
        0.85
    """
    query_words = _extract_words(query)

    keyword_score = _calculate_keyword_score(profile.bio, query_words)
    tag_score = _calculate_tag_score(profile.tags, query_words)

    return _weighted_score(keyword_score, tag_score)


def _extract_words(text: str) -> Set[str]:
    """Extract normalized words from text."""
    return set(text.lower().split())


def _calculate_keyword_score(bio: str, query_words: Set[str]) -> float:
    """Calculate score based on keyword matches in bio."""
    bio_words = _extract_words(bio)
    matches = query_words & bio_words
    return len(matches) / len(query_words) if query_words else 0.0


def _calculate_tag_score(tags: List[str], query_words: Set[str]) -> float:
    """Calculate score based on tag matches."""
    tag_words = set(tag.lower() for tag in tags)
    matches = query_words & tag_words
    return len(matches) / len(query_words) if query_words else 0.0


def _weighted_score(keyword_score: float, tag_score: float) -> float:
    """Calculate weighted final score."""
    KEYWORD_WEIGHT = 0.6
    TAG_WEIGHT = 0.4
    raw_score = (keyword_score * KEYWORD_WEIGHT) + (tag_score * TAG_WEIGHT)
    return min(1.0, max(0.0, raw_score))
```

**Run tests**: `pytest tests/test_relevance.py -v`
**Result**: ✅ ALL PASS - Code is now cleaner and well-tested!

## Continuous Testing

### Pre-commit Hook

```bash
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: pytest
        name: pytest
        entry: pytest
        language: system
        pass_filenames: false
        always_run: true
```

### CI/CD Pipeline

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Set up Python
        uses: actions/setup-python@v2
        with:
          python-version: '3.12'
      - name: Install dependencies
        run: |
          uv sync --group dev
      - name: Run tests
        run: |
          pytest --cov=app --cov-report=xml
      - name: Upload coverage
        uses: codecov/codecov-action@v2
```
