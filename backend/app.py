"""
RESOLVIT API
Entry point: registers all routers, CORS, background scheduler, startup events
"""

import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv

load_dotenv()

# ──────────────────────────────────────────────────────────────
# Routers
# ──────────────────────────────────────────────────────────────
from routes.auth_routes import router as auth_router
from routes.issues import router as issues_router
from routes.audit_metrics import audit_router, metrics_router
from routes.admin_routes import router as admin_router  # ✅ NEW

# ──────────────────────────────────────────────────────────────
# App Setup
# ──────────────────────────────────────────────────────────────
app = FastAPI(
    title="RESOLVIT API",
    description="Civic Resolution Platform — From Complaint to Completion.",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc"
)

# ──────────────────────────────────────────────────────────────
# CORS Configuration
# ──────────────────────────────────────────────────────────────
ALLOWED_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ──────────────────────────────────────────────────────────────
# Register Routers
# ──────────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(issues_router)
app.include_router(audit_router)
app.include_router(metrics_router)
app.include_router(admin_router, prefix="/api/admin", tags=["Admin"])  # ✅ NEW

# ──────────────────────────────────────────────────────────────
# Background Scheduler
# ──────────────────────────────────────────────────────────────
scheduler = BackgroundScheduler(timezone="UTC")


@app.on_event("startup")
def startup_event():
    """Initialize DB and start background tasks on server launch."""
    from database import init_pool
    init_pool()
    print("[RESOLVIT] Database pool initialized.")

    from services.escalation import run_escalation_check, update_authority_metrics
    from services.priority import recalculate_all_priorities

    scheduler.add_job(
        run_escalation_check,
        "interval",
        hours=1,
        id="escalation_check"
    )

    scheduler.add_job(
        update_authority_metrics,
        "interval",
        hours=1,
        id="metrics_update"
    )

    scheduler.add_job(
        recalculate_all_priorities,
        "interval",
        hours=6,
        id="priority_recalc"
    )

    scheduler.start()
    print("[RESOLVIT] Background scheduler started.")


@app.on_event("shutdown")
def shutdown_event():
    scheduler.shutdown()
    print("[RESOLVIT] Scheduler stopped.")


# ──────────────────────────────────────────────────────────────
# Global Error Handler
# ──────────────────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_error_handler(request: Request, exc: Exception):
    print(f"[ERROR] {exc}")  # Log to console
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"}
    )


# ──────────────────────────────────────────────────────────────
# Health Check
# ──────────────────────────────────────────────────────────────
@app.get("/api/health", tags=["System"])
def health_check():
    return {
        "status": "healthy",
        "service": "RESOLVIT API",
        "version": "1.0.0"
    }


# ──────────────────────────────────────────────────────────────
# Run Entry Point
# ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        reload=True,
        workers=1
    )
