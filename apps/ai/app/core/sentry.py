"""Sentry error tracking initialization."""

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration

# Initialize Sentry directly
sentry_sdk.init(
    dsn="https://bf020ddd8d414e8e1ba71e493bec488e@o4510276306468864.ingest.us.sentry.io/4510295934173184",
    send_default_pii=True,
    integrations=[
        FastApiIntegration(),
    ],
)
