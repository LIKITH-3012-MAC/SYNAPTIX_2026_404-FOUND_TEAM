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

from routes.auth_routes import router as auth_router
from routes.issues import router as issues_router
from routes.audit_metrics import audit_router, metrics_router
from routes.admin_routes import router as admin_router

app = FastAPI(
    title="RESOLVIT API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc"
)

CORS_ORIGINS = [
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:3000",
    "https://synaptix.vercel.app",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/auth", tags=["Auth"])
app.include_router(issues_router, prefix="/api/issues", tags=["Issues"])
app.include_router(audit_router, prefix="/api/audit", tags=["Audit"])
app.include_router(metrics_router, prefix="/api/metrics", tags=["Metrics"])
app.include_router(admin_router, prefix="/api/admin", tags=["Admin"])

@app.get("/")
def root():
    return {"status": "RESOLVIT API running"}

@app.get("/api/health")
def health():
    return {"status": "healthy"}

scheduler = BackgroundScheduler()

@app.on_event("startup")
def start_scheduler():
    scheduler.start()

@app.on_event("shutdown")
def shutdown_scheduler():
    scheduler.shutdown()
