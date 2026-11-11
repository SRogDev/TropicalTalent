"""TropicalTalent AI Agent — LangChain AgentExecutor orchestration.

Replaces the previous keyword-heuristic approach with a true LangChain agent
that autonomously decides when to search, when to deep-dive a profile, and
when to respond conversationally.

Uses: Gemini 2.5 Flash via LangChain, tool-calling agent pattern,
entity memory for multi-turn context.
"""

from __future__ import annotations

import json
import re
from typing import AsyncGenerator, Dict, List, Optional

from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_google_genai import ChatGoogleGenerativeAI

from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.tools.compare_tool import create_compare_profiles_tool
from app.services.tools.profile_tool import create_profile_deep_dive_tool
from app.services.tools.search_tool import create_search_creatives_tool

logger = get_logger("services.agent_executor")

# ---------------------------------------------------------------------------
# System prompt — defines agent personality, rules, and tool-use guidelines
# ---------------------------------------------------------------------------
TROPICALTALENT_SYSTEM_PROMPT = """\
You are the TropicalTalent AI assistant — a warm, professional talent finder \
for the TropicalTalent platform, a marketplace connecting brands with talent \
professionals (photographers, designers, musicians, videographers, \
illustrators, producers, editors, writers, and more).

## Your Purpose
Help users discover and learn about talent on TropicalTalent. You can \
search the platform for talent and provide in-depth profile analyses.

## Rules
1. **Stay on topic.** Your ONLY purpose is helping users find talent \
talent. If the user asks about anything off-topic (history, science, math, \
personal advice, trivia), DO NOT answer it — instead pivot warmly to a \
talent search suggestion loosely related to their topic.
   - Example: User asks about a historical king → "I'm your talent \
finder! Speaking of royalty, can I help you find a portrait painter or a \
filmmaker who specializes in historical storytelling?"
2. **Never fabricate profiles.** Only present talent returned by your \
tools. If a search returns no results, tell the user honestly and suggest \
alternative search terms.
3. **Be concise, warm, and professional.** 2-4 sentences for conversational \
responses. When presenting search results, briefly highlight why each \
match is relevant.
3b. **Plain text only.** Do NOT use markdown formatting in your responses — \
no asterisks for bold, no `#` headers, no bullet lists using `*` or `-`. \
Write in plain, natural conversational prose.
3c. **Use display names.** When referring to professionals, always \
use their full display name from the name= field in search results, not their \
username/handle. Example: say "Raquan Cameron-Williams" not "RaquanFilms". \
When calling tools, always use the username/handle (the identifier before the \
opening parenthesis). The user_id= field is internal — never mention it.
4. **Language matching.** Respond in the same language the user is using \
(English, Spanish, etc.).
5. **Multi-turn awareness.** Remember what the user has been looking for. \
If they say "search again" or "find me another", refine the previous search \
based on conversation context.
6. **When presenting search results**, always end by asking if they'd like \
to know more about a specific professional or refine their search.

## Tool Usage Guidelines
- Use **search_creatives** when the user wants to find, discover, or get \
recommendations for professionals. Also use when they describe a \
project need without naming a specific person.
- Use **profile_deep_dive** when the user asks about ONE SPECIFIC person \
by name or @handle. Triggers: "tell me more about Alex", "is @maria a good \
fit?", "what does Juan specialize in?", "show me [name]'s profile". \
IMPORTANT: go directly to profile_deep_dive — do NOT run search_creatives \
first when a specific username or name is already known.
- Use **compare_profiles** when the user wants to compare exactly TWO \
people — "compare Alex and Maria", "who is better, @john or @sarah?", \
"Alex vs Maria", "help me choose between the two". Extract BOTH usernames \
and any project context from the conversation. Do NOT use for a single profile.
- After presenting search results and asking if the user wants more details, \
if they say "yes", "sure", "tell me more", or express interest in a specific \
person already found, immediately use profile_deep_dive for that person. Do \
NOT call search_creatives again for someone already found in this conversation.
- For greetings, general conversation, or follow-up questions about results \
you already showed, respond directly without tools.

{entity_context}
"""


def _build_prompt() -> ChatPromptTemplate:
    """Build the chat prompt template with entity context placeholder."""
    return ChatPromptTemplate.from_messages(
        [
            ("system", TROPICALTALENT_SYSTEM_PROMPT),
            MessagesPlaceholder("chat_history", optional=True),
            ("human", "{input}"),
            MessagesPlaceholder("agent_scratchpad"),
        ]
    )


def _get_agent_llm() -> ChatGoogleGenerativeAI:
    """Singleton Gemini model for the agent (tool-calling capable)."""
    model = getattr(_get_agent_llm, "_model", None)
    if model is None:
        settings = get_settings()
        model = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=settings.gemini_api_key,
            temperature=0.7,
            max_output_tokens=2000,
            convert_system_message_to_human=True,
        )
        setattr(_get_agent_llm, "_model", model)
        logger.info("Agent LLM initialized (Gemini 2.5 Flash, tool-calling)")
    return model


