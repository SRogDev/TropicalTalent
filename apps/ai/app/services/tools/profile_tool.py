"""Profile deep-dive tool for the TropicalTalent AI agent.

Fetches comprehensive profile data for a specific professional and generates
a recruiter-style analysis connecting the professional's strengths to what the
user is looking for.

Data sources: Pinecone metadata (image_tags, video_summary, backstory_tags,
bio, tags, passion, location) + Supabase (fresh avatar, reviews, portfolio).
"""

from __future__ import annotations

from typing import Optional

from langchain_core.tools import tool
from pydantic import BaseModel, Field

from app.core.database import get_supabase_client
from app.core.logging import get_logger
from app.core.pinecone_client import get_pinecone_index

logger = get_logger("tools.profile_deep_dive")


class ProfileDeepDiveInput(BaseModel):
    """Input schema for the profile_deep_dive tool."""

    username: str = Field(
        description=(
            "The username of the professional the user wants to learn "
            "more about. Extract from messages like 'tell me more about Alex', "
            "'what can you tell me about @maria', 'is Juan a good fit?'."
        )
    )


def create_profile_deep_dive_tool(user_id: str):
    """Factory that creates a profile_deep_dive tool bound to a specific user.

    Args:
        user_id: The authenticated user's UUID (used for context, not filtering).

    Returns:
        A LangChain tool callable by the AgentExecutor.
    """

    @tool("profile_deep_dive", args_schema=ProfileDeepDiveInput)
    async def profile_deep_dive(username: str) -> str:
        """Get detailed information about a specific professional.

        Use this tool when the user asks to learn more about a specific person,
        wants a deeper analysis of a professional's profile, or asks whether someone
        is a good fit for their project.

        Triggers on messages like:
        - "Tell me more about Alex"
        - "Can you analyze Maria's profile?"
        - "Is @juan good for my project?"
        - "What does Carlos specialize in?"
        - "Show me more details about that photographer"

        Do NOT use this for searching new people — use search_creatives instead.
        """
        try:
            logger.info(
                "profile_deep_dive tool invoked",
                username=username,
                requesting_user=user_id,
            )

            # ----- 1. Fetch from Pinecone (metadata has image_tags, video_summary, etc.) -----
            index = get_pinecone_index()
            pinecone_results = index.query(
                vector=[0.0] * 3072,  # Dummy vector — we only need metadata filter
                top_k=1,
                include_metadata=True,
                filter={"username": {"$eq": username}},
            )

            pinecone_meta = {}
            pinecone_user_id = None
            if pinecone_results.matches:
                match = pinecone_results.matches[0]
                pinecone_meta = match.metadata or {}
                pinecone_user_id = pinecone_meta.get("user_id")

            # ----- 2. Fetch fresh data from Supabase -----
            supabase_data = {}
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
                        "Supabase enrichment failed for deep dive",
                        username=username,
                        error=str(e),
                    )

            # ----- 3. Build comprehensive profile text for the agent -----
            if not pinecone_meta and not supabase_data:
                return (
                    f"PROFILE_NOT_FOUND: I could not find a professional "
                    f"with the username '{username}'. The user may have misspelled "
                    "the name. Suggest they try searching instead."
                )

            creative_data = supabase_data.get("creative_data") or {}

            sections = []
            sections.append(f"PROFILE_DETAILS for @{username}:")

            # Basic info
            passion = creative_data.get("passion") or pinecone_meta.get("passion", "")
            location = pinecone_meta.get("location", "")
            bio = pinecone_meta.get("bio", "")

            if passion:
                sections.append(f"Role/Passion: {passion}")
            if location:
                sections.append(f"Location: {location}")
            if bio:
                sections.append(f"Bio: {bio}")

            # Tags (skills)
            tags = pinecone_meta.get("tags", [])
            if tags:
                sections.append(f"Skills/Tags: {', '.join(tags)}")

            # Image analysis
            image_tags = pinecone_meta.get("image_tags", [])
            if image_tags:
                sections.append(
                    f"Visual Portfolio Analysis: Their profile imagery suggests "
                    f"expertise in {', '.join(image_tags)}"
                )

            # Video analysis
            video_summary = pinecone_meta.get("video_summary", "")
            if video_summary:
                sections.append(f"Video/Showreel Analysis: {video_summary}")

            # Backstory/CV
            backstory_tags = pinecone_meta.get("backstory_tags", [])
            if backstory_tags:
                sections.append(
                    f"Background & Experience (from CV/backstory): "
                    f"{', '.join(backstory_tags)}"
                )

            # Avatar
            avatar = supabase_data.get("avatar") or pinecone_meta.get("avatar", "")
            if avatar:
                sections.append(f"Avatar URL: {avatar}")

            # Metadata flags
            has_video = pinecone_meta.get("has_video", False)
            has_backstory = pinecone_meta.get("has_backstory", False)
            completeness = []
            if has_video:
                completeness.append("video showreel")
            if has_backstory:
                completeness.append("CV/backstory PDF")
            if image_tags:
                completeness.append("portfolio images")
            if completeness:
                sections.append(
                    f"Profile Completeness: Has {', '.join(completeness)}"
                )

            sections.append(
                "\nINSTRUCTION: Use the above data to give the user a warm, "
                "professional recruiter-style analysis. Connect this professional's "
                "strengths to what the user has been looking for in the conversation. "
                "Highlight strongest match points and note any gaps. "
                "Be specific — reference their actual skills, video content, and "
                "background. Never fabricate information not present above."
            )

            profile_text = "\n".join(sections)

            logger.info(
                "profile_deep_dive tool completed",
                username=username,
                sections_count=len(sections),
                has_video=has_video,
                has_backstory=has_backstory,
            )

            return profile_text

        except Exception as e:
            logger.error("profile_deep_dive tool failed", error=str(e))
            return (
                f"PROFILE_ERROR: Could not retrieve profile for '{username}'. "
                f"Error: {str(e)}"
            )

    return profile_deep_dive
