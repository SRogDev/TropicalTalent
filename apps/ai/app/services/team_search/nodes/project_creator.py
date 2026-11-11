"""Project Creator node for the Team Search LangGraph graph.

Responsibilities:
- INSERT a new row into the `projects` table
- INSERT the initiating user as the brand/owner in `project_members`
- Store the returned project_id in state
- Transition status → 'inviting'

Only runs in 'create' mode. In 'update' mode the graph routes directly
from 'reviewing' → 'inviting', skipping this node entirely.
"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage

from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.team_search.state import TeamSearchState
from supabase import create_client

logger = get_logger("team_search.project_creator")


async def project_creator_node(state: TeamSearchState) -> dict[str, Any]:
    """LangGraph node: Project Creator.

    Creates the project record and adds the commissioning user as the
    'brand' member (i.e. owner).
    """
    user_id = state.get("user_id", "")
    project_name = state.get("project_name", "New Project")
    project_brief = state.get("project_brief", "")
    selected_team = state.get("selected_team", [])

    logger.info(
        "Project Creator invoked",
        user_id=user_id,
        project_name=project_name,
        team_size=len(selected_team),
    )

    settings = get_settings()
    supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)

    try:
        # ----- 1. Create the project -----
        project_result = (
            supabase.table("projects")
            .insert(
                {
                    "name": project_name,
                    "description": project_brief,
                    "created_by": user_id,
                    "status": "active",
                }
            )
            .execute()
        )

        if not project_result.data:
            raise ValueError("Project insert returned no data")

        project_id: str = project_result.data[0]["id"]

        # ----- 2. Add the initiating user as brand/owner -----
        supabase.table("project_members").insert(
            {
                "project_id": project_id,
                "user_id": user_id,
                "role": "brand",
                "status": "accepted",
            }
        ).execute()

        logger.info(
            "Project created",
            project_id=project_id,
            project_name=project_name,
        )

        return {
            "project_id": project_id,
            "status": "inviting",
            "messages": [
                AIMessage(
                    content=f"Project **{project_name}** created! Now sending invitations to the team..."
                )
            ],
        }

    except Exception as exc:
        logger.error(
            "Project creation failed",
            user_id=user_id,
            project_name=project_name,
            error=str(exc),
        )
        return {
            "status": "error",
            "error_message": f"Failed to create project: {exc}",
            "messages": [
                AIMessage(
                    content="There was a problem creating the project. Please try again."
                )
            ],
        }
