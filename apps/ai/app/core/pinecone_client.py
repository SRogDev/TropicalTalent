"""
Pinecone client with FastAPI dependency injection.

Provides proper dependency injection pattern for Pinecone Index,
avoiding singletons and global state antipatterns.
"""

from functools import lru_cache

from pinecone import Pinecone

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("core.pinecone_client")


@lru_cache()
def get_pinecone_client() -> Pinecone:
    """
    Get Pinecone client instance.

    Uses lru_cache to ensure single instance per process (proper caching).
    This is the correct FastAPI pattern instead of global singletons.

    Returns:
        Configured Pinecone client
    """
    settings = get_settings()
    client = Pinecone(api_key=settings.pinecone_api_key)
    logger.info("Pinecone client initialized")
    return client


def get_pinecone_index(client: Pinecone = None):
    """
    Get Pinecone index instance.

    FastAPI dependency injection pattern for Pinecone Index.
    Can be used with Depends() in route handlers.

    Args:
        client: Pinecone client (injected by FastAPI)

    Returns:
        Pinecone Index instance

    Example:
        @router.post("/search")
        async def search(
            index: Index = Depends(get_pinecone_index)
        ):
            results = index.query(vector=embedding, top_k=10)
    """
    if client is None:
        client = get_pinecone_client()

    settings = get_settings()
    index = client.Index(settings.pinecone_index_name)
    logger.debug("Pinecone index retrieved", index_name=settings.pinecone_index_name)
    return index
