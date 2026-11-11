"""
YouTube video analysis service.

Strategy: fetch the auto-generated (or manual) transcript via
youtube-transcript-api (free, no API key, <1 s) then summarise
it with Gemini Flash.  This is far cheaper and more reliable than
asking Gemini to process the raw video.

Supported URL formats:
  https://youtube.com/watch?v=VIDEO_ID
  https://youtu.be/VIDEO_ID
  https://www.youtube.com/watch?v=VIDEO_ID&t=42s
  https://www.youtube.com/shorts/VIDEO_ID
"""

import re
from typing import Optional

from langchain_google_genai import ChatGoogleGenerativeAI

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("tropicaltalent.youtube_analyzer")

# Maximum characters of transcript to pass to Gemini (~4 min of speech).
# Keeps token usage low while capturing the substance of the video.
_MAX_TRANSCRIPT_CHARS = 3_000


def _extract_video_id(url: str) -> Optional[str]:
    """Extract the 11-character YouTube video ID from any common URL format."""
    patterns = [
        r"(?:v=|youtu\.be/|/shorts/|/embed/)([A-Za-z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def _get_summary_model() -> ChatGoogleGenerativeAI:
    """Singleton Gemini model for transcript summarisation."""
    model = getattr(_get_summary_model, "_model", None)
    if model is None:
        settings = get_settings()
        model = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=settings.gemini_api_key,
            temperature=0.3,
            max_output_tokens=400,
        )
        setattr(_get_summary_model, "_model", model)
        logger.info("Gemini summary model initialised for YouTube transcripts")
    return model


def _fetch_transcript(video_id: str) -> Optional[str]:
    """Fetch transcript text from YouTube using the public subtitles endpoint.

    Returns up to _MAX_TRANSCRIPT_CHARS of raw transcript text, or None if
    no transcript is available (private video, no subtitles, etc.).
    """
    try:
        from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound  # noqa: PLC0415

        # Prefer English; fall back to any available language
        try:
            transcript_list = YouTubeTranscriptApi.get_transcript(video_id, languages=["en"])
        except NoTranscriptFound:
            # Try auto-generated in any language
            transcripts = YouTubeTranscriptApi.list_transcripts(video_id)
            transcript_list = transcripts.find_generated_transcript(
                ["en", "en-US", "en-GB"]
            ).fetch()

        # Join all snippets into one string
        full_text = " ".join(entry["text"] for entry in transcript_list)
        # Truncate to keep Gemini costs minimal
        return full_text[:_MAX_TRANSCRIPT_CHARS]

    except (Exception,) as exc:  # noqa: BLE001
        logger.warning(
            "Could not fetch YouTube transcript",
            video_id=video_id,
            error=str(exc),
            error_type=type(exc).__name__,
        )
        return None


async def analyze_youtube_video(youtube_url: str) -> Optional[str]:
    """Analyse a YouTube video and return a concise talent-profile summary.

    Flow:
      1. Extract video ID from URL.
      2. Fetch transcript (free, no API key needed).
      3. If transcript available → ask Gemini to summarise it.
      4. If not available → return None gracefully (caller uses cached value).

    Args:
        youtube_url: Any common YouTube URL format.

    Returns:
        A 100-200 word summary string, or None if the video cannot be analysed.
    """
    video_id = _extract_video_id(youtube_url)
    if not video_id:
        logger.warning("Could not extract video ID from URL", url=youtube_url)
        return None

    transcript_text = _fetch_transcript(video_id)
    if not transcript_text:
        logger.info(
            "No transcript available for video — skipping analysis",
            video_id=video_id,
        )
        return None

    try:
        model = _get_summary_model()
        prompt = (
            "You are analysing a professional's video for a talent platform.\n\n"
            "Based on the transcript below, write a concise summary (100-200 words) covering:\n"
            "- Main topic / theme of the video\n"
            "- Skills, techniques, or disciplines demonstrated\n"
            "- Aesthetic or stylistic qualities evident in their work\n"
            "- Anything that signals professional level or niche expertise\n\n"
            "Focus on information useful for talent networking.\n"
            "Do NOT mention that you read a transcript — write as if describing the content directly.\n\n"
            f"Transcript:\n{transcript_text}\n\nSummary:"
        )

        response = await model.ainvoke(prompt)
        summary = response.content.strip() if response and response.content else None

        if summary:
            logger.info(
                "YouTube transcript summarised",
                video_id=video_id,
                transcript_chars=len(transcript_text),
                summary_chars=len(summary),
            )
        return summary

    except Exception as exc:  # pylint: disable=broad-except
        logger.error(
            "Gemini summarisation failed for YouTube transcript",
            video_id=video_id,
            error=str(exc),
        )
        return None
