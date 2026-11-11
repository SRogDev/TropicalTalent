"""Agent endpoint request/response models."""

from typing import Any, Optional

from pydantic import BaseModel, Field


class AgentRequest(BaseModel):
    """Request payload for /agent endpoint."""

    message: str = Field(..., min_length=1)
    conversation_id: Optional[str] = None


class AgentMessageEvent(BaseModel):
    """Single message event streamed via SSE."""

    type: str  # "message" or "profiles"
    content: Any


class AgentProfilesItem(BaseModel):
    """Profile item returned in agent search results."""

    user_id: str = Field(alias="userId")
    username: Optional[str] = None  # actual handle — used by frontend for Supabase queries
    name: Optional[str] = None      # display name — used by frontend for UI display
    avatar: Optional[str] = None
    passion: Optional[str] = None
    location: Optional[str] = None
    bio: Optional[str] = None
    tags: Optional[list] = None
    video: Optional[str] = None     # YouTube URL
    audio: Optional[str] = None     # SoundCloud URL

    class Config:
        populate_by_name = True
        by_alias = True


class AgentConversationCreate(BaseModel):
    """Request to create a new conversation."""

    title: Optional[str] = Field(default="New Conversation")


class AgentConversationResponse(BaseModel):
    """Response containing conversation details."""

    id: str
    user_id: str
    title: str
    summary: Optional[str] = None
    created_at: str
    updated_at: str


class AgentMessageResponse(BaseModel):
    """Response containing message details."""

    id: str
    conversation_id: str
    role: str
    content: str
    tool_used: Optional[str] = None
    created_at: str
