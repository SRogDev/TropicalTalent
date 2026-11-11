# Copilot — repo quick notes

Very short, practical rules to be productive in this repository.

- Entrypoint: `run.py` -> `app/main.py` (FastAPI)
- Main areas: `app/core/` (infra) and `creative/` (feature domain)
- Pattern: Router → Service → Business logic. Keep routers thin.

Essentials
- All I/O must be async (`async def` + `await`).
- Use Pydantic models from `creative/models/` for validation and shapes.
- Use FastAPI `Depends` to inject services/clients; don't instantiate infra in routers.

Quick commands
- Install: `uv sync`
- Run: `python run.py`
- Tests: `pytest -q` (use `-k` to run specific tests)

Key files to inspect first: `app/core/config.py`, `creative/services/embedding_service.py`, `app/core/vector_store.py`, `creative/routers/search.py`.

Ask to expand: env var list, test template, or CI notes.
# Copilot / AI agent quick instructions — tropicaltalent-ai-backend

Use this as the minimal, actionable guidance to become productive in this repository.
Keep answers and edits precise, follow existing patterns, and prefer small, easily testable changes.

## Big picture (what this repo is)
- FastAPI-based backend (see `app/main.py`) with domain split between `app/core` (infrastructure) and `creative/` (feature domain).
- Pattern: Router → Service → Business logic. Routers live in `creative/routers/`, services in `creative/services/`, models in `creative/models/`.
- Async-first: all IO is `async` — maintain `async def` and `await` on I/O calls.

## Key files and where to look
- Configuration & secrets: `app/core/config.py` (Pydantic settings) — do not hardcode secrets.
- External clients: `app/core/pinecone_client.py`, `app/core/supabase_service.py`, `app/core/embedding_search.py` — these are integration points (Pinecone, Supabase, embeddings).
- Vector/embedding logic: `creative/services/embedding_service.py` and `app/core/vector_store.py`.
- Entrypoints & startup: `run.py` and `app/main.py`.

## Project-specific conventions (must follow)
- Strict separation of concerns: routers only handle HTTP concerns; business logic must live in services under `creative/services/` or `app/core/` for infra.
- Use Pydantic models in `creative/models/` for request/response shapes.
- All I/O must be async (no blocking calls in async functions).
- Dependency injection: follow patterns used in `creative/routers/*` (use FastAPI Depends where present).

## Tests & TDD signals

> **⚡ TEST Keyword**: When the user writes **TEST** (all caps), it means TDD mode — write or update the `pytest` test FIRST (failing), then implement. Do not write implementation before the test exists.

- Tests are present in `tests/`. New features or fixes should include a small test (unit or integration) demonstrating behavior before implementation.
- Run tests locally with: `pytest -q` (project root). Use `-k <pattern>` to run focused tests.

## How to run & debug locally (quick commands)
- Install deps: `uv sync` (add `--group dev` for dev tools) when applicable.
- Start the app (dev): `python run.py` (reads `app/main.py`).
- Run tests: `pytest -q`.

## External integrations & env
- Pinecone, Supabase, and embedding providers are integrated; their clients live under `app/core/`.
- Look at `app/core/config.py` to find environment variable names required for local runs and tests; ensure mocks in tests cover them.

## Concrete examples (follow these patterns)
- To add a new endpoint: create Pydantic models in `creative/models/`, an orchestrating service in `creative/services/`, and a thin router in `creative/routers/` that depends on the service.
- To call external APIs concurrently: use `asyncio.gather(...)` as shown in `creative/services/vectorize.py`.
- To add a new DB or vector query, reuse `app/core/vector_store.py` and `app/core/embedding_search.py` patterns — they centralize filtering and top-k logic.

## Tests & naming patterns
- Test files: `tests/test_<feature>.py`. Example: `tests/test_creative_services.py`.
- Test names are descriptive and use `test_<unit>_<scenario>_<expected>`.

## Small-rule checklist for edits
1. Update or add tests first (one passing minimal test + one edge case).
2. Keep changes modular and small (one file / small set of files). Follow the Router→Service→Logic split.
3. Use `app/core/config.py` for settings; never hardcode secrets.
4. Preserve async behavior and type annotations.

