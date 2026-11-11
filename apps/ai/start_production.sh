#!/bin/bash
# start_production.sh - Start server in production mode with Gunicorn

set -e

echo "🚀 Starting TropicalTalent AI Backend in PRODUCTION mode..."
echo "📦 Using Gunicorn with Uvicorn workers"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found!"
    echo "   Make sure environment variables are set properly."
fi

# Start with Gunicorn
exec uv run gunicorn app.main:app --config gunicorn.conf.py
