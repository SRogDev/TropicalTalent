"""Compare profiles tool for the TropicalTalent AI agent.

Fetches two talent profiles concurrently from Pinecone + Supabase and
returns structured comparison data so the agent can produce a side-by-side
analysis tailored to what the user is looking for.

The tool intentionally returns raw data rather than a formatted narrative
so the agent retains full authorial control over the comparison copy.
"""

from __future__ import annotations

import asyncio

from langchain_core.tools import tool
from pydantic import BaseModel, Field

from app.core.database import get_supabase_client
from app.core.logging import get_logger
from app.core.pinecone_client import get_pinecone_index

logger = get_logger("tools.compare_profiles")


class CompareProfilesInput(BaseModel):
    """Input schema for the compare_profiles tool."""

    username_a: str = Field(
        description=(
            "Username of the first professional to compare. Extract from messages like "
            "'compare Alex and Maria', 'who's better — @sam or @jose?'."
        )
    )
    username_b: str = Field(
        description="Username of the second professional to compare."
    )


async def _fetch_profile(username: str) -> dict:
    """Fetch a single professional's data from Pinecone and Supabase.

    Returns a dict with all available profile fields, or an empty dict
    augmented with an 'error' key if the profile was not found.
    """
    index = get_pinecone_index()

    # Query Pinecone by username metadata filter (dummy vector, metadata only)
    pinecone_results = index.query(
        vector=[0.0] * 3072,
        top_k=1,
        include_metadata=True,
        filter={"username": {"$eq": username}},
    )

    if not pinecone_results.matches:
        return {"username": username, "not_found": True}

    match = pinecone_results.matches[0]
    meta = match.metadata or {}
    pinecone_user_id = meta.get("user_id")

    supabase_data: dict = {}
    if pinecone_user_id:
        try:
            supabase = await get_supabase_client()
            db_result = (
                supabase._client.table("users")
                .select("id, username, avatar, creative_data(passion)")
                .eq("id", pinecone_user_id)
                .single()
                .execute()
            )
            if db_result.data:
                supabase_data = db_result.data
        except Exception as e:
            logger.warning(
                "Supabase enrichment failed in compare_profiles",
                username=username,
                error=str(e),
            )

    creative_data = supabase_data.get("creative_data") or {}

    return {
        "username": username,
        "not_found": False,
        "passion": creative_data.get("passion") or meta.get("passion", ""),
        "location": meta.get("location", ""),
        "bio": meta.get("bio", ""),
        "tags": meta.get("tags", []),
        "image_tags": meta.get("image_tags", []),
        "video_summary": meta.get("video_summary", ""),
        "backstory_tags": meta.get("backstory_tags", []),
        "avatar": supabase_data.get("avatar") or meta.get("avatar", ""),
        "user_id": pinecone_user_id or "",
    }


def _format_profile_block(label: str, p: dict) -> list[str]:
    """Return a list of formatted lines describing one profile."""
    if p.get("not_found"):
        return [f"{label} (@{p['username']}): NOT FOUND"]

    lines = [f"{label} — @{p['username']}:"]
    if p.get("passion"):
        lines.append(f"  Role: {p['passion']}")
    if p.get("location"):
        lines.append(f"  Location: {p['location']}")
    if p.get("bio"):
        lines.append(f"  Bio: {p['bio']}")
    if p.get("tags"):
        lines.append(f"  Skills: {', '.join(p['tags'])}")
    if p.get("image_tags"):
        lines.append(f"  Visual style: {', '.join(p['image_tags'])}")
    if p.get("video_summary"):
        lines.append(f"  Video/showreel: {p['video_summary']}")
    if p.get("backstory_tags"):
        lines.append(f"  Background: {', '.join(p['backstory_tags'])}")
    return lines


def create_compare_profiles_tool(user_id: str):
    """Factory that creates a compare_profiles tool bound to a specific user.

    Args:
        user_id: The requesting user's UUID (kept in closure for future use,
                 e.g. privacy / blocking checks).

    Returns:
        A LangChain tool callable by the AgentExecutor.
    """

    @tool("compare_profiles", args_schema=CompareProfilesInput)
    async def compare_profiles(username_a: str, username_b: str) -> str:
        """Compare two professionals side by side.

        Use this tool when the user wants to compare two people, asks
        "who is better", "what's the difference between X and Y", or says
        "can you compare these two?".

        Fetches both profiles concurrently from Pinecone and Supabase, then
        returns structured comparison data. Build the narrative comparison
        from this data — do NOT call profile_deep_dive separately.

        Triggers on messages like:
        - "Compare Alex and Maria"
        - "Who should I pick — @sam or @jose?"
        - "What's the difference between those two?"
        - "Which one is better for editorial work?"
        """
        try:
            logger.info(
                "compare_profiles tool invoked",
                username_a=username_a,
                username_b=username_b,
                requesting_user=user_id,
            )

            # Fetch both profiles concurrently
            profile_a, profile_b = await asyncio.gather(
                _fetch_profile(username_a),
                _fetch_profile(username_b),
            )

            # Handle missing profiles
            missing = [p["username"] for p in (profile_a, profile_b) if p.get("not_found")]
            if len(missing) == 2:
                return (
                    f"COMPARISON_ERROR: Neither @{username_a} nor @{username_b} "
                    "could be found. Suggest the user checks the usernames or "
                    "searches for them first."
                )
            if len(missing) == 1:
                found = profile_b if profile_a.get("not_found") else profile_a
                return (
                    f"COMPARISON_PARTIAL: @{missing[0]} was not found. "
                    f"Here is the profile for @{found['username']} only:\n"
                    + "\n".join(_format_profile_block("Profile", found))
                    + "\n\nINSTRUCTIONS FOR AGENT: Tell the user that @"
                    + missing[0]
                    + " could not be found and offer a deep dive on the one that was."
                )

            # Both found — build comparison block
            lines_a = _format_profile_block("Creative A", profile_a)
            lines_b = _format_profile_block("Creative B", profile_b)

            output_lines = [
                "COMPARISON_DATA:",
                "",
                *lines_a,
                "",
                *lines_b,
                "",
                "INSTRUCTIONS FOR AGENT:",
                "1. Summarise the key similarities and differences in a concise, "
                "   conversational paragraph (3-5 sentences).",
                "2. If the user has stated a project need or preference in the "
                "   conversation, highlight which professional is the stronger match "
                "   and why.",
                "3. Offer to dive deeper into either profile if the user wants more.",
                "4. Keep the tone warm and consultative — this is a recommendation, "
                "   not a verdict.",
                "5. Do NOT invent information beyond the data provided above.",
            ]

            return "\n".join(output_lines)

        except Exception as e:
            logger.error(
                "compare_profiles tool error",
                username_a=username_a,
                username_b=username_b,
                error=str(e),
            )
            return (
                f"COMPARISON_ERROR: An unexpected error occurred while comparing "
                f"@{username_a} and @{username_b}. Tell the user there was a "
                "technical issue and suggest trying again. "
                f"(Error: {type(e).__name__})"
            )

    return compare_profiles
