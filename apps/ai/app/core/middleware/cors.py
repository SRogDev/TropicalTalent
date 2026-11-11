"""CORS middleware setup for the FastAPI app.

Allows requests only from configured frontend origins (production and
local development). Intended to live under `app.core.middleware` so other
middlewares can be added alongside it.
"""

from typing import List

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings


def setup_cors(app: FastAPI) -> None:
    """Configure and attach CORS middleware to the FastAPI app.

    Origins allowed:
    - Production: https://tropicaltalent.dev (placeholder — replace with
      the real production domain when it exists)
    - Local development: http://localhost:3000 and https://localhost:3000
    """
    settings = get_settings()

    # Allowed origins explicitly listed for production and development.
    # NOTE (2026-11-11, rebrand): the old Tones origins (tonesagency.com,
    # tonesplatform.com, tones-provisional.vercel.app) were removed; there
    # is no production TropicalTalent domain yet, so tropicaltalent.dev
    # stands in as a placeholder until the real domain is registered.
    allow_origins: List[str] = [
        "https://tropicaltalent.dev",
        "https://www.tropicaltalent.dev",
        "http://localhost:3000",
        "https://localhost:3000",
    ]

    # Optionally, allow localhost variants in development
    if settings.is_development():
        allow_origins.extend(["http://127.0.0.1:3000"])

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        allow_headers=["*"],
        expose_headers=["*"],
        max_age=3600,
    )