## Where to look for examples
- Router → `creative/routers/search.py`
- Service orchestration → `creative/services/search.py` and `vectorize.py`
- External client usage → `app/core/pinecone_client.py` and `app/core/supabase_service.py`

If anything here is unclear or you want more detail in a specific area (tests, CI, or integration patterns), tell me which part and I will expand this file with targeted examples.
# GitHub Copilot Instructions - TropicalTalent AI Backend

## 📚 Context Files Reference

Before starting any task, consult the relevant context files in `.github/` directory:

### When to Read Each Context File

| File | When to Consult | Contains |
|------|----------------|----------|
| **project-structure.md** | - Starting any new task<br>- Need to understand module organization<br>- Unsure where to place new code<br>- Adding new features | - Complete directory structure<br>- Module descriptions<br>- Data flow patterns<br>- Technology stack |
| **database.md** | - Working with user data<br>- Implementing search/matching features<br>- Querying PostgreSQL<br>- Working with Pinecone vectors<br>- Adding database operations | - PostgreSQL schema<br>- Pinecone vector structure<br>- All table definitions<br>- Query examples<br>- Data relationships |
| **llm.md** | - Working with AI/LLM features<br>- Initializing Gemini models<br>- Generating embeddings<br>- Query enrichment or text generation<br>- Choosing which Gemini model to use<br>- Using LangChain for AI operations | - Gemini model guide<br>- LangChain integration patterns<br>- Singleton pattern for models<br>- ChatGoogleGenerativeAI usage<br>- GoogleGenerativeAIEmbeddings usage<br>- When to use Flash vs Pro |
| **testing-guide.md** | - Writing new tests<br>- Before implementing any feature (TDD)<br>- Setting up test fixtures<br>- Understanding Given-When-Then pattern<br>- Debugging test failures | - TDD workflow<br>- Test naming conventions<br>- Unit vs Integration tests<br>- Mocking strategies<br>- Coverage requirements |
| **code-examples.md** | - Need implementation reference<br>- Unsure of coding patterns<br>- Learning project conventions<br>- Implementing new services/routers | - Complete service examples<br>- Router patterns<br>- Pydantic models<br>- Async patterns<br>- Error handling examples |
| **copilot-instructions.md** (this file) | - All the time<br>- Before writing any code<br>- During code review | - Coding conventions<br>- Architecture patterns<br>- Best practices<br>- When to read other files |

### Usage Examples

```python
# ❌ Wrong: Writing code without context
# User asks: "Add a new search endpoint with AI query enrichment"
# You immediately start coding without understanding:
# - Where endpoints go (check project-structure.md)
# - What database queries are needed (check database.md)
# - Which Gemini model to use (check llm.md)
# - How to use LangChain (check llm.md)
# - How to write tests first (check testing-guide.md)
# - What the code pattern should look like (check code-examples.md)

# ✅ Correct: Context-driven development
# User asks: "Add a new search endpoint with AI query enrichment"
# 1. Read project-structure.md → Endpoints go in app/business/routers/
# 2. Read database.md → Understand available tables and Pinecone queries
# 3. Read llm.md → Use ChatGoogleGenerativeAI with gemini-2.0-flash-exp
# 4. Read llm.md → Use LangChain singleton pattern for model initialization
# 5. Read testing-guide.md → Write test first (TDD)
# 6. Read code-examples.md → Follow established patterns
# 7. Write test following Given-When-Then
# 8. Implement following service orchestration pattern
```

### Quick Decision Tree

```
Starting a new task?
├─ Is it a new feature or endpoint?
│  ├─ YES → Read project-structure.md + code-examples.md
│  └─ NO → Continue
│
├─ Does it involve database operations?
│  ├─ YES → Read database.md
│  └─ NO → Continue
│
├─ Does it involve AI/LLM operations?
│  ├─ YES → Read llm.md (LangChain patterns, model selection)
│  └─ NO → Continue
│
├─ Am I about to write code?
│  ├─ YES → Read testing-guide.md (write test first!)
│  └─ NO → Continue
│
└─ Follow copilot-instructions.md conventions
```

---

## Architecture Pattern: Service Orchestration

This project follows the **Service Orchestration Pattern** with strict separation of concerns:

