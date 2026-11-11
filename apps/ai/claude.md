# AI Services - Backend Microservice Documentation

## Overview

FastAPI microservice for semantic search, personalized recommendations, and conversational AI. Uses vector embeddings, multi-modal analysis (image, YouTube, PDF), and intelligent query processing to match creative professionals with opportunities.

## Tech Stack

- **Framework**: FastAPI 0.115.0, Python 3.12+, Uvicorn/Gunicorn
- **AI/ML**: Google Gemini (embeddings 1536D, 2.5 Flash LLM), LangChain 1.0.3
- **Vector DB**: Pinecone 6.0.0 (cosine similarity, us-east-1)
- **Database**: Supabase 2.25.0 (PostgreSQL)
- **Monitoring**: Structlog 24.4.0 (JSON logs), Sentry SDK 2.19.0
- **Tools**: Pydantic 2.11.7, PyMuPDF 1.26.7, pytest + pytest-asyncio

## Project Structure

```
/app
  main.py                   # FastAPI app entry point, lifespan, error handlers
  /services                 # Business logic layer
    search.py               # Semantic search orchestration
    recommendations.py      # Personalized recommendations
    vectorize.py            # Multi-modal profile vectorization
    embedding_service.py    # Gemini embedding generation
    query_enricher.py       # Query expansion with synonyms
    text_processor.py       # Normalization & lemmatization
    image_analyzer.py       # Gemini Vision analysis
    youtube_analyzer.py     # Video content analysis
    pdf_analyzer.py         # PDF portfolio analysis
    search_log_saver.py     # Search persistence
    agent_service.py        # Conversational AI with SSE streaming
  /core                     # Infrastructure
    config.py               # Pydantic settings with env loading
    database.py             # Async Supabase wrapper
    pinecone_client.py      # Pinecone client DI pattern
    vector_store.py         # Vector operations abstraction
    supabase_service.py     # Supabase service classes
    user_vector_cache.py    # In-memory user vector cache
    logging.py              # Structlog configuration
    sentry.py               # Error tracking setup
    /middleware/cors.py     # CORS config (dev: all, prod: whitelist)
  /models                   # Pydantic schemas (search, vectorize, recommendations, agent)
  /dependencies             # FastAPI deps (JWT auth, rate limiting)
/tests                      # pytest suite (services, endpoints, auth, infrastructure)
run.py, start_production.sh, gunicorn.conf.py, railway.json, Procfile
```

## Core API Endpoints

### 1. Profile Vectorization - `POST /api/vectorize`

**Auth**: Bearer token | **Rate Limited**: Per-IP

**Input**: Form data with JSON profile + optional files (image, PDF, YouTube URL)

**Workflow**:

1. Parse profile + files
2. Analyze image → extract tags (Gemini Vision)
3. Analyze YouTube → generate summary (Gemini multimodal)
4. Analyze PDF → extract portfolio tags
5. Normalize & batch lemmatize all sources (1 API call)
6. Combine with structured prompt
7. Generate embedding (1536D vector)
8. Store in Pinecone with metadata (bio, tags, passion, location)

**Response**: userId, vectorId, success, videoSummary, imageTags, pdfTags

### 2. Semantic Search - `GET /search` (internal/agent)

**Auth**: Internal API key

**Workflow**:

1. Enrich query with AI (synonyms, context expansion)
2. Generate embedding
3. Query Pinecone (top 3, cosine similarity)
4. Exclude self from results
5. Save search log in background (async fire-and-forget)
6. Invalidate user cache

**Latency**: 200-500ms

### 3. Personalized Recommendations - `GET /api/recommendations`

**Auth**: Bearer token

**Workflow**:

1. Fetch last 21 search vectors from Supabase
2. Calculate average vector (NumPy)
3. Query Pinecone for similar users (top 7)
4. Exclude self

**Response**: recommendations[], totalRecommendations, basedOnSearches

### 4. Conversational AI Agent - `POST /api/agent`

**Auth**: Bearer token | **Output**: SSE stream

**Features**:

- Intent detection (search verbs + creative roles keywords)
- Multilingual support (EN/ES)
- Streaming JSON events: `message`, `profiles`, `done`
- Search mode: performs search + returns profiles
- Conversational mode: direct Gemini response

**SSE Events**: `{"type":"message","content":"..."}, {"type":"profiles","content":[...]}, {"type":"done","content":"end"}`

### 5. Health Check - `GET /health`

**Auth**: None | **Response**: `{"status":"healthy","service":"TropicalTalent AI","version":"0.1.0"}`

## Service Architecture Pattern

```
API Routes → Business Logic Services → Core Infrastructure → External Services
(FastAPI)    (search, vectorize, etc.)  (config, DB, cache)   (Pinecone, Supabase, Gemini)
```

**Key Services**:

- **Search**: Orchestrates query enrichment → embedding → vector search → logging
- **Recommendations**: Vector averaging from search history → similarity search
- **Vectorize**: Multi-source fusion (profile + image + video + PDF) → embedding → Pinecone
- **Embedding**: Gemini `gemini-embedding-001` (single/batch generation)
- **Query Enricher**: Gemini 2.5 Flash expands queries with synonyms (temp 0.7)
- **Text Processor**: Normalize + batch lemmatize (Gemini temp 0.1)
- **Image Analyzer**: Gemini Vision extracts 5-10 tags (temp 0.3)
- **YouTube Analyzer**: Gemini multimodal summarizes video (temp 0.5, max 200 words)
- **Agent**: Intent detection → search or conversation → SSE streaming

## Core Infrastructure

**Configuration** (`config.py`): Pydantic settings with env loading, fail-fast validation

