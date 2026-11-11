"""Profile vectorization schemas."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class ProfileData(BaseModel):
    """User profile data to vectorize."""

    username: str
    avatar: Optional[str] = None
    bio: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    passion: Optional[str] = None
    location_id: Optional[int] = None
    location: Optional[str] = None  # Pre-resolved location string (used in webhook flow)


class VectorizeProfileRequest(BaseModel):
    """Request to vectorize user profile."""

    user_id: str
    profile: ProfileData
    youtube_url: Optional[str] = None
    # Note: image_file will be handled separately as UploadFile in the router


class VectorizeProfileResponse(BaseModel):
    """Response from profile vectorization."""

    user_id: str = Field(alias="userId")
    vector_id: str = Field(alias="vectorId")
    success: bool
    message: str
    video_summary: Optional[str] = Field(default=None, alias="videoSummary")
    image_tags: Optional[List[str]] = Field(default=None, alias="imageTags")
    backstory_tags: Optional[List[str]] = Field(default=None, alias="backstoryTags")
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True  # Accept both snake_case and camelCase in input
        by_alias = True  # Serialize using camelCase in output
