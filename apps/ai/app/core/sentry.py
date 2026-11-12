"""Sentry error tracking initialization.

Sentry is DISABLED unless a DSN is provided via the SENTRY_DSN
environment variable (``Settings.sentry_dsn``). Importing this module
has no side effects — call :func:`init_sentry` once at application
startup. With no DSN, ``sentry_sdk`` is never initialised, so no event
can leave the process (local runs used to alert the production Sentry
project because the DSN was hardcoded here and ``init()`` ran on import).

The Sentry environment comes from SENTRY_ENVIRONMENT
(``Settings.sentry_environment``) and defaults to ``"development"`` —
never ``"production"`` unless explicitly configured.
"""

from typing import Optional

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration

from .config import Settings, get_settings


def init_sentry(settings: Optional[Settings] = None) -> bool:
    """Initialise Sentry from settings.

    Returns True when the SDK was initialised, False when Sentry stays
    disabled (no DSN configured).
    """
    settings = settings or get_settings()
    if not settings.sentry_dsn:
        return False
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        # Add data like request headers and IP for users,
        # see https://docs.sentry.io/platforms/python/data-management/data-collected/ for more info
        send_default_pii=True,
        integrations=[
            FastApiIntegration(),
        ],
    )
    return True


def is_enabled() -> bool:
    """True when Sentry was initialised with a DSN in this process."""
    return getattr(sentry_sdk.get_client(), "dsn", None) is not None
