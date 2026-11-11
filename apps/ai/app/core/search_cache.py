"""
Redis cache for semantic search results.

Caches the serialised SearchResponse results for a (user_id, query) pair so
that repeated identical searches within the TTL window skip the expensive
AI pipeline (intent extraction → enrichment → embedding → Pinecone → Gemini).

Key scheme : search:cache:{user_id}:{sha256(query.lower())[:16]}
TTL        : 300 s  (5 minutes)

Design:
- Only positive results (> 0 matches) are cached — empty results may be
  transient and should be retried.
- The background log-save is skipped on cache hits to avoid duplicate rows.
"""

import hashlib
import json
import logging
from typing import Optional

logger = logging.getLogger("tropicaltalent.search_cache")

try:
    import redis as _redis_lib  # type: ignore
except ImportError:  # pragma: no cover
    _redis_lib = None  # type: ignore

_CACHE_TTL = 300  # seconds


def _build_key(user_id: str, query: str) -> str:
    digest = hashlib.sha256(query.lower().strip().encode()).hexdigest()[:16]
    return f"search:cache:{user_id}:{digest}"


def _get_redis():
    """Lazily build a Redis client from config; return None if unavailable."""
    if _redis_lib is None:
        return None
    try:
        from app.core.config import get_settings  # local import to avoid circular

        url = get_settings().upstash_redis_url
        if not url:
            return None
        return _redis_lib.from_url(url, decode_responses=True, socket_timeout=3)
    except Exception:  # pragma: no cover
        return None


# Module-level Redis singleton (avoids reconnecting on every request)
_redis_client = None


def _redis() -> Optional[object]:
    global _redis_client
    if _redis_client is None:
        _redis_client = _get_redis()
    return _redis_client


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_search_cache(user_id: str, query: str) -> Optional[dict]:
    """Return cached search payload dict or None on miss / error."""
    r = _redis()
    if r is None:
        return None
    try:
        raw = r.get(_build_key(user_id, query))  # type: ignore[union-attr]
        if raw is None:
            return None
        logger.debug("Search cache hit", extra={"user_id": user_id})
        return json.loads(raw)
    except Exception as exc:  # pragma: no cover
        logger.warning("Search cache get failed: %s", exc)
        return None


def set_search_cache(user_id: str, query: str, payload: dict) -> None:
    """Store a search payload dict with TTL. Silently ignores errors."""
    r = _redis()
    if r is None:
        return
    try:
        r.setex(_build_key(user_id, query), _CACHE_TTL, json.dumps(payload))  # type: ignore[union-attr]
        logger.debug("Search result cached", extra={"user_id": user_id})
    except Exception as exc:  # pragma: no cover
        logger.warning("Search cache set failed: %s", exc)
