#!/bin/bash
# ================================================================
# RESOLVIT — Backend Startup Script
# Usage: ./start.sh
# ================================================================

set -e

BACKEND_DIR="$(cd "$(dirname "$0")/backend" && pwd)"
VENV_DIR="$BACKEND_DIR/venv"

echo ""
echo "  ⚖️  RESOLVIT Backend Startup"
echo "  ================================"
echo ""

# ── 1. Create venv if missing ──────────────────────────────────
if [ ! -d "$VENV_DIR" ]; then
    echo "  📦 Creating virtual environment..."
    PYTHON_CMD="python3"
    if command -v python3.11 &> /dev/null; then
        PYTHON_CMD="python3.11"
    fi
    $PYTHON_CMD -m venv "$VENV_DIR"
    echo "  ✅ venv created using $PYTHON_CMD."
fi

# ── 2. Activate venv ──────────────────────────────────────────
source "$VENV_DIR/bin/activate"
echo "  ✅ venv activated: $VIRTUAL_ENV"

# ── 3. Install/upgrade deps ────────────────────────────────────
echo ""
echo "  📚 Installing dependencies..."
pip install -q --upgrade pip
pip install -q -r "$BACKEND_DIR/requirements.txt"
echo "  ✅ Dependencies installed."

# ── 4. Check .env exists ──────────────────────────────────────
if [ ! -f "$BACKEND_DIR/.env" ]; then
    echo ""
    echo "  ❌ ERROR: backend/.env not found!"
    echo "  Copy backend/.env.example to backend/.env and fill in DATABASE_URL."
    exit 1
fi
echo "  ✅ .env file found."

# ── 5. Start server ───────────────────────────────────────────
echo ""
echo "  🚀 Starting RESOLVIT API on http://localhost:8000"
echo "  📊 API Docs: http://localhost:8000/api/docs"
echo "  ❤️  Health:  http://localhost:8000/api/health"
echo ""
cd "$BACKEND_DIR"
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
