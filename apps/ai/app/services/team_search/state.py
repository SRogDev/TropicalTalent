"""LangGraph state for the Team Search multiagent system.

The graph uses this single TypedDict as its shared mutable state.
Each node reads from and writes to this state dict.

Flow:
  clarifying → searching → reviewing (interrupt) → crm_handoff → complete

Phase 4 (2026-11-12): approval after reviewing no longer creates a
project or sends invitations. The `project_creator` and
`persuasion_agent` nodes are disabled (they wrote to legacy `projects` /
`project_members` / `connections` / `messages` tables no migration
creates); the graph ends at `crm_handoff` and Cubora operations opens
the negotiation. The `creating` / `inviting` statuses below are kept
as literals for history but are no longer emitted.
"""

from __future__ import annotations

from typing import Annotated, Literal, Optional

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict


class RoleRequirement(TypedDict, total=False):
    """A single role requirement extracted by the Business Agent."""

    role: str           # e.g. "photographer", "graphic designer"
    count: int          # how many of this role needed (default 1)
    notes: str          # any extra detail: region, style, experience level


class TeamMember(TypedDict, total=False):
    """A person selected to fill a role on the team."""

    user_id: str
    username: str
    passion: str
    location: str
    bio: str
    tags: list[str]
    score: float
    role: str           # The role this person was selected for
    invitation_sent: bool


class TeamSearchState(TypedDict):
    """Shared state for the LangGraph Team Search graph.

    Attributes:
        messages:            Full conversation history (LangGraph managed via add_messages).
        user_id:             UUID of the authenticated user initiating the team build.
        mode:                'create' for new project, 'update' to add members to existing.
        project_brief:       Accumulated description of the project (built during clarification).
        clarification_count: Number of clarifying questions asked so far (max 4).
        role_requirements:   List of roles extracted by the Business Agent.
        search_results:      Mapping role → list of candidate profiles from Search Agent.
        selected_team:       Final list of one chosen candidate per role.
        project_id:          UUID of the created/updated project (set after project_creator runs).
        project_name:        Human-readable project name (set by Business Agent or user).
        invitations_sent:    Usernames who have been sent a project_request message.
        status:              Current stage of the pipeline.
    """

    messages: Annotated[list[BaseMessage], add_messages]
    user_id: str
    mode: Literal["create", "update"]

    # Business Agent output
    project_brief: str
    clarification_count: int
    role_requirements: list[RoleRequirement]
    project_name: str

    # Search Agent output
    search_results: dict[str, list[dict]]    # role → candidates
    selected_team: list[TeamMember]

    # Project Creator output
    project_id: Optional[str]

    # Tracking
    invitations_sent: list[str]

    # Pipeline stage — drives conditional routing
    status: Literal[
        "clarifying",   # Business Agent asking/clarifying
        "searching",    # Search Agent running per-role queries
        "reviewing",    # Interrupt: user reviews proposed team
        "analyzing",    # People Analyst fetching deep-dive / compare (returns to reviewing)
        "creating",     # Project Creator inserting project row
        "inviting",     # Persuasion Agent sending project_request messages
        "complete",     # Done
        "error",        # Unrecoverable error
    ]

    # Optional error detail for the 'error' status
    error_message: Optional[str]
