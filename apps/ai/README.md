# TropicalTalent AI

AI services for **TropicalTalent** — semantic search, personalized recommendations, and profile vectorization for talent connecting Cuba with the world (influencers, producers, tech and marketing talent with foreign clients).

> **Status: reference base, not the final product.** This service is a rebranded fusion of the earlier Tones AI backend (same codebase, new name). It is kept as a working reference while the TropicalTalent product idea is defined. Expect rough edges — see [Known issues](#-known-issues) for the honest list.

## 🚀 Features

- **Semantic Search**: Find talent based on natural language queries using vector similarity
- **Personalized Recommendations**: AI-powered talent recommendations based on search history and preferences
- **Profile Vectorization**: Convert profiles into high-dimensional vectors for ML operations
- **Opportunity Matching**: Match profiles against opportunities (see known issues — partially orphaned)
- **Real-time Analytics**: Track search patterns and user engagement
- **Scalable Architecture**: Built with FastAPI, async/await, and modern Python practices

## 🏗️ Architecture

### Technology Stack

- **Web Framework**: FastAPI 0.129.0 with async support
- **Vector Database**: Pinecone for embeddings and similarity search
- **Structured Database**: Supabase (PostgreSQL) for user data and search logs
- **AI Orchestration**: LangChain 0.3.x for embedding generation and AI workflows
- **Embeddings**: Google Gemini API for embeddings and text generation
- **Data Validation**: Pydantic v2 with comprehensive schemas
- **Testing**: pytest with async support and comprehensive mocking
- **Package manager**: [uv](https://docs.astral.sh/uv/) — the only one. See [Dependency management](#-dependency-management).

### System Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   FastAPI       │    │   Business      │    │   Data Access   │
│   Endpoints     │───▶│   Logic         │───▶│   Services      │
│                 │    │   Services      │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       ▼
         ▼                       ▼              ┌─────────────────┐
┌─────────────────┐    ┌─────────────────┐    │   External      │
│   API Models    │    │   Core Config   │    │   Services      │
│   & Schemas     │    │   & Logging     │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                        │
                                              ┌─────────┼─────────┐
                                              │         │         │
                                              ▼         ▼         ▼
                                        ┌──────────┐ ┌───────┐ ┌──────────┐
                                        │ Supabase │ │Pinecone│ │  Gemini  │
                                        │PostgreSQL│ │Vector │ │  API     │
                                        └──────────┘ └───────┘ └──────────┘
```

## 📋 API Endpoints

### 🔍 Search Users

**GET** `/api/v1/search`

Perform semantic search to find users based on natural language queries.

```bash
curl -X GET "http://localhost:8000/api/v1/search?user_id=user123&query=Python%20developer%20with%20ML%20experience" \
  -H "accept: application/json"
```

**Parameters:**

- `user_id` (string, required): ID of the user performing the search
- `query` (string, required): Search query (3-500 characters)
- `limit` (integer, optional): Maximum results to return (default: 20, max: 100)
- `min_similarity` (float, optional): Minimum similarity threshold (default: 0.7)

### 🎯 Get Recommendations

**GET** `/api/v1/recommendations/{user_id}`

Get personalized user recommendations based on search history and preferences.

```bash
curl -X GET "http://localhost:8000/api/v1/recommendations/user123" \
  -H "accept: application/json"
```

### 🧮 Vectorize Profile

**POST** `/api/v1/vectorize-profile`

Convert a user profile into a vector representation for similarity search.

```bash
curl -X POST "http://localhost:8000/api/v1/vectorize-profile" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user123",
    "bio": "I am a passionate Python developer with expertise in machine learning",
    "video_tags": ["python", "ml", "ai", "tensorflow"],
    "passion": "Building intelligent systems that can learn and adapt"
  }'
```

### 🏥 Health & Status

**GET** `/api/v1/health` - Basic health check
**GET** `/api/v1/status` - Detailed service status with dependency checks

## 🛠️ Installation & Setup

### Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (`~/.local/bin/uv` on this machine, v0.12.19)
- Pinecone API account and key
- Supabase project with service role key
- Google Gemini API key

### 1. Install dependencies

```bash
# From apps/ai — creates .venv and installs exactly what uv.lock pins
uv sync

# Include dev tools (pytest, pylint, black, isort, mypy, pre-commit)
uv sync --group dev
```

No `pip`, no `requirements.txt`, no manual `venv` — `uv sync` is the whole install step.

### 2. Environment variables

No `.env` file is committed (there is none — keep it that way). Provide variables through your shell or your deploy platform. Values below are empty placeholders, **not real keys**.

```bash
# Database Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>
SUPABASE_JWT_SECRET=<your-supabase-jwt-secret>

# Vector Database Configuration
PINECONE_API_KEY=<your-pinecone-api-key>
PINECONE_INDEX_NAME=talent-index
PINECONE_ENVIRONMENT=us-east-1

# AI Configuration
GEMINI_API_KEY=<your-gemini-api-key>
EMBEDDING_DIMENSION=3072

# Internal auth — REQUIRED, no default (see "Security fix" below)
INTERNAL_API_KEY=<generate-with-openssl-rand-hex-32>

# API Configuration
HOST=0.0.0.0
PORT=8000
DEBUG=false
LOG_LEVEL=INFO

# Database Table Configuration
SEARCH_LOGS_TABLE=search_logs
USERS_DATA_TABLE=creative_data   # NOTE: still the legacy table name, see Known issues

# Vector Configuration
MAX_RESULTS=10
SIMILARITY_THRESHOLD=0.85

# Rate Limiting
RATE_LIMIT_PER_MINUTE=60

# Optional — Redis / Upstash (rate limiting, caches, LangGraph checkpointer)
UPSTASH_REDIS_URL=<your-upstash-redis-url>

# Optional — QStash webhook signing keys (for /api/webhooks/vectorize)
QSTASH_CURRENT_SIGNING_KEY=<your-qstash-current-signing-key>
QSTASH_NEXT_SIGNING_KEY=<your-qstash-next-signing-key>
# DEV ONLY — QSTASH_ALLOW_UNSIGNED=true accepts unsigned webhook deliveries
# when no signing keys are configured. Never enable in production (it is
# ignored when SENTRY_ENVIRONMENT=production); without keys and without this
# flag, unsigned requests are rejected everywhere.
QSTASH_ALLOW_UNSIGNED=false

# Optional — Sentry error tracking
# Leave SENTRY_DSN empty to disable Sentry entirely (local/dev default:
# no DSN -> the SDK is never initialised, so no event can leave the process).
# SENTRY_ENVIRONMENT defaults to "development"; set it explicitly per deploy.
SENTRY_DSN=<your-sentry-dsn>
SENTRY_ENVIRONMENT=development
SENTRY_TRACES_SAMPLE_RATE=0.1
```

Full variable list (with defaults) lives in `app/core/config.py` (`Settings`).

### 3. Database Setup

#### Supabase Schema

Create the following tables in your Supabase project:

```sql
-- Users table
CREATE TABLE users (
    user_id TEXT PRIMARY KEY,
    bio TEXT NOT NULL,
    video_tags TEXT[] DEFAULT '{}',
    passion TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Search logs table
CREATE TABLE search_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    query TEXT NOT NULL,
    results_count INTEGER NOT NULL DEFAULT 0,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- Indexes for performance
CREATE INDEX idx_search_logs_user_id ON search_logs(user_id);
CREATE INDEX idx_search_logs_timestamp ON search_logs(timestamp DESC);
CREATE INDEX idx_users_created_at ON users(created_at DESC);
```

> **Table-name mismatch (rebrand):** the code still reads user profile data from the Supabase table `creative_data` (`USERS_DATA_TABLE` default), while the TropicalTalent frontend migrations use `tropical_*` tables. The default was deliberately **not** renamed — renaming the string would silently break every Supabase query that selects `creative_data(passion)`. A real database migration must rename the table first; until then the mismatch is documented here, not hidden.

#### Pinecone Index Setup

```python
import pinecone

pinecone.init(
    api_key="<your-pinecone-api-key>",
    environment="us-east-1",
)

pinecone.create_index(
    name="talent-index",  # renamed from the old "creatives-index" default
    dimension=3072,       # gemini-embedding-001
    metric="cosine",
    metadata_config={
        "indexed": ["passion", "bio", "video_tags"]
    }
)
```

### 4. Run the Application

#### Development Mode

```bash
uv run python run.py

# Or using uvicorn directly
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

#### Production Mode

```bash
# Using production startup script (recommended)
./start_production.sh

# Or using Gunicorn directly with config file
uv run gunicorn app.main:app --config gunicorn.conf.py
```

Production settings live in `gunicorn.conf.py` (workers auto-calculated as `2 * CPU + 1`, Uvicorn workers, 120s timeout, workers restart after 1000 requests, `preload_app`). Override with `GUNICORN_WORKERS` and `LOG_LEVEL`. See [DEPLOYMENT.md](DEPLOYMENT.md) for Railway/Docker details.

### 5. Verify Installation

```bash
curl http://localhost:8000/api/v1/health
curl http://localhost:8000/api/v1/status
open http://localhost:8000/docs
```

## 🧪 Testing

```bash
# Run all tests (uses the uv-managed venv; no pip)
uv run pytest

# With coverage
uv run pytest --cov=app --cov-report=html

# Or use the runner script (all options go through `uv run pytest`)
./run_tests.sh            # all tests with coverage
./run_tests.sh quick      # fast tests only, stop on first failure
./run_tests.sh coverage   # fail if coverage < 85%
./run_tests.sh file tests/test_auth.py
./run_tests.sh help       # all options
```

### Test Categories

- **Model Tests** (`test_models.py`): Pydantic schema validation and data models
- **Service Tests** (`test_services.py`): Database, vector store, and embedding services
- **Business Logic Tests** (`test_business.py`): Search, recommendation, and vectorization logic
- **API Tests** (`test_api.py`): FastAPI endpoint integration tests

## 🔧 Configuration

### Environment Variables

| Variable | Required | Default | Description |
| -------- | -------- | ------- | ----------- |
| `SUPABASE_URL` | Yes | - | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | - | Supabase service role key |
| `SUPABASE_JWT_SECRET` | Yes | - | Supabase JWT secret |
| `PINECONE_API_KEY` | Yes | - | Pinecone API key |
| `PINECONE_INDEX_NAME` | No | `talent-index` | Pinecone index name |
| `PINECONE_ENVIRONMENT` | No | `us-east-1` | Pinecone environment |
| `GEMINI_API_KEY` | Yes | - | Google Gemini API key |
| `INTERNAL_API_KEY` | **Yes** | _(none — required)_ | Key for internal/admin endpoints; app fails fast at startup if unset |
| `EMBEDDING_DIMENSION` | No | `3072` | Embedding vector dimension |
| `EMBEDDING_MODEL` | No | `models/gemini-embedding-001` | Gemini embedding model |
| `HOST` | No | `0.0.0.0` | API server host |
| `PORT` | No | `8000` | API server port |
| `DEBUG` | No | `false` | Debug mode (dev only) |
| `LOG_LEVEL` | No | `INFO` | Logging level |
| `SEARCH_LOGS_TABLE` | No | `search_logs` | Search logs table name |
| `USERS_DATA_TABLE` | No | `creative_data` | Users data table name (legacy name, see Known issues) |
| `OPPORTUNITIES_TABLE` | No | `opportunities` | Opportunities table name |
| `MATCHING_RESULTS_TABLE` | No | `matching_results` | Matching results table name |
| `MAX_RESULTS` | No | `10` | Maximum results per search |
| `SIMILARITY_THRESHOLD` | No | `0.85` | Threshold for "good" quality matches |
| `MINIMUM_MATCH_THRESHOLD` | No | `0.75` | Minimum threshold — results below are filtered out |
| `EXCELLENT_MATCH_THRESHOLD` | No | `0.90` | Threshold for excellent quality matches |
| `RATE_LIMIT_PER_MINUTE` | No | `60` | API rate limit per minute |
| `UPSTASH_REDIS_URL` | No | - | Upstash Redis URL (rate limiting, caches, LangGraph state) |
| `QSTASH_CURRENT_SIGNING_KEY` | No | - | QStash signing key for `/api/webhooks/vectorize` |
| `QSTASH_NEXT_SIGNING_KEY` | No | - | QStash next signing key (rotation) |
| `QSTASH_ALLOW_UNSIGNED` | No | `false` | **DEV ONLY.** When `true` AND no signing keys are configured, `/api/webhooks/vectorize` accepts unsigned deliveries (local dev without a QStash project). Ignored when `SENTRY_ENVIRONMENT=production` — unsigned requests are always rejected there. Without keys and without this flag, unsigned requests are rejected everywhere. Never enable in a deployed environment. |
| `SENTRY_DSN` | No | - | Sentry DSN for error tracking |
| `SENTRY_ENVIRONMENT` | No | `development` | Sentry environment name |
| `SENTRY_TRACES_SAMPLE_RATE` | No | `0.1` | Sentry performance monitoring sample rate |

## 📦 Dependency management

**uv is the only package manager.** `pyproject.toml` `[project]` is the single source of truth; `uv.lock` is committed. There are no `requirements*.txt` files.

```bash
uv sync              # install runtime deps from uv.lock
uv sync --group dev  # + dev tools (pytest, pylint, black, isort, mypy, pre-commit)
uv lock              # re-resolve after editing pyproject.toml, then commit uv.lock
uv run <cmd>         # run anything inside the managed .venv
```

### LangChain version decision (2026-11-11)

The old setup had a prod/dev drift: `requirements.txt` (production) pinned **LangChain 0.3.x** while `requirements-dev.txt` pinned **LangChain 1.2.x** — so development never tested what production ran. This repo takes the **production 0.3.x line as canonical** (`langchain 0.3.25`, `langchain-core 0.3.65`, `langchain-community 0.3.24`, `langchain-text-splitters 0.3.8`, `langchain-google-genai 2.1.4`). Moving to LangChain 1.x is a separate, deliberate upgrade decision — the two lines must not drift apart again.

### Fixes applied in the uv migration (2026-11-11)

- **`redis` added to runtime deps.** `app/dependencies/rate_limiting.py`, `app/core/search_cache.py` and `app/core/user_vector_cache.py` import `redis`, but it was never listed in `requirements.txt` — a latent `ImportError` in production.
- **`httpx` added to the dev group.** The test suite imports it (`tests/conftest.py`, FastAPI `TestClient`); it was previously only a transitive dependency.
- **`[tool.uv] package = false`.** This repo is a deployable app, not an installable library; uv manages the venv and dependencies only and never tries to build the project package (setuptools auto-discovery would fail on the top-level `app/` + `tests/` layout).

## 🔒 Security fix (2026-11-11)

**`INTERNAL_API_KEY` is now required — fail fast.** It previously defaulted to the guessable placeholder `"internal-api-key-changeme"`, meaning any deployment that forgot to set it shipped with a publicly known admin key. `Settings.internal_api_key` is now a required field: the app raises a `ValidationError` at startup/config load when `INTERNAL_API_KEY` is unset, instead of running unprotected. Admin routes (`app/routes/admin.py`, `X-Admin-Key` header) compare against that value. Generate one with `openssl rand -hex 32`.

This was the **only** security fix in this migration. The other known auth gaps are documented below, not silently fixed.

## 🚀 Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) (Gunicorn + Uvicorn workers, Railway, Docker with `uv sync --frozen`). `Procfile` uses `uv run gunicorn ...`.

## 🤝 Contributing

```bash
# Setup
uv sync --group dev
uv run pre-commit install

# Before committing
uv run pytest
uv run pylint app/
uv run black --check app/ && uv run isort --check-only app/
```

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Write tests for new functionality
4. Ensure all tests pass (`uv run pytest`)
5. Run linting (`uv run pylint app/`)
6. Commit and open a Pull Request

## ⚠️ Known issues

Honest list of things that are wrong or unfinished in this reference base. They were **documented, not fixed**, during the 2026-11-11 migration (except the `INTERNAL_API_KEY` fix above).

- **Unauthenticated `GET /search`.** The public search endpoint has no auth. Anyone can query it.
- **Unauthenticated insights endpoints.** The search-insights routes (`app/routes/search_insights.py`) are not behind auth.
- **Sentry `push_scope` usage.** Deprecated Sentry SDK API is still used somewhere in the codebase; it should move to the current scope API.
- **`datetime.utcnow` usage.** Naive-UTC `datetime.utcnow()` calls remain; they should be `datetime.now(timezone.utc)`.
- **Gemini model inconsistency.** The code mixes Gemini 1.5 and 2.5 model references (e.g. the agent executor uses Gemini 2.5 Flash while other paths reference 1.5-era models). Not unified.
- **Team Search router disabled.** The LangGraph Team Search feature exists in `app/services/team_search/` but its router is not enabled — the feature is dormant, not live.
- **Orphaned opportunities CRUD.** Opportunity/matching CRUD routes and tables (`opportunities`, `matching_results`) exist but are not wired into any live user flow.
- **`creative_data` vs `tropical_*` tables.** The code still reads profile data from the legacy Supabase table `creative_data`, while the TropicalTalent frontend migrations use `tropical_*` tables. Renaming the default string would silently break queries — a real DB migration must come first (see Database Setup above).
- **Pinecone index rename is a default only.** `PINECONE_INDEX_NAME` now defaults to `talent-index` (was `creatives-index`), but no `talent-index` is created by this repo — create it in Pinecone (or point the env var at the existing index) before running.
- **CORS placeholders.** Production origins are `https://tropicaltalent.dev` placeholders — there is no production TropicalTalent domain yet. Update `app/core/middleware/cors.py` when the real domain exists.
- **No `.env` file.** None is committed and none should be; every deployment must inject env vars (see setup above).

## 🔮 Roadmap

- [ ] Real-time Recommendations: WebSocket support for live updates
- [ ] Advanced Analytics: User behavior tracking and insights
- [ ] Multi-modal Search: Support for image and video content
- [ ] Federated Learning: Privacy-preserving recommendation updates
- [ ] A/B Testing: Built-in experimentation framework
- [ ] GraphQL API: Alternative to REST endpoints
- [ ] Batch Processing: Background job system for bulk operations
- [ ] Machine Learning Pipelines: Automated model training and deployment

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

**Built with ❤️ using FastAPI, Pinecone, Supabase, and Google Gemini — now as TropicalTalent.**
