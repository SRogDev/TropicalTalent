"""Business Agent node for the Team Search LangGraph graph.

Responsibilities:
- Ask up to 4 clarifying questions to understand the project (timeline, budget,
  region, content type, etc.)
- Extract structured role requirements from the user's description
- Set project_name and update project_brief
- Transition status → 'searching' when it has enough information
"""

from __future__ import annotations

import json
import re
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.core.logging import get_logger
from app.services.query_enricher import get_gemini_chat_model
from app.services.team_search.state import RoleRequirement, TeamSearchState

logger = get_logger("team_search.business_agent")

MAX_CLARIFICATIONS = 4

_BUSINESS_SYSTEM_PROMPT = """You are the Business Intelligence Agent for TropicalTalent, a platform that connects
brands and commissioners with talent. Your job is to understand a client's project well
enough to brief the Search Agent on exactly which talent roles are needed.

CONVERSATION RULES:
- Ask at most {max_clarifications} clarifying questions across the entire conversation.
  You have already asked {clarification_count} so far.
- Ask only ONE question per turn.
- Focus questions on the most impactful unknowns: project type, content medium,
  location/region (UK focus), timeline, number of people needed, and any style/aesthetic preferences.
- Once you have enough information to define clear role requirements, output a JSON block and signal
  that you are ready to search.

OUTPUT FORMAT (when ready to search):
When you have enough information, end your response with a JSON block wrapped in <team_search_ready>:

<team_search_ready>
{{
  "project_name": "Short descriptive name for the project",
  "project_brief": "2-3 sentence summary of the project",
  "role_requirements": [
    {{"role": "photographer", "count": 1, "notes": "portrait/lifestyle, London preferred"}},
    {{"role": "videographer", "count": 1, "notes": "reel content, any UK city"}}
  ]
}}
</team_search_ready>

If you still need more information (and have not yet reached the question limit), just ask your
next question naturally — NO JSON block.

If you have already reached the question limit, extract the best role requirements you can from
the conversation so far and output the JSON block.

IMPORTANT: Keep a warm, consultative tone. This is a premium talent platform.
"""


async def business_agent_node(state: TeamSearchState) -> dict[str, Any]:
    """LangGraph node: Business Agent.

    Reads conversation messages, asks clarifying questions, and when ready
    extracts structured role requirements and transitions to 'searching'.
    """
    user_id = state.get("user_id", "")
    clarification_count = state.get("clarification_count", 0)
    messages = state.get("messages", [])
    mode = state.get("mode", "create")

    logger.info(
        "Business Agent invoked",
        user_id=user_id,
        clarification_count=clarification_count,
        message_count=len(messages),
        mode=mode,
    )

    llm = get_gemini_chat_model()

    # Build the system prompt with current context
    system_content = _BUSINESS_SYSTEM_PROMPT.format(
        max_clarifications=MAX_CLARIFICATIONS,
        clarification_count=clarification_count,
    )

    # Convert LangGraph messages to Gemini format, skip system messages from history
    chat_messages: list = [SystemMessage(content=system_content)]
    for msg in messages:
        if isinstance(msg, (HumanMessage, AIMessage)):
            chat_messages.append(msg)

    response = await llm.ainvoke(chat_messages)
    reply_text: str = response.content.strip()

    # Check if the agent is ready to search
    ready_match = re.search(
        r"<team_search_ready>\s*(.*?)\s*</team_search_ready>",
        reply_text,
        re.DOTALL,
    )

    if ready_match:
        try:
            data = json.loads(ready_match.group(1))
            role_requirements: list[RoleRequirement] = data.get("role_requirements", [])
            project_brief: str = data.get("project_brief", "")
            project_name: str = data.get("project_name", "New Project")

            # Strip the JSON block from the reply shown to the user
            clean_reply = reply_text[: ready_match.start()].strip()
            if not clean_reply:
                clean_reply = (
                    f"Great — I have everything I need. Searching for your team now: "
                    + ", ".join(r.get("role", "") for r in role_requirements)
                    + "."
                )

            logger.info(
                "Business Agent ready to search",
                roles=[r.get("role") for r in role_requirements],
                project_name=project_name,
            )

            return {
                "messages": [AIMessage(content=clean_reply)],
                "status": "searching",
                "role_requirements": role_requirements,
                "project_brief": project_brief,
                "project_name": project_name,
                "clarification_count": clarification_count,
            }

        except (json.JSONDecodeError, KeyError) as exc:
            logger.error("Business Agent JSON parse error", error=str(exc))
            # Fall through to treating it as a regular question

    # Regular clarifying question — increment counter
    new_count = clarification_count + 1
    force_ready = new_count >= MAX_CLARIFICATIONS

    updates: dict[str, Any] = {
        "messages": [AIMessage(content=reply_text)],
        "clarification_count": new_count,
        "status": "clarifying",
    }

    if force_ready:
        # Force the agent to produce role_requirements on the next turn
        # by updating the status to trigger a re-invoke with the forced prompt
        updates["status"] = "clarifying"  # will route back here with count=4 → force JSON

    return updates
