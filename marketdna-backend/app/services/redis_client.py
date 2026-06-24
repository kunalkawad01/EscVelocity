"""Redis cache client with graceful fallback to in-process dict.

If Redis is not installed or not reachable, all operations transparently fall
back to a local in-process dict — the app works exactly as before, just without
cross-restart persistence or multi-worker cache sharing.

Usage:
    from app.services.redis_client import cache

    # store any Python object (Pydantic model, list, dict, …)
    cache.set("regime:score:RELIANCE:2024-06-22", result, ttl=86400)
    result = cache.get("regime:score:RELIANCE:2024-06-22")

    # bulk invalidation
    cache.delete_pattern("regime:*")

    # check availability (useful for startup logging)
    cache.is_available()
"""
import logging
import pickle
import time
from typing import Any

log = logging.getLogger(__name__)

# ── TTL constants (seconds) ────────────────────────────────────────────────────
TTL_24H  = 86_400   # daily OHLCV, regime scores, breadth, delivery, indicators
TTL_1H   = 3_600    # intraday data (options, futures live prices)
TTL_5MIN = 300      # very short-lived (live trading ticks)


class _RedisCache:
    """Thin wrapper around redis.Redis with pickle serialization and fallback."""

    def __init__(self) -> None:
        self._client = None
        self._available: bool | None = None          # None = not yet probed
        self._fallback: dict[str, tuple[Any, float]] = {}  # key → (value, expire_at)

    # ── Internal ───────────────────────────────────────────────────────────────

    def _init_client(self) -> None:
        """Lazy-init: import redis and connect on first use."""
        if self._client is not None:
            return
        try:
            import redis                             # type: ignore
            from app.config import settings
            self._client = redis.Redis(
                host=settings.redis_host,
                port=settings.redis_port,
                db=0,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
        except Exception as exc:
            log.warning("redis_client: cannot import/init redis — %s", exc)
            self._available = False

    def _probe(self) -> bool:
        """Ping Redis once; cache the result."""
        if self._available is not None:
            return self._available
        self._init_client()
        if self._client is None:
            self._available = False
            return False
        try:
            self._client.ping()
            self._available = True
            log.info("redis_client: connected to Redis — cache persistence enabled")
        except Exception as exc:
            self._available = False
            log.warning(
                "redis_client: Redis not reachable (%s) — "
                "using in-process fallback (no cross-restart persistence)", exc
            )
        return self._available

    # ── Public API ─────────────────────────────────────────────────────────────

    def is_available(self) -> bool:
        return self._probe()

    def get(self, key: str) -> Any | None:
        """Return cached value for key, or None on miss/error."""
        if self._probe():
            try:
                raw = self._client.get(key)
                return pickle.loads(raw) if raw else None
            except Exception as exc:
                log.debug("redis_client: get(%s) failed — %s", key, exc)
        # fallback
        entry = self._fallback.get(key)
        if entry and entry[1] > time.monotonic():
            return entry[0]
        return None

    def set(self, key: str, value: Any, ttl: int = TTL_24H) -> None:
        """Store value under key with a TTL (seconds)."""
        if self._probe():
            try:
                self._client.setex(key, ttl, pickle.dumps(value))
                return
            except Exception as exc:
                log.debug("redis_client: set(%s) failed — %s", key, exc)
        # fallback
        self._fallback[key] = (value, time.monotonic() + ttl)
        self._evict_fallback()

    def exists(self, key: str) -> bool:
        """True if key exists and has not expired."""
        if self._probe():
            try:
                return bool(self._client.exists(key))
            except Exception:
                pass
        entry = self._fallback.get(key)
        return bool(entry and entry[1] > time.monotonic())

    def delete_pattern(self, pattern: str) -> int:
        """Delete all keys matching a glob pattern (e.g. 'regime:*').

        Returns the number of keys deleted.
        """
        if self._probe():
            try:
                keys = self._client.keys(pattern)
                if keys:
                    return int(self._client.delete(*keys))
                return 0
            except Exception as exc:
                log.debug("redis_client: delete_pattern(%s) failed — %s", pattern, exc)
        # fallback: simple prefix match (supports trailing * only)
        prefix = pattern.rstrip("*") if pattern.endswith("*") else None
        matched = [
            k for k in list(self._fallback)
            if (prefix and k.startswith(prefix)) or k == pattern
        ]
        for k in matched:
            del self._fallback[k]
        return len(matched)

    def _evict_fallback(self) -> None:
        """Remove expired entries from the fallback dict (runs periodically)."""
        if len(self._fallback) > 5_000:
            now = time.monotonic()
            expired = [k for k, (_, exp) in self._fallback.items() if exp <= now]
            for k in expired:
                del self._fallback[k]


# ── Module-level singleton ─────────────────────────────────────────────────────
cache = _RedisCache()
