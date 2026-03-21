"""
RESOLVIT API
Production-ready FastAPI entry point
"""

import os
from datetime import datetime, timezone, timezone as dt_timezone
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from apscheduler.schedulers.background import BackgroundScheduler
from slowapi.errors import RateLimitExceeded

# Load .env locally (NOT on Render)
if os.getenv("RENDER") is None:
    load_dotenv()

# -----------------------------
# Import internal modules
# -----------------------------
from core.exceptions import (
    global_exception_handler, value_error_handler, http_exception_handler
)
from starlette.exceptions import HTTPException as StarletteHTTPException
from core.security import limiter, rate_limit_exceeded_handler
from core.config import settings

from routes.auth_routes import router as auth_router
from routes.issues import router as issues_router
from routes.audit_metrics import audit_router, metrics_router
from routes.admin_routes import router as admin_router
from routes.credits_routes import router as credits_router
from routes.simulation import router as simulation_router
from routes.export_routes import router as export_router
from routes.feedback_routes import router as feedback_router
from routes.image_routes import router as image_router
from database import execute_schema

# -----------------------------
# Lifecycle (Startup/Shutdown)
# -----------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- STARTUP ---
    
    # 1. Sync Schema
    try:
        execute_schema()
        print("[DB] Schema sync complete.")
    except Exception as e:
        print(f"[DB] Schema sync failed: {e}")

    # 2. Validate Email Config
    from services.email_service import RESEND_API_KEY, RESEND_FROM_EMAIL, is_placeholder
    if not RESEND_API_KEY or is_placeholder(RESEND_API_KEY) or not RESEND_FROM_EMAIL:
        print("[EMAIL-FAILURE] Email system misconfigured")
    else:
        print("[EMAIL-TRACE] Email system ready")

    # 3. Start Scheduler
    from services.escalation import run_escalation_check
    from services.priority import recalculate_all_priorities
    from services.pressure import recalculate_all_pressure_scores, run_anomaly_detection

    scheduler = BackgroundScheduler()
    scheduler.add_job(run_escalation_check,            "interval", minutes=10, id="escalation_job")
    scheduler.add_job(recalculate_all_priorities,      "interval", minutes=30, id="priority_job")
    scheduler.add_job(recalculate_all_pressure_scores, "interval", minutes=15, id="pressure_job")
    scheduler.add_job(run_anomaly_detection,           "interval", minutes=60, id="anomaly_job")
    scheduler.start()
    print("[Scheduler] Started successfully")

    yield
    
    # --- SHUTDOWN ---
    scheduler.shutdown()
    print("[Scheduler] Shutdown complete")

# -----------------------------
# FastAPI App
# -----------------------------
app = FastAPI(
    title="RESOLVIT API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan
)

# -----------------------------
# Rate Limiter
# -----------------------------
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

# -----------------------------
# Global Exception Handlers
# -----------------------------
app.add_exception_handler(Exception, global_exception_handler)
app.add_exception_handler(ValueError, value_error_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)

# -----------------------------
# CORS Middleware
# -----------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# -----------------------------
# Routers
# -----------------------------
app.include_router(auth_router,       prefix="/api/auth",       tags=["Auth"])
app.include_router(auth_router,       prefix="/api/user",       tags=["User Profile Aliases"])

app.include_router(issues_router,     prefix="/api/issues",     tags=["Issues"])
app.include_router(issues_router,     prefix="/api/admin/issues", tags=["Admin Issue Aliases"])

app.include_router(export_router,     prefix="/api/export",     tags=["Exports"])
app.include_router(audit_router,      prefix="/api/audit",      tags=["Audit"])
app.include_router(metrics_router,    prefix="/api/metrics",    tags=["Metrics"])
app.include_router(admin_router,      prefix="/api/admin",      tags=["Admin"])
app.include_router(credits_router,    prefix="/api/credits",    tags=["Credits"])
app.include_router(simulation_router, prefix="/api/simulation", tags=["Demo/Simulation"])
app.include_router(feedback_router,   prefix="/api/feedback",   tags=["Feedback"])
app.include_router(image_router,      prefix="/api/images",     tags=["Images"])

# -----------------------------
# Health Check
# -----------------------------
@app.get("/")
def root():
    return {"status": "RESOLVIT API running"}

@app.get("/api/health")
def health():
    return {
        "success": True,
        "service": "backend",
        "status": "online",
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
