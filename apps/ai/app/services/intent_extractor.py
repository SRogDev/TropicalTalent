"""Search intent extraction service.

Uses Gemini to parse a raw user query and extract structured metadata signals
(location city, username, passion) that can be used as Pinecone pre-filters.

Design:
- Runs BEFORE query enrichment so enrichment can focus on talent skills only.
- Low temperature (0.1) for deterministic, consistent JSON output.
- All fields are Optional — falls back to all-null SearchIntent on any error.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Optional

from langchain_google_genai import ChatGoogleGenerativeAI

from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.city_normalizer import normalize_city

logger = get_logger("tropicaltalent.intent_extractor")


@dataclass
class SearchIntent:
    """Structured signals extracted from a raw user query."""

    location_city: Optional[str] = None  # Used as Pinecone $eq filter on `city`
    username: Optional[str] = None       # Used as Pinecone $eq filter on `username`
    passion: Optional[str] = None        # Used only for enrichment context, NOT filtered


_NULL_INTENT = SearchIntent()


def _get_intent_model() -> ChatGoogleGenerativeAI:
    """Singleton Gemini model configured for deterministic JSON extraction."""
    model = getattr(_get_intent_model, "_model", None)
    if model is None:
        settings = get_settings()
        model = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=settings.gemini_api_key,
            temperature=0.1,
            max_output_tokens=600,
        )
        setattr(_get_intent_model, "_model", model)
        logger.info("Gemini intent extraction model initialized")
    return model


async def extract_search_intent(query: str) -> SearchIntent:
    """Extract structured intent signals from a raw user search query.

    Identifies whether the query explicitly mentions:
    - A city/location (for Pinecone city metadata filter)
    - A specific username (for Pinecone username metadata filter)
    - A talent role/passion (for enrichment context only)

    Args:
        query: Raw user query string

    Returns:
        SearchIntent with extracted fields. All fields are None if not found.
        Never raises — falls back to all-null SearchIntent on any failure.

    Examples:
        "a photographer in London"      → SearchIntent(location_city="London", passion="photographer")
        "a developer named Rogeroria"   → SearchIntent(username="Rogeroria", passion="developer")
        "find me a jazz musician"       → SearchIntent(passion="musician")
        "who was the king of england"   → SearchIntent() (all null — not a talent search)
    """
    if not query or not query.strip():
        return _NULL_INTENT

    try:
        model = _get_intent_model()

        prompt = (
            "You are a search intent parser for a talent networking platform.\n"
            "Analyze the user query and extract ONLY values that are explicitly and clearly stated.\n\n"
            "Extract:\n"
            "- location_city: The city name if the user explicitly mentions a location (e.g. 'in London', "
            "'based in NYC', 'from Madrid'). Return ONLY the city name, no country. null if not mentioned.\n"
            "- username: A specific username or person's name if the user is looking for someone by name "
            "(e.g. 'named Rogeroria', 'called Maria'). null if not mentioned.\n"
            "- passion: The talent role, profession or skill being searched "
            "(e.g. 'photographer', 'music producer', 'graphic designer'). "
            "null if not clearly a talent search.\n\n"
            "Rules:\n"
            "- If nothing is explicitly stated, return null for that field. Do NOT infer.\n"
            "- Return ONLY a valid JSON object with exactly these 3 keys. No markdown, no explanation.\n"
            "- location_city and username should be capitalized exactly as stated by the user.\n\n"
            f'User query: "{query}"\n\n'
            "JSON:"
        )

        response = await model.ainvoke(prompt)
        content = (getattr(response, "content", "") or "").strip()

        # Strip markdown code fences if present
        if content.startswith("```"):
            content = re.sub(r"^```[a-z]*\n?", "", content)
            content = re.sub(r"\n?```$", "", content)
            content = content.strip()

        parsed = json.loads(content)

        intent = SearchIntent(
            location_city=normalize_city(parsed.get("location_city")) or None,
            username=parsed.get("username") or None,
            passion=parsed.get("passion") or None,
        )

        logger.info(
            "Intent extracted",
            query=query,
            location_city=intent.location_city,
            username=intent.username,
            passion=intent.passion,
        )

        return intent

    except Exception as e:  # pylint: disable=broad-except
        logger.warning(
            "Intent extraction failed, using null intent",
            query=query,
            error=str(e),
        )
        return _NULL_INTENT
