"""Recommendation schemas."""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class UserRecommendation(BaseModel):
    """Individual user recommendation."""

    user_id: str = Field(alias="userId")
    username: str = ""
    avatar: Optional[str] = None
    bio: Optional[str] = None
    tags: List[str] = []
    passion: Optional[str] = None
    metadata: Dict[str, Any] = {}

    class Config:
        populate_by_name = True
        by_alias = True


class RecommendationsResponse(BaseModel):
    """Response with personalized recommendations."""

    user_id: str = Field(alias="userId")
    recommendations: List[UserRecommendation]
    total_recommendations: int = Field(alias="totalRecommendations")
    based_on_searches: int = Field(alias="basedOnSearches")
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
        by_alias = True
