"""Search request and response schemas."""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    """Request for semantic user search."""

    user_id: str
    query: str = Field(min_length=3, max_length=500)


class UserSearchResult(BaseModel):
    """Individual user search result."""

    user_id: str
    score: float
    username: str = ""
    avatar: Optional[str] = None
    bio: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    passion: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SearchResponse(BaseModel):
    """Response with search results."""

    user_id: str
    query: str
    results: List[UserSearchResult]
    total_results: int
    search_time_ms: int
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    # NEW FIELDS for intelligent no-results handling
    results_quality: str = Field(
        default="good",
        description="Quality assessment: 'excellent', 'good', 'marginal', 'poor'",
    )
    filtered_count: int = Field(
        default=0,
        description="Number of results filtered out by minimum threshold",
    )
    suggestion_message: Optional[str] = Field(
        default=None,
        description="AI-generated suggestion when results are poor/empty",
    )
    log_id: Optional[str] = Field(
        default=None,
        description="UUID of the search_logs row saved for this search (pre-generated before INSERT)",
    )
