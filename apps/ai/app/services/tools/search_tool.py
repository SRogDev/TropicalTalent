"""Search talent tool for the TropicalTalent AI agent.

This tool wraps the existing search pipeline (intent extraction → enrichment →
Pinecone vector search → Gemini reranking) as a LangChain tool that the
AgentExecutor can invoke autonomously.

The agent decides WHEN to search based on the conversation — no keyword
heuristic needed. The tool handles the full search pipeline internally.
"""

from __future__ import annotations

from typing import List, Optional

from langchain_core.tools import tool
from pydantic import BaseModel, Field

from app.core.logging import get_logger
from app.models.search import SearchRequest
from app.services.search import search_users

logger = get_logger("tools.search_creatives")


class SearchCreativesInput(BaseModel):
    """Input schema for the search_creatives tool."""

    query: str = Field(
        description=(
            "A natural language search query describing the type of talent "
            "professional the user is looking for. Include role, skills, style, "
            "and location if mentioned. Examples: 'editorial fashion photographer "
            "in New York', 'minimalist graphic designer', 'jazz musician for live event'."
        )
    )


class SearchResult(BaseModel):
    """A single talent profile returned by search."""

    user_id: str
    username: Optional[str] = None
    avatar: Optional[str] = None
    passion: Optional[str] = None
    location: Optional[str] = None
    bio: Optional[str] = None
    tags: List[str] = []
    score: float = 0.0


class SearchCreativesOutput(BaseModel):
    """Output from the search_creatives tool."""

    results: List[SearchResult] = []
    total_results: int = 0
    results_quality: str = "poor"
    log_id: Optional[str] = None
    summary: str = ""  # Human-readable summary for the agent to use in response


def create_search_creatives_tool(user_id: str):
    """Factory that creates a search_creatives tool bound to a specific user.

    Args:
        user_id: The authenticated user's UUID, used to exclude self from results.

    Returns:
        A LangChain tool callable by the AgentExecutor.
    """

    @tool("search_creatives", args_schema=SearchCreativesInput)
    async def search_creatives(query: str) -> str:
        """Search for talent on TropicalTalent.

        Use this tool when the user wants to find, discover, or get recommendations
        for talent (photographers, designers, musicians, videographers,
        illustrators, producers, editors, writers, etc.).

        Also use when the user describes a project need, asks for talent, or says
        things like "I need someone who can...", "find me a...", "show me...".

        Do NOT use for general conversation, greetings, or off-topic questions.
        """
        try:
            logger.info("search_creatives tool invoked", query=query, user_id=user_id)

            request = SearchRequest(user_id=user_id, query=query)
            response = await search_users(request)

            if not response.results:
                return (
                    f"NO_RESULTS: I searched for '{query}' but found no matching "
                    "talent. The user should try broader search terms "
                    "or different keywords. Do not make up profiles."
                )

            # Enrich results with display names from Supabase (name field = full display name)
            name_map: dict = {}
            try:
                from app.core.database import get_supabase_client

                supabase = await get_supabase_client()
                user_ids = [r.user_id for r in response.results if r.user_id]
                if user_ids:
                    db_result = (
                        supabase._client.table("users")
                        .select("id, name")
                        .in_("id", user_ids)
                        .execute()
                    )
                    name_map = {u["id"]: u.get("name") for u in (db_result.data or [])}
            except Exception as enrich_err:
                logger.warning("Could not enrich search results with display names", error=str(enrich_err))

            # Build structured summary for the agent
            profiles_summary = []
            results_data = []
            for r in response.results:
                meta = r.metadata or {}
                display_name = name_map.get(r.user_id) or r.username or "Unknown"
                profile_line = (
                    f"- {r.username or 'unknown'} "
                    f"(user_id={r.user_id}, "
                    f"name={display_name}, "
                    f"passion={r.passion or 'N/A'}, "
                    f"location={meta.get('location') or 'N/A'}, "
                    f"score={r.score:.3f})"
                )
                if r.bio:
                    profile_line += f" — {r.bio[:100]}"
                profiles_summary.append(profile_line)

                results_data.append(SearchResult(
                    user_id=r.user_id,
                    username=r.username,
                    avatar=r.avatar,
                    passion=r.passion,
                    location=meta.get("location"),
                    bio=r.bio,
                    tags=r.tags or [],
                    score=r.score,
                ))

            summary = (
                f"SEARCH_RESULTS: Found {response.total_results} talent profile(s) "
                f"(quality={response.results_quality}):\n"
                + "\n".join(profiles_summary)
                + f"\n\nlog_id={response.log_id}"
            )

            logger.info(
                "search_creatives tool completed",
                results_count=response.total_results,
                quality=response.results_quality,
                log_id=response.log_id,
            )

            return summary

        except Exception as e:
            logger.error("search_creatives tool failed", error=str(e))
            return f"SEARCH_ERROR: Search failed due to a technical issue. Error: {str(e)}"

    return search_creatives
