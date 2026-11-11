"""Embedding generation service using Google's text-embedding model."""

from typing import List, Optional

from langchain_google_genai import GoogleGenerativeAIEmbeddings

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("tropicaltalent.embedding_service")


def get_embeddings_model() -> GoogleGenerativeAIEmbeddings:
    """Return a singleton GoogleGenerativeAIEmbeddings instance.

    Uses a function attribute to avoid module-level globals.
    """
    model = getattr(get_embeddings_model, "_model", None)
    if model is None:
        settings = get_settings()
        model = GoogleGenerativeAIEmbeddings(
            model="models/gemini-embedding-001",
            google_api_key=settings.gemini_api_key,
        )
        setattr(get_embeddings_model, "_model", model)

    return model


async def generate_embedding(text: str) -> Optional[List[float]]:
    """
    Generate an embedding vector for the given text using Google's embedding model.

    Args:
        text: The text to generate an embedding for

    Returns:
        A list of floats representing the embedding vector, or None if generation fails
    """
    try:
        if not text or not text.strip():
            logger.warning("Empty text provided for embedding generation")
            return None

        embeddings_model = get_embeddings_model()

        # Generate embedding asynchronously
        embedding = await embeddings_model.aembed_query(text.strip())

        logger.info("Successfully generated embedding of dimension %d", len(embedding))
        return embedding
    except Exception as e:  # pylint: disable=broad-except
        logger.error("Failed to generate embedding: %s", str(e))
        return None


async def generate_embeddings_batch(texts: List[str]) -> Optional[List[List[float]]]:
    """
    Generate embedding vectors for multiple texts.

    Args:
        texts: List of texts to generate embeddings for

    Returns:
        A list of embedding vectors, or None if generation fails
    """
    try:
        if not texts:
            logger.warning("Empty texts list provided for batch embedding generation")
            return None

        embeddings_model = get_embeddings_model()

        # Generate embeddings asynchronously
        embeddings = await embeddings_model.aembed_documents(texts)

        logger.info("Successfully generated %d embeddings", len(embeddings))
        return embeddings

    except Exception as e:  # pylint: disable=broad-except
        logger.error("Failed to generate batch embeddings: %s", str(e))
        return None
