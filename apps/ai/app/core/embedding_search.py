"""Embedding and search service using LangChain with Pinecone."""

from typing import Any, Dict, List, Optional

from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from pinecone import Pinecone

from app.core.config import get_settings
from app.core.logging import LoggerMixin


class EmbeddingSearchService(LoggerMixin):
    """Simplified embedding and search service using LangChain Pinecone integration."""

    def __init__(self):
        settings = get_settings()

        # Initialize Pinecone
        self.pc = Pinecone(api_key=settings.pinecone_api_key)
        self.index_name = settings.pinecone_index_name
        self.index = self.pc.Index(self.index_name)

        # Initialize embeddings with Google Generative AI
        self.embeddings = GoogleGenerativeAIEmbeddings(
            model="models/gemini-embedding-001", google_api_key=settings.gemini_api_key
        )

        # Initialize vector store
        self.vector_store = PineconeVectorStore(
            index=self.index, embedding=self.embeddings, text_key="text"
        )

        self.logger.info("Embedding search service initialized", index=self.index_name)

    async def search(
        self, query: str, top_k: int = 10, filter: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """Search for similar documents using semantic search."""
        try:
            results = self.vector_store.similarity_search_with_score(
                query=query, k=top_k, filter=filter
            )

            return [
                {
                    "user_id": doc.metadata.get("user_id", doc.page_content),
                    "score": score,
                    "bio": doc.metadata.get("bio"),
                    "tags": doc.metadata.get("tags", []),
                    "passion": doc.metadata.get("passion"),
                    "metadata": doc.metadata,
                }
                for doc, score in results
            ]
        except (ConnectionError, TimeoutError, ValueError) as e:
            self.logger.error("Search failed", error=str(e))
            raise

    async def search_by_vector(
        self,
        embedding: List[float],
        top_k: int = 20,
        filter: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """Search for similar documents using a pre-computed embedding vector."""
        try:
            results = await self.vector_store.asimilarity_search_by_vector(
                embedding=embedding, k=top_k, filter=filter
            )

            return [
                {
                    "user_id": doc.metadata.get("user_id", doc.page_content),
                    "score": 0.0,  # LangChain doesn't return scores with this method
                    "bio": doc.metadata.get("bio"),
                    "tags": doc.metadata.get("tags", []),
                    "passion": doc.metadata.get("passion"),
                    "metadata": doc.metadata,
                }
                for doc in results
            ]
        except Exception as e:
            self.logger.error("Vector search failed", error=str(e))
            raise

    async def generate_embedding(self, text: str) -> List[float]:
        """Generate embedding for text."""
        try:
            embedding = self.embeddings.embed_query(text)
            self.logger.debug(
                "Embedding generated",
                text_length=len(text),
                embedding_dim=len(embedding),
            )
            return embedding
        except Exception as e:
            self.logger.error("Embedding generation failed", error=str(e))
            raise

    async def upsert_document(
        self, user_id: str, text: str, metadata: Optional[Dict[str, Any]] = None
    ) -> None:
        """Upsert a document to the vector store."""
        try:
            metadata = metadata or {}
            metadata["user_id"] = user_id

            self.vector_store.add_texts(
                texts=[text], metadatas=[metadata], ids=[user_id]
            )

            self.logger.info("Document upserted", user_id=user_id)
        except Exception as e:
            self.logger.error("Document upsert failed", user_id=user_id, error=str(e))
            raise


_embedding_search_service: Optional[EmbeddingSearchService] = None


def get_embedding_search_service() -> EmbeddingSearchService:
    """Get singleton embedding search service."""
    global _embedding_search_service
    if _embedding_search_service is None:
        _embedding_search_service = EmbeddingSearchService()
    return _embedding_search_service
