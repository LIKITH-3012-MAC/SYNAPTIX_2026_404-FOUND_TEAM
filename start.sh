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
echo "  🚀 Starting RESOLVIT API Cluster (Load Balanced)"
echo "  📊 API Docs: http://localhost:8000/api/docs"
echo "  🛠️  Workers:  4 (UvicornWorker)"
echo ""

cd "$BACKEND_DIR"
# Use Gunicorn as a process manager for Uvicorn
gunicorn app:app \
    --workers 4 \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:8000 \
    --timeout 120 \
    --keep-alive 5 \
    --access-logformat '%({X-Real-IP}i)s %({X-Forwarded-For)i)s %(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s"' \
    --log-level info