def create_agent_executor(
    user_id: str,
    chat_history: Optional[List] = None,
    entity_context: str = "",
) -> AgentExecutor:
    """Create a LangChain AgentExecutor bound to a specific user session.

    Args:
        user_id: Authenticated user UUID — passed to tools for self-exclusion.
        chat_history: List of LangChain BaseMessage objects for context.
        entity_context: Formatted entity memory string injected into system prompt.

    Returns:
        Configured AgentExecutor ready to invoke.
    """
    llm = _get_agent_llm()
    prompt = _build_prompt()

    # Create user-scoped tools
    search_tool = create_search_creatives_tool(user_id)
    profile_tool = create_profile_deep_dive_tool(user_id)
    compare_tool = create_compare_profiles_tool(user_id)
    tools = [search_tool, profile_tool, compare_tool]

    # Create the tool-calling agent
    agent = create_tool_calling_agent(llm, tools, prompt)

    # Raise max_iterations to 5 to cover: search → compare/dive → respond
    executor = AgentExecutor(
        agent=agent,
        tools=tools,
        verbose=False,
        handle_parsing_errors=True,
        max_iterations=5,
        return_intermediate_steps=True,
    )

    logger.info(
        "AgentExecutor created",
        user_id=user_id,
        tools=[t.name for t in tools],
        has_history=bool(chat_history),
        has_entities=bool(entity_context),
    )

    return executor


def parse_search_results_from_output(output: str) -> Optional[Dict]:
    """Extract search result data from agent output for SSE profile events.

    Parses the structured output that search_creatives tool returns
    to extract profile data and log_id for the frontend.

    Returns:
        Dict with 'log_id' and 'results' list, or None if no search was done.
    """
    if "SEARCH_RESULTS:" not in output and "log_id=" not in output:
        return None

    try:
        # Extract log_id
        log_id_match = re.search(r"log_id=([\w-]+)", output)
        log_id = log_id_match.group(1) if log_id_match else None

        return {"log_id": log_id}
    except Exception:
        return None


async def run_agent_streaming(
    user_id: str,
    message: str,
    chat_history: Optional[List] = None,
    entity_context: str = "",
) -> AsyncGenerator[Dict, None]:
    """Run the agent and yield structured events for SSE streaming.

    Yields dicts with 'type' and 'content' keys compatible with the existing
    SSE protocol (message, profiles, search_log, done).

    Args:
        user_id: Authenticated user UUID.
        message: User's message text.
        chat_history: LangChain message history.
        entity_context: Formatted entity context string.

    Yields:
        {"type": "message", "content": <text_chunk>}
        {"type": "search_log", "content": {"log_id": ...}}
        {"type": "profiles", "content": [<profile_dicts>]}
        {"type": "tool_used", "content": <tool_name>}
        {"type": "done", "content": "end"}
    """
    executor = create_agent_executor(
        user_id=user_id,
        chat_history=chat_history,
        entity_context=entity_context,
    )

    try:
        result = await executor.ainvoke(
            {
                "input": message,
                "chat_history": chat_history or [],
                "entity_context": entity_context,
            }
        )

        output_text = result.get("output", "")
        intermediate_steps = result.get("intermediate_steps", [])

        # Track which tools were used and extract search data
        tools_used = []
        search_log_id = None
        search_results_raw = None

        for step in intermediate_steps:
            if len(step) >= 2:
                action = step[0]
                tool_output = step[1]
                tool_name = getattr(action, "tool", None)

                if tool_name:
                    tools_used.append(tool_name)
                    yield {"type": "tool_used", "content": tool_name}

                # Extract search metadata from tool output
                if tool_name == "search_creatives" and isinstance(tool_output, str):
                    search_data = parse_search_results_from_output(tool_output)
                    if search_data:
                        search_log_id = search_data.get("log_id")
                        search_results_raw = tool_output

        # Emit search_log event if search was performed
        if search_log_id:
            yield {"type": "search_log", "content": {"log_id": search_log_id}}

        # Stream the agent's final response in chunks for SSE
        # Split into sentences for natural streaming feel.
        # Add a trailing space to non-final chunks so the frontend can
        # concatenate them without losing the word boundary.
        if output_text:
            chunks = _split_into_chunks(output_text)
            for i, chunk in enumerate(chunks):
                content = chunk if i == len(chunks) - 1 else chunk + " "
                yield {"type": "message", "content": content}

        # If search was used, emit profiles event by enriching from Supabase
        if "search_creatives" in tools_used and search_results_raw:
            profiles = await _extract_profiles_for_sse(search_results_raw, user_id)
            if profiles:
                yield {"type": "profiles", "content": profiles}

        # If profile_deep_dive was used, emit a single profile card
        if "profile_deep_dive" in tools_used:
            for step in intermediate_steps:
                if len(step) >= 2:
                    action = step[0]
                    tool_output = step[1]
                    if (
                        getattr(action, "tool", None) == "profile_deep_dive"
                        and isinstance(tool_output, str)
                    ):
                        profile = await _extract_profile_for_deep_dive_sse(
                            tool_output, user_id
                        )
                        if profile:
                            yield {"type": "profiles", "content": [profile]}
                        break

    except Exception as e:
        logger.error("Agent execution failed", error=str(e), user_id=user_id)
        yield {
            "type": "message",
            "content": "I'm sorry, something went wrong. Could you try rephrasing your request?",
        }

    yield {"type": "done", "content": "end"}


