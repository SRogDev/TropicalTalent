"""
Structured logging configuration for the TropicalTalent AI.

This module provides centralized logging setup with structured JSON logging
for better observability and debugging. Uses structlog for consistent
structured logging across all components.

Design Notes:
- JSON structured logging for better parsing and analysis
- Correlation IDs for tracing requests across services
- Different log levels for different environments
- Performance-conscious logging (lazy evaluation)
- Integration with FastAPI request/response cycle
"""

import logging
import logging.config
import sys
from typing import Any, Dict

import structlog
from structlog.typing import FilteringBoundLogger

from .config import get_settings


def configure_logging() -> FilteringBoundLogger:
    """
    Configure structured logging for the application.

    This function sets up:
    1. Standard library logging configuration
    2. Structlog configuration with JSON formatting
    3. Log level based on application settings
    4. Request correlation IDs

    Returns:
        FilteringBoundLogger: Configured logger instance
    """
    settings = get_settings()

    # Configure standard library logging
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, settings.log_level.upper()),
    )

    # Configure structlog
    structlog.configure(
        processors=[
            # Add correlation ID and timestamp
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            # Add timestamp in ISO format
            structlog.processors.TimeStamper(fmt="iso"),
            # Add stack info for exceptions
            structlog.processors.StackInfoRenderer(),
            # Format exceptions
            structlog.processors.format_exc_info,
            # Convert to JSON for structured logging
            structlog.processors.JSONRenderer()
            if not settings.debug
            else structlog.dev.ConsoleRenderer(colors=True),
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    logger = structlog.get_logger("ai_services")

    # Log startup configuration
    logger.info(
        "Logging configured",
        log_level=settings.log_level,
        debug_mode=settings.debug,
        app_name=settings.app_name,
        app_version=settings.app_version,
    )

    return logger


def get_logger(name: str) -> FilteringBoundLogger:
    """Get a named logger instance.

    Args:
        name: Logger name (typically module name)

    Returns:
        FilteringBoundLogger: Named logger instance
    """
    return structlog.get_logger(name)


class LoggerMixin:
    """
    Mixin class to add logging capability to any class.

    Usage:
        class MyService(LoggerMixin):
            def do_something(self):
                self.logger.info("Doing something", user_id="123")
    """

    @property
    def logger(self) -> FilteringBoundLogger:
        """Get logger for this class."""
        return get_logger(self.__class__.__name__)