### Layer Structure
```
Router → Service → Business Logic Services
  ↓         ↓              ↓
Request   Orchestration  Core Logic
```

**Rules:**
1. **Routers** handle HTTP concerns only (validation, authentication, response formatting)
2. **Services** orchestrate business logic by coordinating multiple operations
3. **Business Logic Services** contain pure domain logic and data operations
4. Each layer communicates through well-defined interfaces (Pydantic models)

### Example Flow
```python
# Router Layer (app/business/routers/matching.py)
@router.post("/matching")
async def internal_matching(
    request: MatchingRequest,
    service: OpportunityMatchingService = Depends(get_service)
):
    return await service.match_opportunities(request)

# Service Layer (app/business/services/opportunity_matching.py)
class OpportunityMatchingService:
    async def match_opportunities(self, request: MatchingRequest):
        # Orchestrate multiple operations
        embedding = await self.embedding_service.generate_embedding(...)
        results = await self.pinecone_client.query(...)
        enriched = await self.supabase_client.enrich_results(...)
        return self._format_response(enriched)
```

---

## Code Modularization - IMPERATIVE

### Modularization is Non-Negotiable

**Every piece of code MUST be modular and follow Single Responsibility Principle:**

1. **NO business logic in routers** - Only HTTP concerns
2. **NO helper functions in orchestrators** - Extract to specialized services
3. **NO God classes** - Split large classes into smaller, focused ones
4. **ONE responsibility per module** - Clear, focused purpose

### Modularization Rules

```python
# ❌ WRONG: Helper functions mixed with orchestration
class VectorizeService:
    async def vectorize(self, data):
        # Business logic mixed with helpers
        text = self._normalize(data)  # Helper in same file
        lemmas = self._lemmatize(text)  # Helper in same file
        embedding = await self._embed(lemmas)  # Helper in same file
        return embedding

    def _normalize(self, text):  # ❌ Should be in separate module
        return text.lower()

    def _lemmatize(self, text):  # ❌ Should be in separate module
        return process(text)


# ✅ CORRECT: Orchestrator delegates to specialized services
class VectorizeService:
    """Orchestrates vectorization workflow - NO business logic here."""

    def __init__(
        self,
        text_processor: TextProcessor,  # Specialized service
        embedding_service: EmbeddingService,  # Specialized service
    ):
        self.text_processor = text_processor
        self.embedding_service = embedding_service

    async def vectorize(self, data):
        # Only orchestration logic
        text = await self.text_processor.normalize(data)
        lemmas = await self.text_processor.lemmatize(text)
        embedding = await self.embedding_service.generate(lemmas)
        return embedding


# ✅ CORRECT: Separate specialized service
# File: app/services/text_processor.py
class TextProcessor:
    """Handles all text processing operations."""

    def normalize(self, text: str) -> str:
        """Normalize text to lowercase."""
        return text.lower()

    def lemmatize(self, text: str) -> str:
        """Lemmatize text using NLP library."""
        # Text lemmatization logic here
        return processed_text
```

### When to Extract a Module

**Extract immediately if**:
- Function is reusable in multiple places
- Function has >3 parameters
- Function is >20 lines
- Function does more than one thing
- You're writing a helper function in an orchestrator

**Module Organization**:
```
app/domain/services/
├── orchestrator.py      # Only coordination logic
├── service_a.py         # Specialized service A
├── service_b.py         # Specialized service B
└── helpers/
    ├── text_processor.py   # Text operations
    └── validators.py       # Validation logic
```

### Real Example from Project

```python
# ❌ BEFORE: Monolithic vectorize.py (343 lines)
# - Had normalize_text() helper
# - Had lemmatize_text() helper
# - Had spaCy initialization
# - Had orchestration logic
# ALL IN ONE FILE

# ✅ AFTER: Modularized
# File: app/creative/services/vectorize.py (orchestrator only)
from app.creative.services.text_processor import normalize_text, lemmatize_text
from app.creative.services.image_analyzer import analyze_image
from app.creative.services.youtube_analyzer import analyze_youtube_video
from app.creative.services.embedding_service import generate_embedding

async def vectorize_profile(request):
    """Orchestrate only - delegates to specialized services."""
    text = normalize_text(request.text)  # text_processor service
    lemmas = lemmatize_text(text)         # text_processor service
    image_tags = await analyze_image()   # image_analyzer service
    video_summary = await analyze_youtube()  # youtube_analyzer service
    embedding = await generate_embedding()    # embedding_service
    return embedding

# File: app/creative/services/text_processor.py (specialized service)
def normalize_text(text: str) -> str:
    """Single responsibility: text normalization."""
    return text.lower().strip()

def lemmatize_text(text: str) -> str:
    """Single responsibility: text lemmatization."""
    # Text lemmatization logic here
    return processed_text
```

