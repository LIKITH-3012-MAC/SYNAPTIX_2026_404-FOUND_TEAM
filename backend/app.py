"""
RESOLVIT API
Production-ready FastAPI entry point
"""

import os
from datetime import datetime, timezone
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
from core.exceptions import global_exception_handler, value_error_handler
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
from database import execute_schema

# -----------------------------
# FastAPI App
# -----------------------------
app = FastAPI(
    title="RESOLVIT API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc"
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

# -----------------------------
# CORS Middleware
# -----------------------------
origins = [
    "http://localhost:8000",
    "http://localhost:3000",
    "http://127.0.0.1:8000",
    "https://resolvit-app-2026.vercel.app",
    "https://resolvit-app-2026.vercel.app/",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
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
app.include_router(auth_router,       prefix="/api/user",       tags=["User Profile Aliases"]) # ALIAS for /api/user/profile

app.include_router(issues_router,     prefix="/api/issues",     tags=["Issues"])
app.include_router(issues_router,     prefix="/api/admin/issues", tags=["Admin Issue Aliases"]) # ALIAS for /api/admin/issues/:id

app.include_router(export_router,     prefix="/api/export",     tags=["Exports"])
app.include_router(audit_router,      prefix="/api/audit",      tags=["Audit"])
app.include_router(metrics_router,    prefix="/api/metrics",    tags=["Metrics"])
app.include_router(admin_router,      prefix="/api/admin",      tags=["Admin"])
app.include_router(credits_router,    prefix="/api/credits",    tags=["Credits"])
app.include_router(simulation_router, prefix="/api/simulation", tags=["Demo/Simulation"])
app.include_router(feedback_router,   prefix="/api/feedback",   tags=["Feedback"])

# -----------------------------
# Basic Routes
# -----------------------------
@app.get("/")
def root():
    return {"status": "RESOLVIT API running"}

@app.get("/api/health")
def health():
    return {
        "status": "online",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": "1.0.0",
        "system": "RESOLVIT Engine"
    }

# -----------------------------
# Background Scheduler
# -----------------------------
scheduler = BackgroundScheduler()

@app.on_event("startup")
def start_up():
    # Sync Schema
    try:
        execute_schema()
        print("[DB] Schema sync complete.")
    except Exception as e:
        print(f"[DB] Schema sync failed: {e}")

@app.on_event("startup")
def start_scheduler():
    from services.escalation import run_escalation_check
    from services.priority import recalculate_all_priorities
    from services.pressure import (
        recalculate_all_pressure_scores,
        run_anomaly_detection
    )

    scheduler.add_job(run_escalation_check,            "interval", minutes=10, id="escalation_job")
    scheduler.add_job(recalculate_all_priorities,      "interval", minutes=30, id="priority_job")
    scheduler.add_job(recalculate_all_pressure_scores, "interval", minutes=15, id="pressure_job")
    scheduler.add_job(run_anomaly_detection,           "interval", minutes=60, id="anomaly_job")

    scheduler.start()
    print("[Scheduler] Started successfully")

@app.on_event("shutdown")
def shutdown_scheduler():
    scheduler.shutdown()
    print("[Scheduler] Shutdown complete")
