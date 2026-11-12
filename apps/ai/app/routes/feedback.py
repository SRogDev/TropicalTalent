"""Feedback insights endpoint - generates AI insights from user feedback."""

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel
from supabase import create_client

from app.core import get_logger, get_settings
from app.dependencies.auth import get_current_user

logger = get_logger("feedback")
router = APIRouter(prefix="/generate-feedback-insights", tags=["feedback"])


class FeedbackInsight(BaseModel):
    """Feedback insight response model."""

    summary: str
    actions: List[str]


@router.get("", response_model=FeedbackInsight)
async def generate_feedback_insights(
    current_user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Generate AI insights from feedback of the last 24 hours.

    Authenticated: reads user feedback via the service-role key and sends
    it to Gemini, so it must never be anonymous. There is no admin role
    concept in the AI backend, so any authenticated user may call it.

    Returns:
        Dict with summary and suggested actions
    """
    try:
        settings = get_settings()
        supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)

        twenty_four_hours_ago = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

        response = (
            supabase.table("feedback_messages")
            .select("type, content, created_at")
            .gte("created_at", twenty_four_hours_ago)
            .order("created_at", desc=True)
            .execute()
        )

        feedbacks = response.data

        if not feedbacks or len(feedbacks) == 0:
            return {
                "summary": "No feedback received in the last 24 hours.",
                "actions": [
                    "Encourage users to provide feedback through the app",
                    "Monitor user engagement patterns for potential issues",
                ],
            }

        # Initialize Gemini model via LangChain
        model = ChatGoogleGenerativeAI(
            model="gemini-1.5-flash", google_api_key=settings.gemini_api_key, temperature=0.7
        )

        # Prepare feedback text for analysis
        feedback_text = "\n\n".join(
            [
                f"Type: {fb['type']}\nContent: {fb['content']}\nDate: {fb['created_at']}"
                for fb in feedbacks
            ]
        )

        prompt = f"""
You are an expert product analyst reviewing user feedback for a social networking app called TropicalTalent.

Analyze the following user feedback messages from the last 24 hours:

{feedback_text}

Please provide:

1. A concise summary (2-3 sentences) of the main themes and concerns users are expressing.
2. A list of at least 5 concrete, actionable recommendations to implement in the app based on what users are requesting.

Respond ONLY with a JSON object in this exact format:
{{
  "summary": "Your summary here",
  "actions": [
    "First action",
    "Second action",
    "Third action",
    "Fourth action",
    "Fifth action"
  ]
}}

Keep your response professional, actionable, and focused on improving the user experience.
"""

        response = model.invoke(prompt)
        response_text = (
            response.content.strip()
            if hasattr(response, "content")
            else str(response).strip()
        )

        # Strip markdown code blocks if present
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]

        insights = json.loads(response_text.strip())

        logger.info(f"Generated insights for {len(feedbacks)} feedback messages")

        return insights

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse AI response: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to parse AI insights",
        )
    except Exception as e:
        # Log the detail server-side; the client only gets a generic message
        # (the previous detail=str(e) leaked Supabase/Gemini internals).
        logger.error(f"Error generating feedback insights: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate feedback insights",
        )
