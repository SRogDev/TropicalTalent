"""Core package initialization."""

import sentry_sdk
from . import sentry
from .config import Settings, get_settings
from .embedding_search import get_embedding_search_service
from .logging import LoggerMixin, configure_logging, get_logger
from .middleware.cors import setup_cors
from .user_vector_cache import get_user_vector_cache


# Helper functions for embedding search
async def search_similar_users(query: str, top_k: int = 10, filter: dict = None):
    """Search for similar users using embedding search."""
    service = get_embedding_search_service()
    return await service.search(query=query, top_k=top_k, filter=filter)


async def search_by_vector(embedding: list, top_k: int = 20, filter: dict = None):
    """Search for similar users using a pre-computed embedding vector."""
    service = get_embedding_search_service()
    return await service.search_by_vector(
        embedding=embedding, top_k=top_k, filter=filter
    )


async def generate_embedding(text: str):
    """Generate embedding for text."""
    service = get_embedding_search_service()
    return await service.generate_embedding(text)


def get_vector_store():
    """Get the vector store instance."""
    service = get_embedding_search_service()
    return service.vector_store


def capture_exception(exception, extra_data=None):
    """Capture exception with Sentry and optional extra data."""
    if extra_data:
        # sentry_sdk.push_scope was deprecated in SDK 2.x (removed in the
        # next major); new_scope is its replacement.
        with sentry_sdk.new_scope() as scope:
            for key, value in extra_data.items():
                scope.set_extra(key, value)
            sentry_sdk.capture_exception(exception)
    else:
        sentry_sdk.capture_exception(exception)


__all__ = [
    "get_settings",
    "Settings",
    "capture_exception",
    "configure_logging",
    "get_logger",
    "LoggerMixin",
    "get_user_vector_cache",
    "setup_cors",
    "sentry",
    "get_embedding_search_service",
    "search_similar_users",
    "search_by_vector",
    "generate_embedding",
    "get_vector_store",
]
