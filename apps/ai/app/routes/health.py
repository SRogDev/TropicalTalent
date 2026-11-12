"""Health check endpoint for monitoring and load balancers."""

from datetime import datetime, timezone
from fastapi import APIRouter

router = APIRouter(
    prefix="/health",
    tags=["Health"],
)


@router.get("")
async def health_check():
    """
    Basic health check endpoint for monitoring and load balancers.

    Returns service status, version, and timestamp.
    No authentication required for infrastructure monitoring.
    """
    return {
        "status": "ok",
        "service": "ai-service",
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
