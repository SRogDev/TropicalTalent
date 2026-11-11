#!/usr/bin/env python3
"""
Startup script for the TropicalTalent AI.

This script provides a convenient way to run the application with proper
configuration and environment setup.
"""

import os
import sys
from pathlib import Path

# Add the app directory to Python path
app_dir = Path(__file__).parent
sys.path.insert(0, str(app_dir))

try:
    from app.main import main

    if __name__ == "__main__":
        main()

except ImportError as e:
    print(f"Failed to import application: {e}")
    print("Make sure all dependencies are installed:")
    print("uv sync")
    sys.exit(1)
except Exception as e:  # pylint: disable=broad-except
    # Catch any unexpected errors during application startup
    print(f"Failed to start application: {e}")
    sys.exit(1)
