# Test Suite Documentation

## Overview

This test suite follows **Test-Driven Development (TDD)** principles and the **Given-When-Then** pattern. All tests focus on **behavior, not implementation**, ensuring tests remain valid even when refactoring code.

## Test Structure

```
tests/
├── conftest.py                 # Shared fixtures and configuration
├── test_auth.py               # Authentication tests (unit)
├── test_endpoints.py          # API endpoint tests (integration)
├── test_services.py           # Service layer tests (unit)
└── test_infrastructure.py     # Infrastructure tests (unit + integration)
```

## Test Categories

### 🔵 Unit Tests (`@pytest.mark.unit`)

- Test individual components in isolation
- Use mocks for external dependencies
- Fast execution (<100ms per test)
- Examples: auth, services, validation

### 🟢 Integration Tests (`@pytest.mark.integration`)

- Test complete request/response cycles
- May use real or mocked external services
- Slower execution (100ms-1s per test)
- Examples: API endpoints, database interactions

### 🔴 Slow Tests (`@pytest.mark.slow`)

- Tests that take >1 second
- Usually involve real external services
- Run separately in CI/CD

## Test Pattern: Given-When-Then

All tests follow this structure:

```python
async def test_feature_with_condition_produces_result(self):
    """
    Given: Specific preconditions and setup
    When: Action is performed
    Then: Expected result occurs
    """
    # Given - Setup and preconditions
    user_data = {"id": "123", "email": "test@example.com"}
    
    # When - Perform the action
    result = await authenticate_user(user_data)
    
    # Then - Verify the outcome
    assert result.is_authenticated is True
    assert result.user_id == "123"
```

## Running Tests

### Run All Tests

```bash
pytest
```

### Run Specific Test Categories

```bash
# Unit tests only
pytest -m unit

# Integration tests only
pytest -m integration

# Authentication tests
pytest -m auth

# Exclude slow tests
pytest -m "not slow"
```

### Run Specific Test Files

```bash
pytest tests/test_auth.py
pytest tests/test_endpoints.py
pytest tests/test_services.py
```

### Run Specific Test Classes or Functions

```bash
# Run a specific test class
pytest tests/test_auth.py::TestAuthentication

# Run a specific test function
pytest tests/test_auth.py::TestAuthentication::test_get_current_user_with_valid_token_returns_user_data
```

### Run with Verbose Output

```bash
pytest -v
pytest -vv  # Extra verbose
```

### Run with Coverage

```bash
# Generate coverage report
pytest --cov=app --cov-report=html

# View coverage in terminal
pytest --cov=app --cov-report=term

# Minimum coverage threshold
pytest --cov=app --cov-fail-under=85
```

### Run in Parallel (faster)

```bash
pytest -n auto  # Use all CPU cores
pytest -n 4     # Use 4 workers
```

### Run Failed Tests Only

```bash
# Run only tests that failed in last run
pytest --lf

# Run failed tests first, then remaining
pytest --ff
```

## Test Coverage Goals

### Critical Components (Must have >90% coverage)

- ✅ Authentication (`app/dependencies/auth.py`)
- ✅ Endpoints (`app/routes/*.py`)
- ✅ Core services (`app/services/search.py`, `vectorize.py`, `recommendations.py`)

### Important Components (Must have >80% coverage)

- ✅ Models and validation (`app/models/*.py`)
- ✅ Configuration (`app/core/config.py`)
- ✅ Database clients (`app/core/database.py`)

### Overall Target

- 🎯 **Minimum: 85% coverage**
- 🏆 **Goal: 90% coverage**

## Writing New Tests

### Test Naming Convention

```python
def test_<method>_<scenario>_<expected_result>(self):
    """
    Given: <preconditions>
    When: <action>
    Then: <expected outcome>
    """
```

Examples:

- `test_get_current_user_with_valid_token_returns_user_data`
- `test_search_users_with_empty_results_returns_empty_list`
- `test_vectorize_profile_with_youtube_url_analyzes_video`

