"""
Image analysis service using Gemini Vision via LangChain.

Gemini is multimodal and supports image analysis through LangChain.
"""

import base64
from typing import List, Optional

from fastapi import UploadFile
from langchain_core.messages import HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("tropicaltalent.image_analyzer")


def get_vision_model() -> ChatGoogleGenerativeAI:
    """
    Get singleton instance of Gemini Vision model via LangChain.

    Gemini is multimodal and can analyze images through LangChain.
    Uses Gemini 2.5 Flash for fast image analysis.

    Returns:
        LangChain ChatGoogleGenerativeAI instance configured for vision
    """
    model = getattr(get_vision_model, "_model", None)
    if model is None:
        settings = get_settings()
        model = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=settings.gemini_api_key,
            temperature=0.3,
            max_output_tokens=1000,
        )
        setattr(get_vision_model, "_model", model)
        logger.info("Gemini 2.5 flash vision model initialized via LangChain")

    return model


async def analyze_image(image_file: UploadFile) -> Optional[List[str]]:
    """
    Analyze an image using Gemini Vision to extract tags.

    Identifies visual elements, themes, styles, and concepts in the image.

    Args:
        image_file: The uploaded image file to analyze

    Returns:
        A list of relevant tags extracted from the image, or None if analysis fails
    """
    try:
        # Get configured model (singleton)
        model = get_vision_model()

        # Read image content
        image_bytes = await image_file.read()

        # Encode image to base64 for LangChain
        image_base64 = base64.b64encode(image_bytes).decode("utf-8")
        mime_type = image_file.content_type or "image/jpeg"

        # Prompt for image analysis
        text_prompt = """Analyze this image and extract relevant tags that describe:

1. Visual style and aesthetics
2. Main subjects or objects
3. Colors and mood
4. Artistic techniques or medium
5. Professional field or industry
6. Skills demonstrated
7. Creative elements

Provide 5-10 concise tags (single words or short phrases) separated by commas.
Focus on tags relevant for talent networking and discovery.

Tags:"""

        # LangChain multimodal message format
        message = HumanMessage(
            content=[
                {"type": "text", "text": text_prompt},
                {
                    "type": "image_url",
                    "image_url": f"data:{mime_type};base64,{image_base64}",
                },
            ]
        )

        # Use LangChain's ainvoke for async multimodal generation
        response = await model.ainvoke([message])

        if response and response.content:
            # Parse tags from response
            tags_text = response.content.strip()
            tags = [tag.strip() for tag in tags_text.split(",") if tag.strip()]

            logger.info("Successfully extracted tags from image", tags_count=len(tags))
            return tags[:10]  # Limit to 10 tags

        logger.warning("Empty response from Gemini for image analysis")
        return None

    except Exception as e:  # pylint: disable=broad-except
        logger.error(
            "Failed to analyze image", error=str(e), error_type=type(e).__name__
        )
        return None
    finally:
        # Reset file pointer for potential reuse
        await image_file.seek(0)