**Database** (`database.py`): Async Supabase wrapper (thread pool for sync lib)

- `save_search_log`, `get_user_search_history`, `get_user_data`, `save_user_data`

**Pinecone** (`pinecone_client.py`): DI pattern with LRU cache singletons

- Index: "user-profiles", namespace: "users", dimension: 1536, metric: cosine

**Logging** (`logging.py`): Structlog with JSON (prod) or colorized console (dev)

**Authentication** (`dependencies/auth.py`): JWT Bearer token validated with Supabase

**Rate Limiting** (`dependencies/rate_limiting.py`): Sliding-window in-memory (60 req/min default)

**Caching** (`user_vector_cache.py`): In-memory LRU cache for user embeddings

## Data Models (Pydantic)

**Search**: SearchRequest (user_id, query), UserSearchResult (user_id, score, bio, tags, passion, metadata), SearchResponse

**Vectorize**: ProfileData (username, bio, tags, passion, location), VectorizeProfileRequest, VectorizeProfileResponse (camelCase aliases)

**Recommendations**: UserRecommendation, RecommendationsResponse (camelCase aliases)

**Agent**: AgentRequest (message), AgentMessageEvent (type, content), AgentProfilesItem

## Environment Variables

```bash
# Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Vector DB
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=user-profiles
PINECONE_ENVIRONMENT=us-east-1

# AI
GEMINI_API_KEY=your_gemini_api_key

# Security
INTERNAL_API_KEY=your_internal_api_key

# Monitoring
SENTRY_DSN=your_sentry_dsn
LOG_LEVEL=INFO

# Server
API_HOST=0.0.0.0
API_PORT=8000
DEBUG=false

# Performance
RATE_LIMIT_PER_MINUTE=60
MAX_RESULTS=10
SIMILARITY_THRESHOLD=0.7
```

## Development

```bash
# Setup
uv sync --group dev  # creates .venv and installs all deps
cp .env.example .env  # Edit with credentials (no .env is committed)

# Run dev server
uv run python run.py
# or
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Run tests
uv run pytest
uv run pytest --cov=app --cov-report=html

# Lint & format
pylint app/
black app/
isort app/

# Pre-commit hooks
pre-commit install
pre-commit run --all-files
```

## Testing

> **⚡ TEST Keyword**: When the user writes **TEST** (all caps), apply TDD — write or update the `pytest` test FIRST (failing), then implement the feature. Never skip this step.

**pytest.ini**: asyncio_mode=auto, testpaths=tests, markers (unit, integration, slow, auth)

**Test files**: `test_services.py`, `test_endpoints.py`, `test_auth.py`, `test_infrastructure.py`, `conftest.py` (fixtures)

**Approach**: Unit tests for services, integration for API, mock externals, async support

## Deployment

**Production Server** (Gunicorn):

```python
# gunicorn.conf.py
workers = (CPU * 2 + 1)  # Auto-calculated
worker_class = "uvicorn.workers.UvicornWorker"
bind = "0.0.0.0:8000"
timeout = 120
graceful_timeout = 30
max_requests = 1000  # Restart workers after 1000 req (memory safety)
preload_app = True  # Share code across workers
```

**Commands**:

```bash
./start_production.sh
# or
gunicorn app.main:app --config gunicorn.conf.py
```

**Railway**: Auto-deploy with `railway.json`, env vars in dashboard

## Performance Metrics

| Operation           | Target      | Notes                                   |
| ------------------- | ----------- | --------------------------------------- |
| Search              | 200-500ms   | Query enrichment + embedding + search   |
| Recommendations     | 200-500ms   | Vector averaging + search               |
| Vectorization       | 1-3s        | Multi-modal analysis (depends on files) |
| Vector search       | <100ms      | Pinecone sub-second                     |
| Embedding gen       | 50-200ms    | Gemini API                              |
| Query enrichment    | 100-300ms   | Gemini API                              |
| Concurrent requests | 100+        | Async/await + thread pooling            |

## Monitoring & Logging

**Structured Logs**:

```python
logger.info("search_completed", user_id=user_id, query=query, results_count=len(results), search_time_ms=time)
```

**Sentry**: Auto-capture exceptions with context, `sentry_sdk.capture_exception(e)`

**Health**: `curl http://localhost:8000/health`

## Security

- **Auth**: JWT Bearer validation (Supabase), internal API key for service-to-service
- **Rate Limiting**: Per-IP sliding window (60/min default)
- **Validation**: Pydantic schemas, request size limits, file type validation
- **CORS**: Dev=all origins, Prod=whitelist (tropicaltalent.dev)

## Troubleshooting

**Import Errors**: `uv sync` (re-installs from the lockfile)

**Pinecone Connection**: `python -c "from app.core.pinecone_client import get_pinecone_client; print(get_pinecone_client().list_indexes())"`

**Supabase Connection**: Test with `SupabaseClient` initialization

**Gemini API**: Verify `GEMINI_API_KEY` with `EmbeddingService` instantiation test

## Key Resources

- FastAPI, Pinecone, Supabase, Google Gemini API, LangChain docs
- Test files for usage examples
- Service layer for implementation patterns
- Structured logs for debugging

---

## Critical Rule: Google Gemini Integration

**MUST USE**: `langchain_google_genai.ChatGoogleGenerativeAI`

**NEVER IMPORT**: `google.generativeai` directly

**Reason**: `google-generativeai` is NOT in pyproject.toml. Direct imports cause router ImportError → "app.routes.router not found" errors.

**Correct Usage**:

```python
from langchain_google_genai import ChatGoogleGenerativeAI
llm = ChatGoogleGenerativeAI(model="gemini-1.5-flash", api_key=settings.gemini_api_key)
```