---

## Test-Driven Development (TDD) - MANDATORY

### TDD is Non-Negotiable
Every code change MUST follow TDD:

1. **Write test first** - Before implementing any feature or fix
2. **Run test** - Verify it fails (Red)
3. **Implement** - Write minimal code to pass (Green)
4. **Refactor** - Improve code while tests pass (Refactor)

### Test Requirements
- ✅ **New features**: Write tests BEFORE implementation
- ✅ **Bug fixes**: Write failing test reproducing bug, then fix
- ✅ **Refactoring**: Ensure existing tests pass
- ✅ **Coverage**: Aim for >85% code coverage
- ✅ **Test types**: Unit tests for services, integration tests for routers

### Test Structure
```python
# tests/test_<module>_services.py
"""
Test description following docstring conventions.
"""

class Test<ServiceName>:
    """Test <ServiceName> with clear class docstring."""

    @pytest.fixture
    async def service(self):
        """Setup service with mocked dependencies."""
        # Fixture implementation

    async def test_<method>_<scenario>_<expected_result>(self, service):
        """Test method does X when Y, expects Z."""
        # Arrange
        input_data = ...

        # Act
        result = await service.method(input_data)

        # Assert
        assert result.field == expected_value
```

### Test Naming Convention
```
test_<method>_<scenario>_<expected>

Examples:
- test_search_professionals_with_valid_query_returns_results
- test_generate_embedding_with_empty_text_raises_error
- test_match_opportunities_with_filters_applies_constraints
```

---

## Code Conventions

### Python Style
- **PEP 8** compliance (enforced by Black + isort)
- **Line length**: 88 characters (Black default)
- **Imports**: Sorted with isort (black profile)
- **Type hints**: Required for all function signatures
- **Docstrings**: Google style for all public methods

### File Organization
```
app/
├── business/          # Business domain logic
│   ├── models/       # Pydantic models (request/response)
│   ├── routers/      # FastAPI endpoints
│   └── services/     # Business orchestration services
├── creative/         # Creative domain logic
│   ├── models/
│   ├── routers/
│   └── services/
└── core/             # Shared infrastructure
    ├── config.py     # Settings management
    ├── database.py   # DB clients
    ├── logging.py    # Structured logging
    └── ...           # Other shared utilities
```

### Naming Conventions

#### Files
- **Modules**: `snake_case.py`
- **Tests**: `test_<module>.py`
- **Models**: Descriptive nouns (`matching.py`, `direct_search.py`)

#### Classes
```python
# Services: <Purpose>Service
class DirectSearchService(LoggerMixin): ...
class EmbeddingService: ...

# Models: Descriptive nouns
class MatchingRequest(BaseModel): ...
class ProfessionalResult(BaseModel): ...

# Clients: <Provider>Client
class SupabaseClient: ...
class PineconeClient: ...
```

#### Functions & Methods
```python
# Actions: verb_noun
async def search_professionals(...): ...
async def generate_embedding(...): ...

# Queries: get_noun / find_noun
async def get_user_data(...): ...
async def find_matches(...): ...

# Booleans: is_/has_/can_
def is_valid_query(...): ...
def has_required_fields(...): ...
```

#### Variables
```python
# Descriptive snake_case
user_embeddings = ...
search_results = ...
max_retries = 3

# Constants: UPPER_SNAKE_CASE
MAX_RESULTS = 100
DEFAULT_TOP_K = 20
```

### Dependency Injection
Always use FastAPI's dependency injection:

