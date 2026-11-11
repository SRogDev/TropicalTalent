"""Text processing service for normalization and lemmatization using Gemini."""

from langchain_google_genai import ChatGoogleGenerativeAI

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("tropicaltalent.text_processor")


def get_lemmatization_model() -> ChatGoogleGenerativeAI:
    """
    Get singleton instance of Gemini model for text lemmatization.

    Uses Gemini 2.5 Flash for fast, accurate lemmatization.
    Singleton pattern ensures model is only initialized once.

    Returns:
        LangChain ChatGoogleGenerativeAI instance configured for lemmatization
    """
    model = getattr(get_lemmatization_model, "_model", None)
    if model is None:
        settings = get_settings()
        model = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=settings.gemini_api_key,
            temperature=0.1,  # Low temperature for consistent lemmatization
            max_output_tokens=500,
        )
        setattr(get_lemmatization_model, "_model", model)
        logger.info("Gemini 2.5 flash model initialized for lemmatization")

    return model


def normalize_text(text: str) -> str:
    """
    Normalize text by converting to lowercase and removing extra whitespace.

    This function performs basic text cleaning:
    - Converts all characters to lowercase
    - Strips leading/trailing whitespace
    - Replaces multiple consecutive spaces with single space

    Args:
        text: Input text to normalize

    Returns:
        Normalized text in lowercase with cleaned whitespace

    Example:
        >>> normalize_text("  Hello   WORLD  ")
        "hello world"
        >>> normalize_text("Python  Developer")
        "python developer"
    """
    if not text:
        return ""

    # Convert to lowercase and strip leading/trailing whitespace
    normalized = text.lower().strip()

    # Replace multiple spaces with single space
    normalized = " ".join(normalized.split())

    return normalized


async def lemmatize_texts_batch(texts: list[str]) -> list[str]:
    """
    Lemmatize multiple texts in a single Gemini API call for efficiency.

    This function processes all texts together to minimize API calls.
    Much more efficient than calling lemmatize_text() multiple times.

    Args:
        texts: List of texts to lemmatize

    Returns:
        List of lemmatized texts in the same order

    Example:
        >>> await lemmatize_texts_batch(["cats running", "dogs playing"])
        ["cat run", "dog play"]
    """
    if not texts:
        return []

    # Filter out empty texts but keep track of indices
    non_empty_texts = []
    non_empty_indices = []
    for i, text in enumerate(texts):
        if text and text.strip():
            non_empty_texts.append(text)
            non_empty_indices.append(i)

    if not non_empty_texts:
        return ["" for _ in texts]

    try:
        model = get_lemmatization_model()

        # Create batch prompt with clear delimiters
        numbered_texts = "\n".join(
            [f"{i+1}. {text}" for i, text in enumerate(non_empty_texts)]
        )

        prompt = f"""Lemmatize each text below by converting words to their base dictionary form (lemma).

Rules:
- Convert verbs to infinitive (running → run, was → be)
- Convert nouns to singular (cats → cat, children → child)
- Convert adjectives to base (better → good, fastest → fast)
- Maintain word order and spacing
- Return ONLY the lemmatized versions, one per line
- Use the same numbering (1., 2., etc.)

Texts to lemmatize:
{numbered_texts}

Lemmatized texts:"""

        response = await model.ainvoke(prompt)
        result = response.content.strip()

        # Parse numbered results
        lines = result.split("\n")
        lemmatized = []

        for line in lines:
            # Remove numbering (e.g., "1. ", "2. ")
            cleaned = line.strip()
            if cleaned and ". " in cleaned:
                # Split on first ". " to handle cases like "1. text with. periods"
                cleaned = cleaned.split(". ", 1)[1] if ". " in cleaned else cleaned
            if cleaned:
                lemmatized.append(cleaned.lower().strip())

        # Validate we got expected number of results
        if len(lemmatized) != len(non_empty_texts):
            logger.warning(
                f"Lemmatization count mismatch: expected {len(non_empty_texts)}, got {len(lemmatized)}"
            )
            # Fallback to normalization if parsing failed
            return [normalize_text(text) for text in texts]

        # Reconstruct full list with empty strings in original positions
        result_list = ["" for _ in texts]
        for idx, lemma in zip(non_empty_indices, lemmatized):
            result_list[idx] = lemma

        logger.debug(f"Batch lemmatized {len(non_empty_texts)} texts in 1 API call")
        return result_list

    except Exception as e:
        logger.error(f"Batch lemmatization failed: {e}, falling back to normalization")
        return [normalize_text(text) for text in texts]


async def lemmatize_text(text: str) -> str:
    """
    Lemmatize a single text using Gemini AI.

    This is a convenience wrapper around lemmatize_texts_batch().
    For multiple texts, use lemmatize_texts_batch() directly to save API calls.

    Args:
        text: Input text to lemmatize

    Returns:
        Lemmatized text with words in their base form

    Example:
        >>> await lemmatize_text("cats were playing")
        "cat be play"
    """
    if not text:
        return ""

    results = await lemmatize_texts_batch([text])
    return results[0] if results else ""