### Best Practices

#### ✅ DO

- Test behavior, not implementation
- Use descriptive test names
- Follow Given-When-Then pattern
- Mock external dependencies
- Test edge cases and error conditions
- Keep tests independent and isolated
- Use fixtures for common setup

#### ❌ DON'T

- Test implementation details
- Share state between tests
- Use production credentials
- Skip error case testing
- Write tests that depend on execution order
- Mock what you're testing
- Leave tests commented out

### Example: Good Test

```python
@pytest.mark.asyncio
async def test_search_users_with_valid_query_returns_relevant_results(
    self, sample_search_request, mock_pinecone_client
):
    """
    Given: A valid search query and mocked vector search
    When: search_users is called
    Then: Relevant user results are returned sorted by score
    """
    # Given
    request = SearchRequest(**sample_search_request)
    
    with patch('app.services.search.Pinecone', return_value=mock_pinecone_client):
        # When
        result = await search_users(request)
        
        # Then
        assert result.total_results > 0
        assert result.results[0].score >= result.results[1].score
```

### Example: Bad Test (Anti-pattern)

```python
# ❌ BAD: Tests implementation, not behavior
def test_search_uses_pinecone_index():
    """Tests that search calls Pinecone.Index()"""
    search_users("test query")
    # This tests HOW it's done, not WHAT it does
```

## Continuous Integration

Tests run automatically on:

- Every commit
- Pull request creation
- Merge to main branch

### CI Pipeline

```yaml
1. Install dependencies
2. Run linters (Black, isort, mypy)
3. Run tests with coverage
4. Generate coverage report
5. Fail if coverage < 85%
```

## Debugging Failed Tests

### View detailed output

```bash
pytest -vv --tb=long
```

### Drop into debugger on failure

```bash
pytest --pdb
```

### Show print statements

```bash
pytest -s
```

### Run single test with full output

```bash
pytest tests/test_auth.py::TestAuthentication::test_name -vv -s
```

## Test Fixtures

### Common Fixtures (from `conftest.py`)

- `client` - Synchronous test client for API requests
- `async_client` - Asynchronous test client
- `mock_supabase_client` - Mocked Supabase for auth testing
- `mock_pinecone_client` - Mocked Pinecone for vector operations
- `mock_embeddings` - Mocked embedding generation
- `valid_auth_token` - Valid JWT token for authenticated requests
- `invalid_auth_token` - Invalid token for error testing
- `sample_profile_data` - Sample user profile data
- `sample_search_request` - Sample search request data

### Using Fixtures

```python
async def test_my_feature(self, client, valid_auth_token):
    """Test uses client and auth token fixtures"""
    response = client.get(
        "/endpoint",
        headers={"Authorization": f"Bearer {valid_auth_token}"}
    )
    assert response.status_code == 200
```

## Troubleshooting

### Import Errors

```bash
# Ensure you're in project root
cd /path/to/project

# Install test dependencies
uv sync --group dev
```

### Environment Variables

Tests use test environment variables set in `conftest.py`. Don't worry about `.env` file for testing.

### Async Tests Failing

Ensure you have `@pytest.mark.asyncio` decorator on async test functions.

### Mock Not Working

Verify mock patch path matches actual import path in the code being tested.

## Additional Resources

- [pytest Documentation](https://docs.pytest.org/)
- [pytest-asyncio](https://pytest-asyncio.readthedocs.io/)
- [unittest.mock](https://docs.python.org/3/library/unittest.mock.html)
- [Coverage.py](https://coverage.readthedocs.io/)

## Test Metrics

Run this to see current test metrics:

```bash
# Test count by category
pytest --collect-only

# Coverage report
pytest --cov=app --cov-report=term-missing

# Performance report
pytest --durations=10
```

---

**Remember:** Tests are documentation. They should clearly communicate what the system does and how it behaves.
