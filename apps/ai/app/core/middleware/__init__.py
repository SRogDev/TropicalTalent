"""Middleware package for app.core.

Place middleware modules (CORS, auth, logging) here.
"""

from .cors import setup_cors

__all__ = ["setup_cors"]
