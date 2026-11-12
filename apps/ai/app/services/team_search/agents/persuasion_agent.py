"""Persuasion Agent node for the Team Search LangGraph graph.

DISABLED in Phase 4 (2026-11-12) — kept in the tree as history, not
wired into the graph (see `graph.py: crm_handoff_node`).

It used to write personalised invitation text per team member, ensure
a connection in the legacy `connections` table, and INSERT a
`project_request` row in the legacy `messages` table. Those tables are
created by no web migration, and creating them would resurrect a
second project/connection model that nothing in the web reads. The
Cubora commercial operation is the negotiation, owned by the Phase 4
CRM (migration 056); an approved team ends at the `crm_handoff` node
instead, and operations coordinates invitations through Cubora.
"""

from __future__ import annotations

import asyncio
from typing import Any

from langchain_core.messages import AIMessage, SystemMessage

from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.query_enricher import get_gemini_chat_model
from app.services.team_search.state import TeamMember, TeamSearchState
from supabase import create_client

logger = get_logger("team_search.persuasion_agent")

_INVITE_SYSTEM_PROMPT = """You are a talent liaison for TropicalTalent, a premium talent platform.
Write a concise, warm, and professional project invitation message (2-4 sentences) for
a professional. The message will appear inside the TropicalTalent app as a direct invitation.

Project: {project_name}
Project brief: {project_brief}
Invitee role: {role}
Invitee username: @{username}

Write the message in second person ("We'd love to have you..."). Mention the role.
Keep it enthusiastic but not over-the-top. Do NOT include greetings like "Dear" — jump
straight into the invitation. Output ONLY the message text, nothing else.
"""


async def _write_invitation_text(
    llm: Any,
    project_name: str,
    project_brief: str,
    role: str,
    username: str,
) -> str:
    """Generate personalised invitation copy using Gemini."""
    prompt = _INVITE_SYSTEM_PROMPT.format(
        project_name=project_name,
        project_brief=project_brief,
        role=role,
        username=username,
    )
    response = await llm.ainvoke([SystemMessage(content=prompt)])
    return response.content.strip()


def _ensure_connection(
    supabase: Any,
    user_id: str,
    invitee_id: str,
) -> None:
    """Create a connection between user_id and invitee_id if one does not exist.

    Uses an upsert-style approach: checks first, inserts if absent.
    The connection is created with status='pending' if new.
    """
    # Check in both directions
    existing = (
        supabase.table("connections")
        .select("id")
        .or_(
            f"and(requester_id.eq.{user_id},receiver_id.eq.{invitee_id}),"
            f"and(requester_id.eq.{invitee_id},receiver_id.eq.{user_id})"
        )
        .limit(1)
        .execute()
    )
    if existing.data:
        return  # Connection already exists

    supabase.table("connections").insert(
        {
            "requester_id": user_id,
            "receiver_id": invitee_id,
            "status": "pending",
        }
    ).execute()


async def _invite_member(
    supabase: Any,
    llm: Any,
    brand_user_id: str,
    member: TeamMember,
    project_id: str,
    project_name: str,
    project_brief: str,
) -> str | None:
    """Send a single project invitation. Returns username on success, None on failure."""
    username = member.get("username", "")
    invitee_id = member.get("user_id", "")
    role = member.get("role", "creative")

    if not invitee_id or not username:
        logger.warning("Skipping invitation — missing user_id or username", member=dict(member))
        return None

    try:
        # Generate personalised invitation text
        invite_text = await _write_invitation_text(
            llm, project_name, project_brief, role, username
        )

        # Ensure connection exists (sync Supabase client)
        _ensure_connection(supabase, brand_user_id, invitee_id)

        # Insert project_request message
        supabase.table("messages").insert(
            {
                "sender_id": brand_user_id,
                "receiver_id": invitee_id,
                "type": "project_request",
                "content": {
                    "text": invite_text,
                    "project_id": project_id,
                    "project_name": project_name,
                    "role": role,
                },
            }
        ).execute()

        logger.info("Invitation sent", username=username, role=role, project_id=project_id)
        return username

    except Exception as exc:
        logger.error(
            "Failed to send invitation",
            username=username,
            role=role,
            error=str(exc),
        )
        return None


async def persuasion_agent_node(state: TeamSearchState) -> dict[str, Any]:
    """LangGraph node: Persuasion Agent.

    Writes and sends personalised project invitations to all selected team members.
    """
    brand_user_id = state.get("user_id", "")
    selected_team = state.get("selected_team", [])
    project_id = state.get("project_id") or state.get("_project_id_for_update", "")
    project_name = state.get("project_name", "New Project")
    project_brief = state.get("project_brief", "")

    logger.info(
        "Persuasion Agent invoked",
        brand_user_id=brand_user_id,
        team_size=len(selected_team),
        project_id=project_id,
    )

    if not project_id:
        return {
            "status": "error",
            "error_message": "No project_id available — cannot send invitations.",
        }

    settings = get_settings()
    supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)
    llm = get_gemini_chat_model()

    # Send all invitations concurrently
    tasks = [
        _invite_member(
            supabase, llm, brand_user_id, member, project_id, project_name, project_brief
        )
        for member in selected_team
    ]
    results = await asyncio.gather(*tasks)

    invitations_sent = [username for username in results if username is not None]
    failed_count = len(selected_team) - len(invitations_sent)

    # Build completion summary
    if invitations_sent:
        names_str = ", ".join(f"@{u}" for u in invitations_sent)
        message = (
            f"Done! Invitations sent to {names_str} for **{project_name}**. "
            "They'll receive a project request in their TropicalTalent messages."
        )
        if failed_count:
            message += f" ({failed_count} invitation(s) could not be sent due to an error.)"
    else:
        message = (
            "There was a problem sending the invitations. "
            "Please try again or contact support."
        )

    return {
        "messages": [AIMessage(content=message)],
        "invitations_sent": invitations_sent,
        "status": "complete",
    }
