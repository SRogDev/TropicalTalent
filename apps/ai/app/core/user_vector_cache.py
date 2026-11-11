"""
User vector cache for storing averaged search preference vectors.

Redis-backed with in-memory fallback so the cache survives across
multiple Gunicorn workers and process restarts.

Design Notes:
- Redis primary (Upstash), in-memory dict as fallback
- Thread-safe lock guards the fallback path
- TTL enforced by Redis SETEX; fallback uses datetime comparison
- Key scheme: uvc:{user_id}
"""

import json
from datetime import datetime, timedelta
from threading import Lock
from typing import Dict, List, Optional

from app.core.logging import LoggerMixin

try:
    import redis as _redis_lib  # type: ignore
except ImportError:  # pragma: no cover
    _redis_lib = None  # type: ignore


def _build_redis_client():
    """Create an Upstash Redis client from env config, or return None."""
    if _redis_lib is None:
        return None
    try:
        from app.core.config import get_settings
        url = get_settings().upstash_redis_url
        if not url:
            return None
        return _redis_lib.from_url(url, decode_responses=True, socket_timeout=5)
    except Exception:  # pragma: no cover
        return None


class UserVectorCache(LoggerMixin):
    """
    Redis-backed cache for user preference vectors.

    Falls back to an in-memory dict if Redis is unavailable so the
    recommendation service still works in local development.

    Same public interface as the original in-memory implementation.
    """

    def __init__(self, default_ttl_minutes: int = 60):
        self._redis = _build_redis_client()
        self._fallback: Dict[str, Dict] = {}
        self._lock = Lock()
        self.default_ttl = timedelta(minutes=default_ttl_minutes)

        backend = "Redis" if self._redis else "in-memory (fallback)"
        self.logger.info(
            "UserVectorCache initialized", ttl_minutes=default_ttl_minutes, backend=backend
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _key(user_id: str) -> str:
        return f"uvc:{user_id}"

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def get_user_vector(self, user_id: str) -> Optional[List[float]]:
        """Return cached vector or None on miss / expiry."""
        if self._redis:
            try:
                raw = self._redis.get(self._key(user_id))
                if raw is None:
                    self.logger.debug("Cache miss (Redis)", user_id=user_id)
                    return None
                vector = json.loads(raw)
                self.logger.debug("Cache hit (Redis)", user_id=user_id, dim=len(vector))
                return vector
            except Exception as exc:  # pragma: no cover
                self.logger.warning("Redis get failed, using fallback", error=str(exc))

        # Fallback path
        with self._lock:
            entry = self._fallback.get(user_id)
            if entry is None:
                return None
            if datetime.utcnow() > entry["expires_at"]:
                del self._fallback[user_id]
                return None
            return entry["vector"]

    def set_user_vector(
        self, user_id: str, vector: List[float], ttl: Optional[timedelta] = None
    ) -> None:
        """Store a preference vector in the cache."""
        ttl_seconds = int((ttl or self.default_ttl).total_seconds())

        if self._redis:
            try:
                self._redis.setex(self._key(user_id), ttl_seconds, json.dumps(vector))
                self.logger.debug("Vector cached (Redis)", user_id=user_id, dim=len(vector))
                return
            except Exception as exc:  # pragma: no cover
                self.logger.warning("Redis set failed, using fallback", error=str(exc))

        # Fallback path
        with self._lock:
            self._fallback[user_id] = {
                "vector": vector,
                "cached_at": datetime.utcnow(),
                "expires_at": datetime.utcnow() + (ttl or self.default_ttl),
            }

    def invalidate_user(self, user_id: str) -> bool:
        """Remove cached vector for a user. Returns True if something was deleted."""
        deleted = False

        if self._redis:
            try:
                deleted = bool(self._redis.delete(self._key(user_id)))
                self.logger.debug("Cache invalidated (Redis)", user_id=user_id)
                return deleted
            except Exception as exc:  # pragma: no cover
                self.logger.warning("Redis delete failed, using fallback", error=str(exc))

        with self._lock:
            if user_id in self._fallback:
                del self._fallback[user_id]
                return True
        return deleted

    def clear(self) -> None:
        """Clear all in-memory fallback entries. (Redis keys expire naturally.)"""
        with self._lock:
            count = len(self._fallback)
            self._fallback.clear()
            self.logger.info("In-memory fallback cleared", entries_removed=count)

    def size(self) -> int:
        """Return number of in-memory fallback entries."""
        with self._lock:
            return len(self._fallback)

    def get_stats(self) -> Dict:
        """Return basic stats from the in-memory fallback."""
        with self._lock:
            if not self._fallback:
                return {"size": 0, "oldest_entry": None, "newest_entry": None}
            times = [e["cached_at"] for e in self._fallback.values()]
            return {
                "size": len(self._fallback),
                "oldest_entry": min(times).isoformat(),
                "newest_entry": max(times).isoformat(),
            }


# Global cache instance (singleton)
_user_vector_cache: Optional[UserVectorCache] = None


def get_user_vector_cache() -> UserVectorCache:
    """Return the global UserVectorCache singleton."""
    global _user_vector_cache
    if _user_vector_cache is None:
        _user_vector_cache = UserVectorCache()
    return _user_vector_cache
