# 🚀 Deployment Guide - TropicalTalent AI Backend

## Production Server Configuration

This project uses **Gunicorn with Uvicorn workers** for optimal production performance.

## 📦 Files Overview

| File | Purpose |
|------|---------|
| `gunicorn.conf.py` | Production server configuration (workers, timeouts, logging) |
| `railway.json` | Railway-specific deployment config |
| `Procfile` | Heroku/Railway fallback process file |
| `start_production.sh` | Local production startup script |
| `pyproject.toml` + `uv.lock` | Python dependencies via uv (includes gunicorn) |

---

## 🔧 Gunicorn Configuration

### Key Settings (`gunicorn.conf.py`)

```python
# Worker processes - auto-calculated
workers = CPU_COUNT * 2 + 1  # Or set GUNICORN_WORKERS env var

# Worker class - Uvicorn for async support
worker_class = "uvicorn.workers.UvicornWorker"

# Timeouts
timeout = 120  # Request timeout (2 minutes)
graceful_timeout = 30  # Graceful shutdown timeout
keepalive = 5  # Keep-alive connections

# Memory leak prevention
max_requests = 1000  # Restart worker after 1000 requests
max_requests_jitter = 50  # Add randomness to restarts

# Performance optimization
preload_app = True  # Share code across workers
```

### Environment Variables

```bash
# Optional overrides
export GUNICORN_WORKERS=4  # Override worker count
export LOG_LEVEL=info      # Set log level (debug, info, warning, error)
export PORT=8000           # Server port (Railway sets this automatically)
```

---

## 🏭 Railway Deployment

### 1. Setup Project

```bash
# Install Railway CLI (optional)
npm install -g @railway/cli

# Login
railway login

# Link project
railway link
```

### 2. Configure Environment Variables

Set these in Railway dashboard:

```env
# Required (placeholders only — never commit real keys; there is no .env in the repo)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>
SUPABASE_JWT_SECRET=<your-supabase-jwt-secret>
PINECONE_API_KEY=<your-pinecone-api-key>
PINECONE_INDEX_NAME=talent-index
GEMINI_API_KEY=<your-gemini-api-key>
INTERNAL_API_KEY=<generate-with-openssl-rand-hex-32>  # required — no default; app fails fast without it

# Optional
SENTRY_DSN=https://your-sentry-dsn  # Error tracking
LOG_LEVEL=info                       # Logging level
DEBUG=false                          # Disable debug mode in production
```

### 3. Deploy

```bash
# Push to main branch
git push origin main

# Or deploy via Railway CLI
railway up
```

Railway will automatically:

- ✅ Detect `railway.json` configuration
- ✅ Install dependencies with `uv sync` (locked by `uv.lock`)
- ✅ Start with production command: `uv run gunicorn app.main:app --config gunicorn.conf.py`
- ✅ Scale workers based on available CPU
- ✅ Restart on failure (max 10 retries)

### 4. Monitor

```bash
# View logs
railway logs

# Check status
railway status

# Open in browser
railway open
```

---

## 🐳 Docker Deployment (Optional)

### Dockerfile

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# Install uv (package manager) and dependencies from the lockfile
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Copy application
COPY . .

# Expose port
EXPOSE 8000

# Start with Gunicorn (via the uv-managed venv)
CMD ["uv", "run", "gunicorn", "app.main:app", "--config", "gunicorn.conf.py"]
```

### Build and Run

```bash
# Build image
docker build -t tropical-talent-ai .

# Run container
docker run -p 8000:8000 \
  --env-file .env \
  tropical-talent-ai

# Or with docker-compose
docker-compose up -d
```

---

## 🧪 Local Production Testing

### Test production configuration locally

```bash
# Make script executable (first time only)
chmod +x start_production.sh

# Start production server
./start_production.sh

# Or run Gunicorn directly
uv run gunicorn app.main:app --config gunicorn.conf.py
```

### Verify it's working

```bash
# Check health
curl http://localhost:8000/

# Check with load
ab -n 1000 -c 10 http://localhost:8000/

# Monitor workers
ps aux | grep gunicorn
```

---

## ⚙️ Performance Tuning

### Worker Count

**Formula:** `workers = (2 * CPU_CORES) + 1`

**Examples:**

- 1 CPU: 3 workers
- 2 CPUs: 5 workers
- 4 CPUs: 9 workers

**Override:**

```bash
export GUNICORN_WORKERS=4
```

### When to Increase Workers

- ✅ High CPU availability
- ✅ I/O-bound operations (database calls)
- ✅ Many concurrent requests

### When to Decrease Workers

- ⚠️ Limited memory (each worker uses ~100-200MB)
- ⚠️ CPU-intensive operations
- ⚠️ Small instance size

### Timeout Settings

```python
# Current settings
timeout = 120           # 2 minutes for long AI operations
graceful_timeout = 30   # 30s for cleanup
keepalive = 5          # 5s keep-alive

# Adjust for your needs:
# - Increase timeout for slower AI models
# - Decrease timeout for faster APIs
# - Adjust keepalive for connection pooling
```

---

## 📊 Monitoring

### Application Logs

Gunicorn logs to stdout/stderr (visible in Railway logs):

```
✅ Server ready. Listening on 0.0.0.0:8000
👷 Workers: 4
⚙️ Worker class: uvicorn.workers.UvicornWorker
👶 Worker spawned (pid: 123)
```

### Health Checks

```bash
# Root endpoint
curl https://your-app.railway.app/

# API docs
curl https://your-app.railway.app/docs

# Specific endpoint test
curl https://your-app.railway.app/api/agent \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "test"}'
```

### Sentry Integration

Already configured in the app:

- Automatic error capture
- Performance monitoring
- Release tracking

---

## 🔥 Troubleshooting

### Issue: Workers timing out

**Solution:** Increase timeout in `gunicorn.conf.py`:

```python
timeout = 180  # 3 minutes
```

### Issue: High memory usage

**Solution:** Reduce workers or enable max_requests:

```python
workers = 2  # Fewer workers
max_requests = 500  # Restart workers more often
```

### Issue: Slow startup

**Solution:** Disable preload_app:

```python
preload_app = False  # Load app per worker
```

### Issue: Port binding error

**Solution:** Ensure PORT env var is set:

```bash
export PORT=8000
```

---

## 🎯 Production Checklist

- [ ] Environment variables configured in Railway
- [ ] Sentry DSN set for error tracking
- [ ] Database connections tested (Supabase + Pinecone)
- [ ] API keys validated (Google API, etc.)
- [ ] Debug mode disabled (`DEBUG=false`)
- [ ] Log level set to `info` or `warning`
- [ ] Health checks passing
- [ ] SSL/HTTPS enabled (Railway does this automatically)
- [ ] Rate limiting configured
- [ ] CORS origins set appropriately
- [ ] Secrets rotated and secured

---

## 📚 Additional Resources

- [Gunicorn Documentation](https://docs.gunicorn.org/)
- [Uvicorn Workers](https://www.uvicorn.org/deployment/)
- [Railway Documentation](https://docs.railway.app/)
- [FastAPI Deployment](https://fastapi.tiangolo.com/deployment/)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)

---

**Need help?** Check the logs first:

```bash
railway logs --follow
```
