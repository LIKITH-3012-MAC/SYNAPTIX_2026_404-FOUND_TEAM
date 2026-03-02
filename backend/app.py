"""
RESOLVIT API
Production-ready FastAPI entry point
"""

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from apscheduler.schedulers.background import BackgroundScheduler

# Load .env only locally
if os.getenv("RENDER") is None:
    load_dotenv()


from core.exceptions import global_exception_handler, value_error_handler
from core.security import limiter
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from core.config import settings

from routes.auth_routes import router as auth_router
from routes.issues import router as issues_router
from routes.audit_metrics import audit_router, metrics_router
from routes.admin_routes import router as admin_router
from routes.credits_routes import router as credits_router
from routes.simulation import router as simulation_router

app = FastAPI(
    title="RESOLVIT API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc"
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_exception_handler(Exception, global_exception_handler)
app.add_exception_handler(ValueError, value_error_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router,       prefix="/api/auth",       tags=["Auth"])
app.include_router(issues_router,     prefix="/api/issues",     tags=["Issues"])
app.include_router(audit_router,      prefix="/api/audit",      tags=["Audit"])
app.include_router(metrics_router,    prefix="/api/metrics",    tags=["Metrics"])
app.include_router(admin_router,      prefix="/api/admin",      tags=["Admin"])
app.include_router(credits_router,    prefix="/api/credits",    tags=["Credits"])
app.include_router(simulation_router, prefix="/api/simulation", tags=["Demo/Simulation"])

@app.get("/")
def root():
    return {"status": "RESOLVIT API running"}

@app.get("/api/health")
def health():
    return {"status": "healthy"}

scheduler = BackgroundScheduler()

@app.on_event("startup")
def start_scheduler():
    from services.escalation import run_escalation_check
    from services.priority import recalculate_all_priorities
    from services.pressure import recalculate_all_pressure_scores, run_anomaly_detection
    # Escalation check every 10 minutes
    scheduler.add_job(run_escalation_check,           "interval", minutes=10,  id="escalation_job")
    # Priority recalc every 30 minutes
    scheduler.add_job(recalculate_all_priorities,     "interval", minutes=30,  id="priority_job")
    # Pressure score recalc every 15 minutes
    scheduler.add_job(recalculate_all_pressure_scores,"interval", minutes=15,  id="pressure_job")
    # Anomaly detection every 60 minutes
    scheduler.add_job(run_anomaly_detection,          "interval", minutes=60,  id="anomaly_job")
    scheduler.start()
    print("[Scheduler] Started: escalation(10m) + priority(30m) + pressure(15m) + anomaly(60m)")

@app.on_event("shutdown")
def shutdown_scheduler():
    scheduler.shutdown()