def _split_into_chunks(text: str, max_chunk_size: int = 120) -> List[str]:
    """Split text into natural-feeling chunks for SSE streaming.

    Tries to break on sentence boundaries, falling back to word boundaries.
    """
    if len(text) <= max_chunk_size:
        return [text]

    chunks = []
    # Split by sentences first
    sentences = re.split(r"(?<=[.!?])\s+", text)

    current_chunk = ""
    for sentence in sentences:
        if len(current_chunk) + len(sentence) + 1 <= max_chunk_size:
            current_chunk += (" " if current_chunk else "") + sentence
        else:
            if current_chunk:
                chunks.append(current_chunk)
            current_chunk = sentence

    if current_chunk:
        chunks.append(current_chunk)

    return chunks if chunks else [text]


async def _extract_profiles_for_sse(
    tool_output: str, user_id: str
) -> List[Dict]:
    """Parse search tool output and build profile cards for the SSE profiles event.

    The search tool embeds user_id, name, passion, and location directly in
    each result line so we can build cards from the tool output alone, then
    do a single lightweight Supabase query (by UUID) only to fetch fresh avatars.
    This avoids fragile username-based lookups and complex foreign-table joins.
    """
    try:
        from app.core.database import get_supabase_client

        # Tool output format (per result line):
        #   "- handle (user_id=UUID, name=Display Name, passion=X[,Y...], location=Z[,W...], score=N.NNN)"
        # passion and location can both contain commas; we anchor on field-name
        # prefixes so commas inside values don't confuse the parser.
        profile_pattern = re.compile(
            r"^- (\S+) \("
            r"user_id=([\w-]+), "
            r"name=(.+?), "
            r"passion=(.+?), "
            r"location=(.*?), "
            r"score=[\d.]",
            re.MULTILINE,
        )
        matches = profile_pattern.findall(tool_output)

        if not matches:
            logger.warning("_extract_profiles_for_sse: regex matched 0 lines", tool_output_snippet=tool_output[:300])
            return []

        # Build a lookup from the tool output (everything we need except avatar)
        # matches[i] = (handle, user_id, name, passion, location)
        parsed = {
            m[1]: {  # keyed by user_id (UUID) — reliable, no case issues
                "user_id": m[1],
                "username": m[0].strip(),  # handle — frontend uses this for Supabase queries
                "name": m[2].strip(),      # display name — frontend uses this for UI display
                "passion": m[3].strip() if m[3].strip() != "N/A" else None,
                "location": m[4].strip() if m[4].strip() != "N/A" else None,
            }
            for m in matches
        }
        result_user_ids = list(parsed.keys())

        # Fetch only fresh avatars (and DB name if available) — no join needed
        try:
            supabase = await get_supabase_client()
            db_result = (
                supabase._client.table("users")
                .select("id, username, name, avatar")
                .in_("id", result_user_ids)
                .execute()
            )
            for row in db_result.data or []:
                uid = row["id"]
                if uid in parsed:
                    parsed[uid]["avatar"] = row.get("avatar")
                    # Prefer fresh DB values
                    if row.get("username"):
                        parsed[uid]["username"] = row["username"]
                    if row.get("name"):
                        parsed[uid]["name"] = row["name"]
        except Exception as db_err:
            logger.warning("Could not enrich profile cards with Supabase avatar", error=str(db_err))
            for uid in parsed:
                parsed[uid].setdefault("avatar", None)

        return list(parsed.values())

    except Exception as e:
        logger.warning("Failed to extract profiles for SSE", error=str(e))
        return []


async def _extract_profile_for_deep_dive_sse(
    tool_output: str, user_id: str
) -> Optional[Dict]:
    """Parse profile_deep_dive output and return a profile card dict for SSE."""
    try:
        from app.core.database import get_supabase_client

        # Extract username from "PROFILE_DETAILS for @username:"
        username_match = re.search(r"PROFILE_DETAILS for @(\S+)", tool_output)
        if not username_match:
            return None

        username = username_match.group(1).rstrip(":")

        supabase = await get_supabase_client()
        db_result = (
            supabase._client.table("users")
            .select("id, username, name, avatar, creative_data(passion)")
            .eq("username", username)
            .single()
            .execute()
        )

        if not db_result.data:
            return None

        # Extract location from the tool output ("Location: city" line)
        location_match = re.search(r"^Location:\s*(.+)$", tool_output, re.MULTILINE)
        location = location_match.group(1).strip() if location_match else None

        user = db_result.data
        creative = user.get("creative_data") or {}
        return {
            "user_id": user["id"],
            "username": user.get("username"),           # actual handle — frontend uses for Supabase queries
            "name": user.get("name") or user.get("username"),  # display name — frontend uses for UI display
            "avatar": user.get("avatar"),
            "passion": creative.get("passion"),
            "location": location,
        }

    except Exception as e:
        logger.warning("Failed to extract profile for deep dive SSE", error=str(e))
        return None
