"""Search insights endpoint - generates AI insights from search logs using Gemini."""

import json
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel
from supabase import create_client

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("routes.search_insights")
settings = get_settings()
router = APIRouter(prefix="/generate-search-insights", tags=["search"])
supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)


class CreativeTypeInsight(BaseModel):
    creative_type: str
    search_count: int
    demand_level: str
    supply_level: str


class SearchInsightsResponse(BaseModel):
    high_demand_low_supply: List[CreativeTypeInsight]
    high_demand_high_supply: List[CreativeTypeInsight]
    summary: str


def _format_searches(searches: List[Dict[str, Any]]) -> str:
    if not searches:
        return "No searches in this category."
    formatted = []
    for i, search in enumerate(searches[:50], 1):
        content = search.get("content", "")
        results_count = len(search.get("results", [])) if search.get("results") else 0
        formatted.append(f"{i}. Query: '{content}' (Results found: {results_count})")
    return "\n".join(formatted)


@router.get("", response_model=SearchInsightsResponse)
async def generate_search_insights() -> Dict[str, Any]:
    """Generate AI insights from search logs.

    First tries rated searches. If none exist (all behavioral_rating = NULL),
    falls back to all searches using results count as supply proxy.
    """
    try:
        # Try rated searches first
        good_searches_resp = (
            supabase.table("search_logs")
            .select("content, results, behavioral_rating, created_at")
            .in_("behavioral_rating", [1, 2])
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )

        bad_searches_resp = (
            supabase.table("search_logs")
            .select("content, results, behavioral_rating, created_at")
            .eq("behavioral_rating", 0)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )

        good_searches = good_searches_resp.data or []
        bad_searches = bad_searches_resp.data or []

        # Fallback: no rated searches — use all searches, derive supply from results count
        using_fallback = False
        if not good_searches and not bad_searches:
            logger.info("No rated searches found, falling back to all searches")
            all_resp = (
                supabase.table("search_logs")
                .select("content, results, created_at")
                .order("created_at", desc=True)
                .limit(100)
                .execute()
            )
            all_searches = all_resp.data or []

            if not all_searches:
                logger.info("No searches found at all, returning empty insights")
                return SearchInsightsResponse(
                    high_demand_low_supply=[],
                    high_demand_high_supply=[],
                    summary="No search data available yet.",
                )

            # Split by results count: 0 results = low supply, >0 = has supply
            bad_searches = [s for s in all_searches if not s.get("results") or len(s.get("results", [])) == 0]
            good_searches = [s for s in all_searches if s.get("results") and len(s.get("results", [])) > 0]
            using_fallback = True
            logger.info(
                "Fallback split",
                searches_with_results=len(good_searches),
                searches_without_results=len(bad_searches),
            )

        good_formatted = _format_searches(good_searches)
        bad_formatted = _format_searches(bad_searches)

        model = ChatGoogleGenerativeAI(
            model="gemini-1.5-flash", google_api_key=settings.gemini_api_key, temperature=0.7
        )

        supply_context = (
            "- Searches with results = platform has supply for this type\n"
            "- Searches without results = platform lacks supply for this type"
            if using_fallback
            else
            "- Good searches = users found matches and connected/messaged\n"
            "- Bad searches = users didn't find what they wanted"
        )

        prompt = f"""You are an expert data analyst for TropicalTalent, a talent networking platform.

Analyze search data to identify talent type demand patterns:

SEARCHES WITH RESULTS / GOOD OUTCOMES:
{good_formatted}

SEARCHES WITHOUT RESULTS / BAD OUTCOMES:
{bad_formatted}

CONTEXT:
{supply_context}
- Creative types: musicians, producers, DJs, photographers, videographers, sound engineers, artists, dancers, etc.

IDENTIFY:
1. HIGH DEMAND, LOW SUPPLY: Creative types frequently searched but with no/few results
2. HIGH DEMAND, HIGH SUPPLY: Creative types frequently searched and with good results

Return ONLY valid JSON in this EXACT format (no markdown, no code blocks):
{{
  "high_demand_low_supply": [
    {{
      "creative_type": "Jazz Saxophonist",
      "search_count": 12,
      "demand_level": "high",
      "supply_level": "low"
    }}
  ],
  "high_demand_high_supply": [
    {{
      "creative_type": "Music Producer",
      "search_count": 24,
      "demand_level": "high",
      "supply_level": "high"
    }}
  ],
  "summary": "Brief 1-2 sentence summary of key findings"
}}

List 3-5 items per category maximum. Return empty arrays if no clear patterns found.
"""

        logger.info(
            "Generating search insights",
            good_count=len(good_searches),
            bad_count=len(bad_searches),
            using_fallback=using_fallback,
        )

        response = model.invoke(prompt)
        response_text = (
            response.content.strip()
            if hasattr(response, "content")
            else str(response).strip()
        )

        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]

        response_text = response_text.strip()

        try:
            insights_data = json.loads(response_text)
        except json.JSONDecodeError as e:
            logger.error("Failed to parse Gemini response as JSON", error=str(e), response=response_text)
            return SearchInsightsResponse(
                high_demand_low_supply=[],
                high_demand_high_supply=[],
                summary="Failed to generate insights. Please try again later.",
            )

        insights = SearchInsightsResponse(**insights_data)

        logger.info(
            "Generated search insights",
            low_supply_count=len(insights.high_demand_low_supply),
            high_supply_count=len(insights.high_demand_high_supply),
        )

        return insights

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to generate search insights", error=str(e))
        return SearchInsightsResponse(
            high_demand_low_supply=[],
            high_demand_high_supply=[],
            summary="An error occurred while generating insights. Please try again later.",
        )