```python
# ✅ Correct
async def get_service(
    client: SupabaseClient = Depends(get_supabase_client),
    embeddings: EmbeddingService = Depends(get_embedding_service),
) -> MyService:
    return MyService(client, embeddings)

@router.post("/endpoint")
async def endpoint(service: MyService = Depends(get_service)):
    return await service.process()

# ❌ Incorrect - Don't instantiate in endpoint
@router.post("/endpoint")
async def endpoint():
    service = MyService()  # Wrong!
    return await service.process()
```

### Error Handling
```python
# Use structured logging
self.logger.error("Operation failed", error=str(e), user_id=user_id)

# Use Sentry for tracking
sentry_sdk.capture_exception(e)

# Return appropriate HTTP status codes
raise HTTPException(
    status_code=status.HTTP_400_BAD_REQUEST,
    detail="Clear error message"
)
```

### Async/Await
- All I/O operations MUST be async
- Use `async def` for API routes and service methods
- Use `await` for all async calls
- No blocking I/O in async functions

```python
# ✅ Correct
async def fetch_data(self, user_id: str) -> UserData:
    result = await self.client.query(user_id)
    embedding = await self.embeddings.generate(result.text)
    return UserData(**result)

# ❌ Incorrect - Blocking call
async def fetch_data(self, user_id: str) -> UserData:
    result = requests.get(url)  # Blocks event loop!
    return UserData(**result)
```

### Type Annotations
Required for all function signatures:

```python
from typing import List, Optional, Dict, Any

async def search(
    query: str,
    filters: Optional[Dict[str, Any]] = None,
    top_k: int = 10
) -> List[SearchResult]:
    ...
```

### Pydantic Models
Use for all request/response validation:

```python
from pydantic import BaseModel, Field, validator

class SearchRequest(BaseModel):
    """Search request model with validation."""

    query: str = Field(..., min_length=1, max_length=500)
    user_id: str = Field(..., description="User UUID")
    top_k: int = Field(default=10, ge=1, le=100)

    @validator('query')
    def validate_query(cls, v: str) -> str:
        """Ensure query is not just whitespace."""
        if not v.strip():
            raise ValueError("Query cannot be empty")
        return v.strip()
```

### Logging Standards
Use structured logging with context:

```python
from app.core import get_logger

class MyService(LoggerMixin):
    async def process(self, request: Request):
        self.logger.info(
            "Processing request",
            user_id=request.user_id,
            operation="search",
            query_length=len(request.query)
        )

        try:
            result = await self._execute(request)
            self.logger.info("Request completed", status="success")
            return result
        except Exception as e:
            self.logger.error(
                "Request failed",
                error=str(e),
                error_type=type(e).__name__
            )
            raise
```

### Configuration Management
Use Pydantic Settings for all config:

```python
# ✅ Correct - Use settings
from app.core import get_settings

settings = get_settings()
api_key = settings.openai_api_key

# ❌ Incorrect - Don't access env vars directly
import os
api_key = os.getenv("OPENAI_API_KEY")  # Wrong!
```

---

## Documentation Requirements

### Module Docstrings
Every module needs a clear docstring:

```python
"""
Brief description of module purpose.

Longer description if needed, explaining the module's role in the system.
"""
```

### Function Docstrings
Use Google style:

```python
async def search_professionals(
    query: str,
    filters: Optional[Dict[str, Any]] = None
) -> List[Professional]:
    """
    Search for professionals matching the query.

    Args:
        query: Natural language search query
        filters: Optional filters to apply (location, skills, etc.)

    Returns:
        List of matching professionals sorted by relevance score

    Raises:
        ValueError: If query is empty or invalid
        HTTPException: If service is unavailable

    Example:
        >>> results = await search_professionals(
        ...     query="Python developer with 5 years experience",
        ...     filters={"location": "Madrid"}
        ... )
    """
```

### Code Comments
- Explain **why**, not **what**
- Use comments for complex business logic
- Avoid obvious comments

```python
# ✅ Good - Explains why
# Using cosine similarity because it's scale-invariant
# and works better for high-dimensional embeddings
similarity = cosine_similarity(vec1, vec2)

# ❌ Bad - States the obvious
# Calculate similarity
similarity = cosine_similarity(vec1, vec2)
```

---

## Performance Guidelines

