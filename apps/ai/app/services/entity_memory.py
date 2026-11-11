"""Entity memory manager for the TropicalTalent AI agent.

Extracts and persists key entities from each conversation turn so the agent
maintains awareness of the user's project context, preferences, and history
across turns and sessions.

Entities stored:
- project_type: What kind of project/campaign the user is working on
- budget: Budget mentioned for the project
- timeline: Any deadlines or timeframes mentioned
- preferences: Creative styles, requirements, or preferences
- rejected_profiles: Usernames the user explicitly didn't like
- selected_profiles: Usernames the user showed interest in
- location_preference: Geographic requirements

Storage: Supabase `agent_conversation_entities` table (JSON column).
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional

from langchain_google_genai import ChatGoogleGenerativeAI

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("services.entity_memory")


def _get_entity_extraction_model() -> ChatGoogleGenerativeAI:
    """Singleton Gemini model for entity extraction (low temp, JSON output)."""
    model = getattr(_get_entity_extraction_model, "_model", None)
    if model is None:
        settings = get_settings()
        model = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=settings.gemini_api_key,
            temperature=0.1,
            max_output_tokens=800,
            model_kwargs={"response_mime_type": "application/json"},
        )
        setattr(_get_entity_extraction_model, "_model", model)
        logger.info("Entity extraction model initialized (Gemini, JSON mode)")
    return model


# Entity JSON schema for the extraction prompt
_ENTITY_SCHEMA = """\
{
  "project_type": "string or null — what kind of project/campaign (e.g. 'summer fashion campaign', 'album cover design')",
  "budget": "string or null — mentioned budget (e.g. '$2000', '500-1000 USD')",
  "timeline": "string or null — deadlines or timeframe (e.g. 'July 2026', 'next month', 'ASAP')",
  "preferences": ["array of strings — creative styles, requirements, or qualities the user wants (e.g. 'minimalist', 'edgy', 'experienced with luxury brands')"],
  "rejected_profiles": ["array of strings — usernames the user explicitly rejected or said no to"],
  "selected_profiles": ["array of strings — usernames the user showed interest in or said yes to"],
  "location_preference": "string or null — geographic preference (e.g. 'New York', 'remote OK', 'Latin America')"
}\
"""


class EntityMemoryManager:
    """Manages entity memory for a conversation.

    Entities are accumulated (merged) across turns — new extractions are
    merged into existing entities, with arrays being extended (deduplicated)
    and scalar values being overwritten only when the new value is non-null.
    """

    def __init__(self, conversation_id: str, user_id: str):
        self.conversation_id = conversation_id
        self.user_id = user_id
        self._entities: Dict[str, Any] = {}

        from supabase import create_client

        settings = get_settings()
        self.supabase = create_client(
            settings.supabase_url, settings.supabase_service_role_key
        )

    async def load_entities(self) -> Dict[str, Any]:
        """Load existing entities from Supabase.

        Returns:
            Merged entity dictionary. Empty dict if none stored yet.
        """
        try:
            result = (
                self.supabase.table("agent_conversation_entities")
                .select("entities")
                .eq("conversation_id", self.conversation_id)
                .single()
                .execute()
            )

            if result.data and result.data.get("entities"):
                self._entities = result.data["entities"]
            else:
                self._entities = {}

        except Exception:
            # Row doesn't exist yet — that's fine for new conversations
            self._entities = {}

        return self._entities

    async def extract_and_save_entities(
        self, user_message: str, assistant_response: str
    ) -> Dict[str, Any]:
        """Extract entities from the latest exchange and merge+save.

        Args:
            user_message: The user's message this turn.
            assistant_response: The assistant's response this turn.

        Returns:
            Updated merged entities dict.
        """
        try:
            new_entities = await self._extract_entities(user_message, assistant_response)

            if new_entities:
                self._merge_entities(new_entities)
                await self._save_entities()

            return self._entities

        except Exception as e:
            logger.warning(
                "Entity extraction/save failed",
                conversation_id=self.conversation_id,
                error=str(e),
            )
            return self._entities

    async def _extract_entities(
        self, user_message: str, assistant_response: str
    ) -> Dict[str, Any]:
        """Use Gemini to extract entities from the latest turn."""
        model = _get_entity_extraction_model()

        prompt = (
            "You are an entity extraction system for a talent marketplace.\n\n"
            "Given this conversation turn, extract any NEW information into the JSON schema below.\n"
            "Only include fields where the user EXPLICITLY stated something new.\n"
            "For arrays, include only NEW items not already known.\n"
            "Return null for fields with no new information.\n\n"
            f"Current known entities: {json.dumps(self._entities) if self._entities else 'None yet'}\n\n"
            f'User message: "{user_message}"\n'
            f'Assistant response: "{assistant_response[:500]}"\n\n'
            f"JSON Schema:\n{_ENTITY_SCHEMA}\n\n"
            "Extract ONLY new entities as JSON:"
        )

        response = await model.ainvoke(prompt)
        content = (getattr(response, "content", "") or "").strip()

        try:
            extracted = json.loads(content)
            if not isinstance(extracted, dict):
                return {}

            # Clean up: remove null values and empty arrays
            cleaned = {}
            for key, value in extracted.items():
                if value is None:
                    continue
                if isinstance(value, list) and not value:
                    continue
                if isinstance(value, str) and not value.strip():
                    continue
                cleaned[key] = value

            if cleaned:
                logger.info(
                    "Entities extracted",
                    conversation_id=self.conversation_id,
                    new_keys=list(cleaned.keys()),
                )

            return cleaned

        except (json.JSONDecodeError, ValueError):
            logger.warning(
                "Failed to parse entity extraction response",
                content=content[:200],
            )
            return {}

    def _merge_entities(self, new_entities: Dict[str, Any]) -> None:
        """Merge new entities into existing ones.

        - Arrays: extend and deduplicate
        - Scalars: overwrite only if new value is non-null
        """
        for key, new_value in new_entities.items():
            existing = self._entities.get(key)

            if isinstance(new_value, list):
                # Merge arrays — deduplicate
                existing_list = existing if isinstance(existing, list) else []
                merged = list(existing_list)
                for item in new_value:
                    if item not in merged:
                        merged.append(item)
                self._entities[key] = merged

            elif new_value is not None:
                # Scalar — overwrite
                self._entities[key] = new_value

    async def _save_entities(self) -> None:
        """Upsert entities to Supabase."""
        try:
            self.supabase.table("agent_conversation_entities").upsert(
                {
                    "conversation_id": self.conversation_id,
                    "user_id": self.user_id,
                    "entities": self._entities,
                },
                on_conflict="conversation_id",
            ).execute()

            logger.info(
                "Entities saved",
                conversation_id=self.conversation_id,
                entity_keys=list(self._entities.keys()),
            )

        except Exception as e:
            logger.error(
                "Failed to save entities",
                conversation_id=self.conversation_id,
                error=str(e),
            )

    def format_for_prompt(self) -> str:
        """Format entities as a natural language context block for the system prompt.

        Returns:
            Formatted string, or empty string if no entities.
        """
        if not self._entities:
            return ""

        parts = ["\n## What We Know About This User's Needs"]

        project = self._entities.get("project_type")
        if project:
            parts.append(f"- **Project:** {project}")

        budget = self._entities.get("budget")
        if budget:
            parts.append(f"- **Budget:** {budget}")

        timeline = self._entities.get("timeline")
        if timeline:
            parts.append(f"- **Timeline:** {timeline}")

        location = self._entities.get("location_preference")
        if location:
            parts.append(f"- **Location preference:** {location}")

        prefs = self._entities.get("preferences", [])
        if prefs:
            parts.append(f"- **Style/Requirements:** {', '.join(prefs)}")

        selected = self._entities.get("selected_profiles", [])
        if selected:
            parts.append(f"- **Interested in:** {', '.join('@' + u for u in selected)}")

        rejected = self._entities.get("rejected_profiles", [])
        if rejected:
            parts.append(
                f"- **Passed on:** {', '.join('@' + u for u in rejected)} "
                "(exclude these from future searches)"
            )

        return "\n".join(parts)
