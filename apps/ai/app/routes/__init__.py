"""API routers - combines all endpoint routers with resilient loading.

This module loads routers individually so that if one router fails to import,
the others will still be available. This provides graceful degradation.
"""

from fastapi import APIRouter

# Get logger for router loading
from app.core.logging import get_logger

logger = get_logger("routes")

# Create main router that combines all sub-routers
router = APIRouter()

# Define routers to load with their module paths
ROUTERS_TO_LOAD = [
    ("agent", "app.routes.agent", "/api/agent"),
   # ("team_search", "app.routes.team_search", "/api/team-search"), # disabled for now 
    ("webhooks", "app.routes.webhooks", "/api/webhooks"),
    ("health", "app.routes.health", "/health"),
    ("search", "app.routes.internals.search", "/search (internal)"),
    ("recommendations", "app.routes.recommendations", "/api/recommendations"),
    ("vectorize", "app.routes.vectorize", "/api/vectorize"),
    ("admin", "app.routes.admin", "/api/admin"),
    ("feedback", "app.routes.feedback", "/generate-feedback-insights"),
    ("search_insights", "app.routes.search_insights", "/generate-search-insights"),
]

# Load routers individually so one failure doesn't break the entire API
loaded_routers = []
failed_routers = []

for router_name, module_path, endpoint in ROUTERS_TO_LOAD:
    try:
        module = __import__(module_path, fromlist=["router"])
        sub_router = getattr(module, "router")
        router.include_router(sub_router)
        loaded_routers.append(router_name)
        logger.debug(f"Loaded router: {router_name} → {endpoint}")
    except ImportError as e:
        failed_routers.append((router_name, str(e)))
        logger.warning(f"Failed to load router '{router_name}': {e}")
    except Exception as e:
        failed_routers.append((router_name, str(e)))
        logger.error(f"Unexpected error loading router '{router_name}': {e}")

# Log summary
if loaded_routers:
    logger.info(f"API Routers loaded successfully: {', '.join(loaded_routers)}")

if failed_routers:
    logger.warning(
        f"API Routers failed to load: {', '.join([r[0] for r in failed_routers])}"
    )
    for router_name, error in failed_routers:
        logger.debug(f"  {router_name}: {error}")

__all__ = ["router"]