### Caching
- Cache expensive operations (embeddings, DB queries)
- Use TTL for time-sensitive data
- Implement cache invalidation strategies

### Async Operations
- Run independent operations concurrently:

```python
# ✅ Correct - Concurrent
embedding, user_data = await asyncio.gather(
    embedding_service.generate(query),
    supabase_client.get_user(user_id)
)

# ❌ Incorrect - Sequential
embedding = await embedding_service.generate(query)
user_data = await supabase_client.get_user(user_id)
```

### Database Queries
- Use connection pooling
- Implement query timeouts
- Batch operations when possible
- Select only needed columns

---

## Security Standards

### API Keys
- Never hardcode keys
- Use environment variables via settings
- Implement key rotation
- Log key usage (but not values!)

### Authentication
```python
async def verify_api_key(x_api_key: str = Header(...)) -> None:
    """Verify API key from header."""
    settings = get_settings()
    if x_api_key != settings.internal_api_key:
        logger.warning("Invalid API key attempt")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key"
        )
```

### Input Validation
- Validate ALL user inputs with Pydantic
- Sanitize before logging
- Implement rate limiting
- Check payload sizes

---

## Git Commit Conventions

Use Conventional Commits:

```
type(scope): subject

Types:
- feat: New feature
- fix: Bug fix
- refactor: Code refactoring
- test: Adding tests
- docs: Documentation
- style: Formatting
- perf: Performance improvement
- chore: Maintenance

Examples:
feat(matching): add skill-based filtering
fix(search): resolve empty query handling
test(embedding): add edge case tests
refactor(services): extract common logic
```

---

## Code Review Checklist

Before submitting PR:
- [ ] Tests written and passing (TDD)
- [ ] Code coverage maintained/improved
- [ ] Type hints added
- [ ] Docstrings complete
- [ ] Logging implemented
- [ ] Error handling in place
- [ ] No hardcoded values
- [ ] Security considerations checked
- [ ] Performance implications reviewed
- [ ] Documentation updated

---

## When Writing Code

1. **Read** existing similar code for patterns
2. **Write test first** (TDD)
3. **Implement** following conventions
4. **Run tests** and verify coverage
5. **Review** against checklist
6. **Document** changes

---

## Questions to Ask Before Coding

1. Have I read the relevant context files? (Always start here!)
2. Does this need a test? (Usually yes!)
3. Is this the right layer for this logic?
4. Are dependencies injected properly?
5. Is error handling comprehensive?
6. Is logging sufficient for debugging?
7. Are types properly annotated?
8. Is the code self-documenting?
9. Can this be more async/concurrent?
10. Which context file should guide this implementation?

---

## Context-Driven Development Workflow

### Step-by-Step Process

Every code change should follow this workflow:

```
1. 📖 READ CONTEXT
   ↓
   Read relevant .github/*.md files based on task
   - project-structure.md: Understand where code goes
   - database.md: Understand data structures
   - testing-guide.md: Plan tests first
   - code-examples.md: Reference implementation patterns

2. 🧪 WRITE TEST (TDD - Red Phase)
   ↓
   Follow testing-guide.md:
   - Use Given-When-Then pattern
   - Write failing test first
   - Name test descriptively

3. ✅ RUN TEST (Verify Failure)
   ↓
   pytest tests/test_*.py -v

4. 💻 IMPLEMENT (Green Phase)
   ↓
   Follow copilot-instructions.md conventions:
   - Service orchestration pattern
   - Type hints
   - Async/await
   - Error handling
   - Structured logging

5. ✅ RUN TEST (Verify Pass)
   ↓
   pytest tests/test_*.py -v --cov

6. ♻️ REFACTOR (Improve)
   ↓
   - Improve code quality
   - Keep tests green
   - Follow conventions

7. 📝 DOCUMENT
   ↓
   - Add/update docstrings
   - Update relevant .md files if needed
```

### Real-World Scenarios

#### Scenario 1: Add New Search Functionality

