"""Tests for Sentry configuration: disabled without a DSN, env-driven otherwise.

Regression test for the local-runs-alerting-production-Sentry incident
(2026-11-11): the DSN was hardcoded in app/core/sentry.py and
app/core/logging.py, and sentry_sdk.init() ran at import time with no
environment, so local runs reported to the production Sentry project.
"""

from unittest.mock import patch

import pytest

from app.core.config import Settings


def _settings(**overrides):
    """Build Settings with the required keys filled in for tests."""
    values = {
        "pinecone_api_key": "test_pinecone_key",
        "supabase_url": "https://test.supabase.co",
        "supabase_service_role_key": "test_supabase_key",
        "supabase_jwt_secret": "test_jwt_secret",
        "gemini_api_key": "test_gemini_key",
        "internal_api_key": "test_internal_key",
    }
    values.update(overrides)
    return Settings(**values)


@pytest.mark.unit
class TestSentrySettingsDefaults:
    """Settings defaults must never point at production Sentry."""

    def test_no_dsn_by_default(self):
        settings = _settings()
        assert settings.sentry_dsn is None

    def test_environment_defaults_to_development(self):
        settings = _settings()
        assert settings.sentry_environment == "development"

    def test_environment_is_explicitly_configurable(self):
        settings = _settings(sentry_environment="staging")
        assert settings.sentry_environment == "staging"


@pytest.mark.unit
class TestInitSentry:
    """init_sentry() only initialises the SDK when a DSN is configured."""

    def test_no_dsn_does_not_initialise_sdk(self):
        from app.core import sentry

        with patch.object(sentry.sentry_sdk, "init") as mock_init:
            assert sentry.init_sentry(_settings()) is False
            mock_init.assert_not_called()
        assert sentry.is_enabled() is False

    def test_dsn_initialises_sdk_with_development_environment(self):
        from app.core import sentry

        settings = _settings(sentry_dsn="https://abc@o1.ingest.sentry.io/1")
        with patch.object(sentry.sentry_sdk, "init") as mock_init:
            assert sentry.init_sentry(settings) is True
            mock_init.assert_called_once()
            kwargs = mock_init.call_args.kwargs
            assert kwargs["dsn"] == "https://abc@o1.ingest.sentry.io/1"
            # Never "production" unless explicitly configured.
            assert kwargs["environment"] == "development"

    def test_explicit_environment_is_passed_through(self):
        from app.core import sentry

        settings = _settings(
            sentry_dsn="https://abc@o1.ingest.sentry.io/1",
            sentry_environment="production",
        )
        with patch.object(sentry.sentry_sdk, "init") as mock_init:
            assert sentry.init_sentry(settings) is True
            assert mock_init.call_args.kwargs["environment"] == "production"
