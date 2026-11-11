"""Query enrichment service using Gemini AI via LangChain."""

from __future__ import annotations

import textwrap
from typing import TYPE_CHECKING, Optional

from langchain_google_genai import ChatGoogleGenerativeAI

from app.core.config import get_settings
from app.core.logging import get_logger

if TYPE_CHECKING:
    from app.services.intent_extractor import SearchIntent

logger = get_logger("tropicaltalent.query_enricher")


def get_gemini_chat_model() -> ChatGoogleGenerativeAI:
    """Gemini model for reranking, summaries, and internal operations (temp 0.7, 2000 tokens)."""
    model = getattr(get_gemini_chat_model, "_model", None)
    if model is None:
        settings = get_settings()
        model = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=settings.gemini_api_key,
            temperature=0.7,
            max_output_tokens=2000,
        )
        setattr(get_gemini_chat_model, "_model", model)
        logger.info("Gemini chat model initialized (reranking/internal, temp=0.7, max_output_tokens=2000)")

    return model


def get_gemini_enrichment_model() -> ChatGoogleGenerativeAI:
    """Dedicated Gemini model for query enrichment (temp 0.3, 1000 tokens).

    Lower temperature prevents over-expansion of queries that can dilute
    embedding precision. Separate from reranking model which needs higher
    creativity.
    """
    model = getattr(get_gemini_enrichment_model, "_model", None)
    if model is None:
        settings = get_settings()
        model = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=settings.gemini_api_key,
            temperature=0.3,
            max_output_tokens=1000,
        )
        setattr(get_gemini_enrichment_model, "_model", model)
        logger.info("Gemini enrichment model initialized (query expansion, temp=0.3, max_output_tokens=1000)")

    return model


def get_gemini_response_model() -> ChatGoogleGenerativeAI:
    """Dedicated Gemini model for user-facing responses (1000 tokens per call)."""
    model = getattr(get_gemini_response_model, "_model", None)
    if model is None:
        settings = get_settings()
        model = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=settings.gemini_api_key,
            temperature=0.7,
            max_output_tokens=1000,
        )
        setattr(get_gemini_response_model, "_model", model)
        logger.info("Gemini response model initialized (user responses, max_output_tokens=1000)")

    return model


def get_gemini_reranking_model() -> ChatGoogleGenerativeAI:
    """Dedicated Gemini model for candidate reranking with structured JSON output.

    Uses response_mime_type="application/json" to guarantee valid JSON output,
    eliminating parsing failures in the reranking pipeline.
    Temperature 0.4 balances consistency with nuanced relevance judgment.
    """
    model = getattr(get_gemini_reranking_model, "_model", None)
    if model is None:
        settings = get_settings()
        model = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=settings.gemini_api_key,
            temperature=0.4,
            max_output_tokens=2000,
            model_kwargs={"response_mime_type": "application/json"},
        )
        setattr(get_gemini_reranking_model, "_model", model)
        logger.info("Gemini reranking model initialized (structured JSON, temp=0.4)")

    return model


async def enrich_search_query(query: str, intent: Optional[SearchIntent] = None) -> str:
    """
    Enrich search query with similar terms and concepts using AI.

    Takes a user's search query and uses Gemini to expand it with related terms,
    synonyms, and conceptually similar phrases. This improves the quality of the
    embedding vector generated for semantic search.

    When intent is provided and contains a location_city or username, those are
    stripped from the enriched text so the embedding focuses purely on talent
    skills — the metadata filter in Pinecone already handles those signals.

    Args:
        query: Original user search query
        intent: Optional extracted intent from intent_extractor

    Returns:
        Enriched query string focused on talent skills and roles.

    Example:
        >>> original = "jazz drummer in London"
        >>> enriched = await enrich_search_query(original, intent)
        >>> # Returns terms about jazz drumming only — "London" handled by metadata filter
    """
    if not query or not query.strip():
        logger.warning("Empty query provided for enrichment")
        return query

    try:
        logger.info("Enriching search query", query=query)

        model = get_gemini_enrichment_model()

        # Build intent-aware instruction to keep embedding focused on talent skills
        intent_note = ""
        if intent:
            stripped = []
            if intent.location_city:
                stripped.append(f"location '{intent.location_city}'")
            if intent.username:
                stripped.append(f"username '{intent.username}'")
            if stripped:
                intent_note = (
                    f"\nIMPORTANT: The user mentioned {' and '.join(stripped)}. "
                    "These are handled by a separate exact filter — do NOT include them "
                    "in the enriched query. Focus ONLY on the talent skills and roles.\n"
                )

        prompt = textwrap.dedent(
            f"""
            You are a search query enhancement expert for a talent
            network. Your task is to enrich search queries to improve semantic
            search results.

            Given a search query, expand it with:
            - Related terms and synonyms
            - Conceptually similar phrases
            - Industry-specific terminology (music, art, design, production, photography)
            - Common role variations and related specializations
            {intent_note}
            Keep the enriched query natural and focused on talent skills.
            Return ONLY the enriched query text, no explanations or formatting.

            Original search query: "{query}"

            Enrich this query with related talent terms to improve semantic search.
            Return the enriched query as a single paragraph of natural text.
            """
        )

        response = await model.ainvoke(prompt)
        enriched_query = response.content.strip()

        if not enriched_query:
            logger.warning("Gemini returned empty enriched query, using original")
            return query

        logger.info(
            "Query enrichment complete",
            original_length=len(query),
            enriched_length=len(enriched_query),
            intent_applied=bool(intent_note),
        )

        return enriched_query

    except Exception as e:  # pylint: disable=broad-except
        logger.error(
            "Query enrichment failed, using original query",
            error=str(e),
            error_type=type(e).__name__,
            query=query,
        )
        return query