```
User Request: "Add a search endpoint that filters by location"

Your Action Plan:
1. 📖 Read project-structure.md
   → Find: Routers go in app/business/routers/
   → Find: Services go in app/business/services/

2. 📖 Read database.md
   → Find: creative_data table has 'location' field
   → Find: Pinecone metadata supports location filters
   → Find: Example queries for location filtering

3. 📖 Read testing-guide.md
   → Learn: Write integration test for endpoint
   → Learn: Write unit test for service logic
   → Learn: Use Given-When-Then pattern

4. 📖 Read code-examples.md
   → Find: DirectSearchService implementation
   → Find: Router with dependency injection pattern
   → Copy patterns and adapt

5. 🧪 Write tests first (TDD):
   - test_search_endpoint_with_location_filter_returns_filtered_results
   - test_search_service_applies_location_filter_to_pinecone

6. 💻 Implement following patterns from examples

7. ✅ Run tests and verify

8. 📝 Update database.md if query patterns changed
```

#### Scenario 2: Fix Bug in Embedding Generation

```
User Request: "Embeddings are failing for empty bio fields"

Your Action Plan:
1. 📖 Read testing-guide.md
   → Write test that reproduces bug (TDD)
   → test_generate_embedding_with_empty_bio_handles_gracefully

2. 📖 Read database.md
   → Understand: bio field can be NULL
   → Check: What's the expected behavior?

3. 📖 Read code-examples.md
   → Find: Error handling patterns
   → Find: Input validation examples

4. 🧪 Write failing test showing bug

5. 💻 Fix bug with proper validation

6. ✅ Verify test passes

7. 📝 Add similar validation to other text fields
```

#### Scenario 3: Add New Database Table Support

```
User Request: "Support new 'portfolios' table for creative users"

Your Action Plan:
1. 📖 Read database.md
   → Understand: Current schema structure
   → Add: New table definition
   → Add: SQL examples
   → Add: Integration patterns

2. 📖 Read project-structure.md
   → Find: Where to add new models
   → Find: Where to add database client methods

3. 📖 Read testing-guide.md
   → Plan: Unit tests for new client methods
   → Plan: Integration tests for API endpoints

4. 📖 Read code-examples.md
   → Reference: SupabaseClient patterns
   → Reference: Service integration

5. 📝 UPDATE database.md FIRST
   → Document new table
   → Add query examples
   → Update relationships section

6. 🧪 Write tests for new functionality

7. 💻 Implement following existing patterns

8. ✅ Verify all tests pass
```

#### Scenario 4: Refactor Existing Service

```
User Request: "Refactor DirectSearchService to be more modular"

Your Action Plan:
1. ✅ Run existing tests first
   → Ensure all pass before refactoring

2. 📖 Read code-examples.md
   → Review: Best practices for service structure
   → Review: How to extract helper methods

3. 📖 Read copilot-instructions.md
   → Review: Naming conventions
   → Review: Single responsibility principle

4. 🧪 Ensure test coverage is >85%
   → Add tests if needed before refactoring

5. ♻️ Refactor incrementally
   → Extract one method at a time
   → Run tests after each change
   → Keep tests green

6. 📝 Update docstrings
   → Reflect new structure
   → Update code-examples.md if pattern changed
```

---

## Context File Maintenance

### When to Update Context Files

| File | Update When | Who Updates |
|------|-------------|-------------|
| **project-structure.md** | - New directories added<br>- New modules created<br>- Major restructuring | Developer making changes |
| **database.md** | - New tables added<br>- Schema changes<br>- New Pinecone indexes<br>- Query patterns change | Database/Backend developer |
| **testing-guide.md** | - New testing patterns emerge<br>- Testing strategy changes<br>- New tools added | Tech lead / Senior dev |
| **code-examples.md** | - Better patterns discovered<br>- Common mistakes identified<br>- New service types added | Any developer (improvements) |
| **copilot-instructions.md** | - Coding conventions change<br>- New best practices<br>- Architecture changes | Tech lead |

### Keeping Context Current

```python
# ✅ Good: Update context when making significant changes
"""
Example commit:
feat(search): add geolocation-based filtering

- Implemented location radius search
- Updated database.md with new Pinecone filter patterns
- Added examples to code-examples.md
- Tests follow Given-When-Then pattern
"""

# ❌ Bad: Make changes without updating context
"""
Example commit:
feat: add search stuff

- Added some new search thing
- (No context file updates)
- (Future developers confused about patterns)
"""
```
