"""
Core configuration management for the TropicalTalent AI API.

This module handles environment variables, application settings, and provides
centralized configuration for all components. Uses Pydantic for validation
and type safety.

Design Notes:
- Environment variables are loaded from .env files
- All secrets are managed through env vars (never hardcoded)
- Configuration is validated at startup to fail fast on misconfigurations
- Settings are cached as singletons for performance
- Migrated from OpenAI to Pinecone Assistant for embeddings
"""

import os
from functools import lru_cache
from typing import Optional

from pydantic import ConfigDict, Field, validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.

    This class automatically loads and validates configuration from:
    1. Environment variables
    2. .env file (if present)
    3. Default values (where appropriate)

    All settings are validated at startup to ensure proper configuration.
    """

    # ========================================================================
    # Application Configuration
    # ========================================================================

    app_name: str = Field(
        default="TropicalTalent AI",
        description="Application name for logging and documentation",
    )

    app_version: str = Field(default="0.1.0", description="Application version")

    debug: bool = Field(
        default=False,
        description="Enable debug mode (verbose logging, detailed errors)",
    )

    log_level: str = Field(
        default="INFO",
        description="Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)",
    )

    # ========================================================================
    # Server Configuration
    # ========================================================================

    host: str = Field(default="0.0.0.0", description="Host to bind the server to")

    port: int = Field(
        default=8000, ge=1, le=65535, description="Port to run the server on"
    )
    @validator("port", pre=True, always=True)
    def set_port(cls, v):
        return int(os.environ.get("PORT", v))

    # ========================================================================
    # API Keys and Secrets
    # ========================================================================

    pinecone_api_key: str = Field(
        ...,  # Required field
        description="Pinecone API key for vector database operations",
    )

    supabase_url: str = Field(..., description="Supabase project URL")  # Required field

    supabase_service_role_key: str = Field(
        ...,  # Required field
        description="Supabase service role key for database operations",
    )
    supabase_jwt_secret: str = Field(..., description="Supabase JWT secret")

    gemini_api_key: str = Field(
        ...,  # Required field
        description="Google Gemini API key for embeddings and AI operations",
    )

    # Internal API key for securing internal endpoints.
    # SECURITY (2026-11-11): this is REQUIRED — there is no default.
    # The old placeholder default ("internal-api-key-changeme") meant any
    # deployment that forgot to set INTERNAL_API_KEY shipped with a publicly
    # known admin key. Settings() now raises a ValidationError at startup
    # when INTERNAL_API_KEY is unset, so the app fails fast instead of
    # running unprotected. Generate one with: openssl rand -hex 32
    internal_api_key: str = Field(
        ...,
        description="API key for securing internal endpoints (generate a secure random key)",
    )

    # ========================================================================
    # Redis / Upstash Configuration
    # ========================================================================

    upstash_redis_url: Optional[str] = Field(
        default=None,
        description=(
            "Upstash Redis URL in Redis protocol format: "
            "rediss://default:PASSWORD@HOST.upstash.io:6379. "
            "Used for LangGraph Team Search state persistence across deploys. "
            "Falls back to in-memory MemorySaver when not set."
        ),
    )

    # QStash signing keys for verifying webhook deliveries from Upstash QStash
    # Dashboard → QStash → Signing Keys tab
    qstash_current_signing_key: Optional[str] = Field(
        default=None,
        description="QStash current signing key (HMAC-SHA256). Required for /api/webhooks/vectorize.",
    )
    qstash_next_signing_key: Optional[str] = Field(
        default=None,
        description="QStash next signing key (used during key rotation).",
    )

    # DEV ONLY — never enable in production. When True AND no QStash signing
    # keys are configured, /api/webhooks/vectorize accepts unsigned
    # deliveries (local development without a QStash project). The flag has
    # NO effect when SENTRY_ENVIRONMENT=production: unsigned requests are
    # always rejected there. Without keys and without this flag, unsigned
    # requests are rejected everywhere (fail closed). See
    # app/routes/webhooks.py::_verify_qstash_signature.
    qstash_allow_unsigned: bool = Field(
        default=False,
        description="DEV ONLY: allow unsigned QStash webhook deliveries when no signing keys are configured. Ignored in production.",
    )

    # ========================================================================
    # Monitoring and Error Tracking
    # ========================================================================

    sentry_dsn: Optional[str] = Field(
        default=None,
        description="Sentry DSN for error tracking and monitoring (optional)",
    )

    sentry_environment: str = Field(
        default="development",
        description="Sentry environment name (development, staging, production)",
    )

    sentry_traces_sample_rate: float = Field(
        default=0.1,
        ge=0.0,
        le=1.0,
        description="Sentry performance monitoring sample rate (0.0 to 1.0)",
    )

    # ========================================================================
    # Pinecone Configuration
    # ========================================================================

    pinecone_environment: str = Field(
        default="us-east-1", description="Pinecone environment/region"
    )

    pinecone_index_name: str = Field(
        default="talent-index",
        description="Name of the Pinecone index for user vectors",
    )

    # Pinecone Inference API for embeddings
    pinecone_embedding_model: str = Field(
        default="multilingual-e5-large",
        description="Pinecone Inference embedding model name",
    )

    # ========================================================================
    # Database Configuration
    # ========================================================================

    # New tables for opportunity matching
    opportunities_table: str = Field(
        default="opportunities",
        description="Name of the opportunities table in Supabase",
    )

    matching_results_table: str = Field(
        default="matching_results",
        description="Name of the matching results table in Supabase",
    )

    # Existing tables
    search_logs_table: str = Field(
        default="search_logs", description="Name of the search logs table in Supabase"
    )

    # NOTE (2026-11-11, rebrand): the Supabase table is still named
    # `creative_data` in the live database, and the frontend migrations now
    # use `tropical_*` tables. Renaming this default would silently break
    # every Supabase query that reads user profile data
    # (`.select("... creative_data(passion)")`), so the data-model name
    # stays until a real DB migration renames the table. See README.md
    # "Known issues" for the mismatch.
    users_data_table: str = Field(
        default="creative_data", description="Name of the creative data table in Supabase"
    )

    # ========================================================================
    # Vector and AI Configuration
    # ========================================================================

    embedding_dimension: int = Field(
        default=3072,
        ge=1,
        description="Dimension of the embedding vectors (gemini-embedding-001 with 3072)",
    )

    embedding_model: str = Field(
        default="models/gemini-embedding-001",
        description="Google Gemini embedding model for vector generation",
    )

    max_results: int = Field(
        default=10,
        ge=1,
        le=100,
        description="Default maximum number of search results to return",
    )

    similarity_threshold: float = Field(
        default=0.85,
        ge=0.0,
        le=1.0,
        description="Threshold for 'good' quality matches (above minimum but below excellent)",
    )

    excellent_match_threshold: float = Field(
        default=0.90,
        ge=0.0,
        le=1.0,
        description="Threshold for excellent quality matches",
    )

    minimum_match_threshold: float = Field(
        default=0.75,
        ge=0.0,
        le=1.0,
        description="Minimum threshold - results below this are filtered out. "
        "Matches below 0.75 are not shown; the agent uses smart no-results responses instead.",
    )

    # Namespace configuration for Pinecone
    pinecone_namespace_users: str = Field(
        default="users", description="Pinecone namespace for user profile vectors"
    )

    pinecone_namespace_opportunities: str = Field(
        default="opportunities",
        description="Pinecone namespace for opportunity vectors",
    )

    # ========================================================================
    # Performance and Rate Limiting
    # ========================================================================

    rate_limit_per_minute: int = Field(
        default=60, ge=1, description="Rate limit for API requests per minute per user"
    )

    # Background task timeout
    matching_timeout_seconds: int = Field(
        default=300,  # 5 minutes
        ge=30,
        description="Maximum time allowed for matching process",
    )

    # ========================================================================
    # Validation and Configuration
    # ========================================================================

    model_config = ConfigDict(
        env_file=".env", env_file_encoding="utf-8", case_sensitive=False, extra="ignore"
    )

    def get_database_url(self) -> str:
        """Get the complete Supabase database URL."""
        return f"{self.supabase_url}/rest/v1/"

    def is_development(self) -> bool:
        """Check if running in development mode."""
        return self.debug or self.log_level == "DEBUG"

    def get_cors_origins(self) -> list[str]:
        """Get CORS origins based on environment."""
        if self.is_development():
            return ["*"]  # Allow all origins in development
        else:
            # In production, specify exact origins
            return [
                "https://tropicaltalent.dev",
                "https://www.tropicaltalent.dev",
            ]


@lru_cache()
def get_settings() -> Settings:
    """
    Get application settings (cached).

    This function provides a cached singleton instance of the settings.
    The @lru_cache decorator ensures that settings are loaded only once
    and reused across the application lifetime.

    Returns:
        Settings: The application settings instance

    Raises:
        ValidationError: If required environment variables are missing
        or configuration is invalid
    """
    return Settings()


# Convenience function for getting settings without importing the class
def get_config() -> Settings:
    """Alias for get_settings() for backward compatibility."""
    return get_settings()
