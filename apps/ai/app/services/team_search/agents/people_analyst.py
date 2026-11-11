"""People Analyst node for the Team Search LangGraph graph.

Triggered during the 'reviewing' interrupt when the user asks to learn more
about a specific professional or to compare two of them — BEFORE approving the team.

Examples that route here:
  "tell me more about @alex"
  "compare @maria and @james"
  "who is that photographer?"
  "what does @carlos specialise in?"
  "is @sarah a good fit for the campaign?"

After running, status returns to 'reviewing' so the user can continue
deciding about the team.

Uses the existing `profile_deep_dive` and `compare_profiles` tools directly
via a minimal AgentExecutor — no new Pinecone logic needed.
"""

from __future__ import annotations

from typing import Any

from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from app.core.logging import get_logger
from app.services.query_enricher import get_gemini_chat_model
from app.services.team_search.state import TeamSearchState
from app.services.tools.compare_tool import create_compare_profiles_tool
from app.services.tools.profile_tool import create_profile_deep_dive_tool

logger = get_logger("team_search.people_analyst")

_ANALYST_SYSTEM = """You are a talent analyst helping a brand or commissioner
build a team on TropicalTalent, a talent platform.

The user is reviewing a proposed team and wants deeper information about one or
two specific people before deciding. Use the tools provided to fetch the
requested information and deliver a focused, consultative response.

CONTEXT:
- Project: {project_name}
- Roles being filled: {roles}

INSTRUCTIONS:
- Use profile_deep_dive for questions about a single person.
- Use compare_profiles when the user mentions two people.
- After the tool call, give a warm 3-5 sentence analysis that connects the
  professional's strengths to the project context above.
- Do NOT re-search for new people — only analyse those already proposed.
- Keep the response focused and actionable.
"""


async def people_analyst_node(state: TeamSearchState) -> dict[str, Any]:
    """LangGraph node: People Analyst.

    Runs a mini AgentExecutor with profile_deep_dive + compare_profiles,
    then returns the analysis as an AI message while keeping status='reviewing'
    so the user can continue with the team decision.
    """
    user_id = state.get("user_id", "")
    messages = state.get("messages", [])
    project_name = state.get("project_name", "this project")
    role_requirements = state.get("role_requirements", [])
    roles_str = ", ".join(r.get("role", "") for r in role_requirements if r.get("role"))

    # Find the latest human message to use as the analysis request
    last_human = next(
        (m for m in reversed(messages) if isinstance(m, HumanMessage)), None
    )
    if not last_human:
        return {"status": "reviewing"}

    logger.info(
        "People Analyst invoked",
        user_id=user_id,
        request=last_human.content[:100],
    )

    llm = get_gemini_chat_model()
    profile_tool = create_profile_deep_dive_tool(user_id)
    compare_tool = create_compare_profiles_tool(user_id)
    tools = [profile_tool, compare_tool]

    system_content = _ANALYST_SYSTEM.format(
        project_name=project_name,
        roles=roles_str or "various talent roles",
    )

    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", system_content),
            MessagesPlaceholder("chat_history"),
            ("human", "{input}"),
            MessagesPlaceholder("agent_scratchpad"),
        ]
    )

    agent = create_tool_calling_agent(llm, tools, prompt)
    executor = AgentExecutor(
        agent=agent,
        tools=tools,
        verbose=False,
        handle_parsing_errors=True,
        max_iterations=2,  # One tool call + synthesis
        return_intermediate_steps=False,
    )

    try:
        result = await executor.ainvoke(
            {
                "input": last_human.content,
                "chat_history": [],
            }
        )
        reply = result.get("output", "I couldn't retrieve that information right now.")
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("People Analyst execution error", error=str(exc))
        reply = (
            "I ran into a problem fetching that profile. "
            "You can still proceed with the team or ask me to swap someone."
        )

    logger.info("People Analyst complete", reply_chars=len(reply))

    return {
        "messages": [AIMessage(content=reply)],
        "status": "reviewing",  # Return to reviewing so user can continue deciding
    }
