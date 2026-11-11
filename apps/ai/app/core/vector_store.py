"""LangChain Pinecone vector store initialization."""
from typing import Optional

from langchain_pinecone import PineconeVectorStore
from pinecone import Pinecone

from app.core import LoggerMixin, get_settings


class VectorStore(LoggerMixin):
    """LangChain Pinecone vector store wrapper for initialization."""

    def __init__(self):
        self.settings = get_settings()
        self._vector_store: Optional[PineconeVectorStore] = None

    async def initialize(self, embedding) -> None:
        """
        Initialize LangChain Pinecone vector store.

        Args:
            embedding: LangChain embedding model (e.g., GoogleGenerativeAIEmbeddings)
        """
        try:
            # Initialize Pinecone client
            pc = Pinecone(api_key=self.settings.pinecone_api_key)

            # Initialize LangChain PineconeVectorStore
            self._vector_store = PineconeVectorStore(
                index=pc.Index(self.settings.pinecone_index_name),
                embedding=embedding,
                namespace=getattr(self.settings, "pinecone_namespace", ""),
            )

            self.logger.info("LangChain Pinecone vector store initialized successfully")

        except Exception as e:
            self.logger.error("Vector store initialization failed", error=str(e))
            raise

    def get_vector_store(self) -> PineconeVectorStore:
        """
        Get the initialized LangChain Pinecone vector store.

        Returns:
            PineconeVectorStore instance
        """
        if self._vector_store is None:
            raise RuntimeError("Vector store not initialized. Call initialize() first.")
        return self._vector_store


# Dependency injection
async def get_vector_store(embedding) -> PineconeVectorStore:
    """
    Get initialized LangChain Pinecone vector store instance.

    Args:
        embedding: LangChain embedding model

    Returns:
        Initialized PineconeVectorStore
    """
    store = VectorStore()
    await store.initialize(embedding)
    return store.get_vector_store()
