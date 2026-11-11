"""Database models for Supabase tables."""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class SearchLogEntry(BaseModel):
    """Model for search log entries stored in Supabase.

    Represents a user's search query and its results.
    """

    user_id: str = Field(..., description="User identifier")
    content: str = Field(..., description="Search query content")
    results: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Search results returned for this query"
    )
    created_at: Optional[datetime] = Field(
        None,
        description="Timestamp when the search was performed"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "user_id": "user_123",
                "content": "python developer with 5 years experience",
                "results": [
                    {"id": "talent_1", "score": 0.95},
                    {"id": "talent_2", "score": 0.87}
                ],
                "created_at": "2026-01-12T10:30:00Z"
            }
        }


class UserData(BaseModel):
    """Model for user profile data stored in Supabase.

    Contains user preferences and profile information for recommendations.
    """

    user_id: str = Field(..., description="User identifier")
    bio: Optional[str] = Field(
        None,
        description="User biography or description"
    )
    video_tags: Optional[List[str]] = Field(
        None,
        description="List of video tags associated with the user"
    )
    passion: Optional[str] = Field(
        None,
        description="User's main passion or interest"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "user_id": "user_123",
                "bio": "Content creator focused on tech tutorials",
                "video_tags": ["programming", "tutorials", "python"],
                "passion": "Teaching coding to beginners"
            }
        }
