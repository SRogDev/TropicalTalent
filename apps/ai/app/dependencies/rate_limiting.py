"""Rate limiting dependency — Redis fixed-window with in-process fallback.

Primary: Upstash Redis (INCR + EXPIRE) — works correctly across all Gunicorn
workers and across deploys.

Fallback: sliding-window in-process dict used when Redis is unavailable (local
dev or when UPSTASH_REDIS_URL is not set).
"""

import asyncio
import time
from typing import Dict, Optional

from fastapi import HTTPException, Request, status

# ---------------------------------------------------------------------------
# Redis helpers
# ---------------------------------------------------------------------------

try:
    import redis as _redis_lib  # type: ignore
except ImportError:  # pragma: no cover
    _redis_lib = None  # type: ignore

_redis_client: Optional[object] = None


def _get_redis():
    """Return a (cached) Redis client or None if Redis is unavailable."""
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    if _redis_lib is None:
        return None
    try:
        from app.core.config import get_settings
        url = get_settings().upstash_redis_url
        if not url:
            return None
        _redis_client = _redis_lib.from_url(url, decode_responses=True, socket_timeout=3)
        return _redis_client
    except Exception:  # pragma: no cover
        return None


# ---------------------------------------------------------------------------
# In-process fallback (single-worker / dev only)
# ---------------------------------------------------------------------------

_requests: Dict[str, list] = {}
_lock = asyncio.Lock()


async def rate_limit(request: Request, requests_per_minute: int = 60) -> None:
    """FastAPI dependency to enforce a per-IP / per-client rate limit.

    Uses a Redis fixed-window counter (1-minute window) when Redis is
    available, otherwise falls back to the in-process sliding-window.

    Raises HTTPException 429 when the limit is exceeded.
    """
    key = f"rl:{request.client.host if request.client else 'unknown'}"
    r = _get_redis()

    if r is not None:
        try:
            pipe = r.pipeline(transaction=False)
            pipe.incr(key)
            pipe.expire(key, 60)
            results = pipe.execute()
            count: int = results[0]
            if count > requests_per_minute:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many requests, slow down",
                )
            return
        except HTTPException:
            raise
        except Exception:  # pragma: no cover
            pass  # Redis error — fall through to in-process fallback

    # In-process sliding-window fallback
    now = time.time()
    window_start = now - 60.0

    async with _lock:
        timestamps = _requests.get(key, [])
        timestamps = [t for t in timestamps if t > window_start]
        if len(timestamps) >= requests_per_minute:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests, slow down",
            )
        timestamps.append(now)
        _requests[key] = timestamps
