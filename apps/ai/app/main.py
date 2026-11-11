"""Main FastAPI application."""

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core import sentry  # Import sentry for error tracking
from app.core import configure_logging, get_logger, get_settings, setup_cors

# Import routers package (it's optional during early refactors) with helpful error
try:
    from app.routes import router as api_router
except ImportError:
    api_router = None
    # logger may not be configured yet; defer warning until after logger exists

# Configure logging
configure_logging()
logger = get_logger("main")


@asynccontextmanager
async def lifespan(application: FastAPI):
    """Application lifespan manager.

    The parameter is named `application` to avoid shadowing the module-level
    `app` variable that is created later. This prevents lint warnings about
    redefining names from outer scope.
    """
    settings = get_settings()
    logger.info("Starting TropicalTalent AI", version=settings.app_version)
    yield
    logger.info("Shutting down TropicalTalent AI")


def create_application() -> FastAPI:
    """Create and configure FastAPI application."""
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="TropicalTalent AI API for semantic search and recommendations",
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
        openapi_url="/openapi.json" if settings.debug else None,
        lifespan=lifespan,
    )

    # Setup CORS
    setup_cors(app)

    # Include application routers
    if api_router is not None:
        app.include_router(api_router)
    else:
        logger.warning("app.routes.router not found — no API routes registered")

    # Error handlers
    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ):
        logger.warning("Validation error", url=str(request.url), errors=exc.errors())
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"error": "Validation failed", "details": exc.errors()},
        )

    @app.exception_handler(Exception)
    async def general_exception_handler(request: Request, exc: Exception):
        logger.error("Unexpected error", url=str(request.url), error=str(exc))

        # Capture exception with Sentry
        sentry.sentry_sdk.capture_exception(exc)

        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error": "Internal server error"},
        )

    return app


# Create app
app = create_application()


@app.get("/")
async def root():
    """API root endpoint."""
    settings = get_settings()
    return {
        "service": settings.app_name,
        "version": settings.app_version,
        "docs": "/docs" if settings.debug else None,
    }


def main():
    """Run application with uvicorn."""
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        log_level=str(settings.log_level).lower(),
    )


if __name__ == "__main__":
    main()
