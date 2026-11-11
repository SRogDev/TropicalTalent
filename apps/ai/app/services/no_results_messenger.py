"""No-results messenger service for generating helpful search suggestions."""

import textwrap
from typing import AsyncGenerator

from app.core.logging import get_logger
from app.services.query_enricher import get_gemini_response_model

logger = get_logger("services.no_results_messenger")

# Static fallback message (used if Gemini fails)
FALLBACK_MESSAGE = (
    "We couldn't find any talent matching your search. "
    "Try broadening your criteria or using different keywords."
)


async def generate_no_results_message(
    query: str, reason: str = "found no matching talent"
) -> str:
    """
    Generate contextual no-results message using Gemini AI.

    Args:
        query: The user's original search query
        reason: Brief explanation (e.g., "found no matching talent", "only weak matches")

    Returns:
        Contextual message in English with alternative suggestions
    """
    try:
        model = get_gemini_response_model()

        prompt = textwrap.dedent(
            f"""
            You are a helpful assistant for a talent networking platform.
            The user searched for: "{query}"
            Unfortunately, we {reason}.

            Generate a friendly, professional response in English that:
            1. Acknowledges what they searched for
            2. Briefly explains why no good results were found
            3. Suggests 2-3 alternative search queries they could try
            4. Maintains an encouraging, helpful tone

            Keep response concise (2-3 sentences max).
            Focus on actionable suggestions.
        """
        ).strip()

        response = await model.ainvoke([("human", prompt)])
        message = response.content.strip()

        logger.info(
            "Generated no-results message",
            query=query,
            message_length=len(message),
        )

        return message

    except Exception as e:  # pylint: disable=broad-except
        logger.warning(
            "Failed to generate AI message, using fallback",
            query=query,
            error=str(e),
        )
        return FALLBACK_MESSAGE


async def stream_no_results_message(
    query: str, reason: str = "found no matching talent"
) -> AsyncGenerator[str, None]:
    """Streaming version of generate_no_results_message. Yields text chunks."""
    try:
        model = get_gemini_response_model()

        prompt = textwrap.dedent(
            f"""
            You are a helpful assistant for a talent networking platform.
            The user searched for: "{query}"
            Unfortunately, we {reason}.

            Generate a friendly, professional response in English that:
            1. Acknowledges what they searched for
            2. Briefly explains why no good results were found
            3. Suggests 2-3 alternative search queries they could try
            4. Maintains an encouraging, helpful tone

            Keep response concise (2-3 sentences max).
            Focus on actionable suggestions.
        """
        ).strip()

        async for chunk in model.astream([("human", prompt)]):
            if chunk.content:
                yield chunk.content

    except Exception as e:  # pylint: disable=broad-except
        logger.warning(
            "Failed to stream AI message, using fallback",
            query=query,
            error=str(e),
        )
        yield FALLBACK_MESSAGE
