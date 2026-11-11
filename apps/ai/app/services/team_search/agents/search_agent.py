"""Search Agent node for the Team Search LangGraph graph.

Responsibilities:
- Run one Pinecone vector search per role in role_requirements (in parallel)
- Pick the top candidate per role
- Populate selected_team and search_results
- Transition status → 'reviewing' (triggers interrupt so user can approve/reject)
"""

from __future__ import annotations

import asyncio
from typing import Any

from langchain_core.messages import AIMessage

from app.core.logging import get_logger
from app.models.search import SearchRequest
from app.services.search import search_users
from app.services.team_search.state import TeamMember, TeamSearchState

logger = get_logger("team_search.search_agent")


def _build_query(role_req: dict, project_brief: str) -> str:
    """Build a natural language search query for a single role requirement."""
    role = role_req.get("role", "creative")
    notes = role_req.get("notes", "")
    base = f"{role}"
    if notes:
        base += f" — {notes}"
    if project_brief:
        base += f". Project context: {project_brief}"
    return base


async def _search_for_role(
    user_id: str,
    role_req: dict,
    project_brief: str,
) -> tuple[str, list[dict]]:
    """Search for candidates for a single role. Returns (role, candidates list)."""
    role = role_req.get("role", "unknown")
    query = _build_query(role_req, project_brief)

    try:
        request = SearchRequest(user_id=user_id, query=query)
        response = await search_users(request)

        candidates = []
        for r in response.results[:5]:  # Keep top 5 candidates per role for review
            meta = r.metadata or {}
            candidates.append(
                {
                    "user_id": r.user_id,
                    "username": r.username or "",
                    "passion": r.passion or "",
                    "location": meta.get("location", ""),
                    "bio": r.bio or "",
                    "tags": r.tags or [],
                    "score": round(r.score, 4),
                    "role": role,
                    "avatar": r.avatar or "",
                    "invitation_sent": False,
                }
            )
        return role, candidates

    except Exception as exc:
        logger.error("Search failed for role", role=role, error=str(exc))
        return role, []


async def search_agent_node(state: TeamSearchState) -> dict[str, Any]:
    """LangGraph node: Search Agent.

    Runs parallel Pinecone searches for each required role, then selects
    the top candidate per role and transitions to 'reviewing'.
    """
    user_id = state.get("user_id", "")
    role_requirements = state.get("role_requirements", [])
    project_brief = state.get("project_brief", "")

    logger.info(
        "Search Agent invoked",
        user_id=user_id,
        roles=[r.get("role") for r in role_requirements],
    )

    if not role_requirements:
        return {
            "status": "error",
            "error_message": "No role requirements found — cannot search.",
        }

    # Run all role searches concurrently
    tasks = [
        _search_for_role(user_id, req, project_brief)
        for req in role_requirements
    ]
    results = await asyncio.gather(*tasks)

    search_results: dict[str, list[dict]] = {}
    selected_team: list[TeamMember] = []

    for role, candidates in results:
        search_results[role] = candidates
        if candidates:
            # Top candidate is the automatic recommendation
            top = candidates[0]
            selected_team.append(TeamMember(**top))  # type: ignore[arg-type]
        else:
            logger.warning("No candidates found for role", role=role)

    # Build a human-readable summary of proposed team for the reviewing interrupt
    team_lines = []
    for member in selected_team:
        role = member.get("role", "")
        username = member.get("username", "Unknown")
        passion = member.get("passion", "")
        location = member.get("location", "")
        score = member.get("score", 0)
        team_lines.append(
            f"- **{role}**: @{username} ({passion}"
            + (f", {location}" if location else "")
            + f") — match score {score}"
        )

    if selected_team:
        summary = (
            "I've found your proposed team:\n\n"
            + "\n".join(team_lines)
            + "\n\nWould you like to proceed with this team, swap anyone out, or "
            "make changes?"
        )
    else:
        summary = (
            "I searched for all required roles but couldn't find strong matches. "
            "Would you like to adjust the requirements and try again?"
        )

    logger.info(
        "Search Agent complete",
        role_count=len(role_requirements),
        matched_count=len(selected_team),
    )

    return {
        "messages": [AIMessage(content=summary)],
        "search_results": search_results,
        "selected_team": selected_team,
        "status": "reviewing",
    }
