"""
RESOLVIT - Database Configuration
Initializes PostgreSQL connection pool via psycopg2
Production-ready for Render deployment
"""

import os
import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import pool
from contextlib import contextmanager
from dotenv import load_dotenv

# ─────────────────────────────────────────────
# Load .env ONLY in local development
# Render automatically injects environment vars
# ─────────────────────────────────────────────
if os.getenv("RENDER") is None:
    load_dotenv(override=True)

# ─────────────────────────────────────────────
# Database URL (Required)
# ─────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError(
        "[RESOLVIT] DATABASE_URL is not set.\n"
        "Set DATABASE_URL in Render Environment Variables "
        "or create backend/.env locally."
    )

# ─────────────────────────────────────────────
# Connection Pool
# ─────────────────────────────────────────────
_pool = None


def init_pool():
    """Initialize PostgreSQL connection pool."""
    global _pool
    if _pool is None:
        print(f"[DB DEBUG] Initializing pool with DSN: {DATABASE_URL}")
        _pool = pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=20,
            dsn=DATABASE_URL,
            cursor_factory=RealDictCursor
        )
        print("[DB] Connection pool initialized.")
    return _pool


# ─────────────────────────────────────────────
# Database Context Manager
# ─────────────────────────────────────────────
@contextmanager
def get_db():
    """
    Provides a database cursor.
    Automatically commits or rolls back.
    """
    connection_pool = init_pool()
    conn = connection_pool.getconn()

    try:
        conn.autocommit = False
        cursor = conn.cursor()
        yield cursor
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cursor.close()
        connection_pool.putconn(conn)


# ─────────────────────────────────────────────
# Schema Initialization (Optional)
# ─────────────────────────────────────────────
def execute_schema():
    """
    Initialize database schema and perform migrations (add missing columns).
    """
    schema_path = os.path.join(
        os.path.dirname(__file__),
        '..',
        'database',
        'schema.sql'
    )

    with get_db() as cursor:
        # 1. Run base schema if exists
        if os.path.exists(schema_path):
            with open(schema_path, 'r') as f:
                cursor.execute(f.read())
            print("[DB] Base schema applied.")

        # 2. Manual Migrations (Ensure new columns exist in existing tables)
        print("[DB] Running migrations...")
        
        # User Table Migrations
        cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(32) DEFAULT 'database';")
        cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture TEXT;")
        cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS points_cache INTEGER DEFAULT 0;")
        cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;")
        
        # Issues Table Migrations
        cursor.execute("ALTER TABLE issues ADD COLUMN IF NOT EXISTS sla_hours INTEGER DEFAULT 48;")
        cursor.execute("ALTER TABLE issues ADD COLUMN IF NOT EXISTS sla_expires_at TIMESTAMPTZ;")
        cursor.execute("ALTER TABLE issues ADD COLUMN IF NOT EXISTS safety_risk_probability FLOAT DEFAULT 0.1;")
        cursor.execute("ALTER TABLE issues ADD COLUMN IF NOT EXISTS cluster_id UUID;")
        cursor.execute("ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolution_note TEXT;")
        cursor.execute("ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;")
        
        print("[DB] Migrations complete.")
