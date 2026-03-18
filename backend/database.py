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
    Uses separate blocks to ensure one failing statement doesn't block the rest.
    """
    schema_path = os.path.join(
        os.path.dirname(__file__),
        '..',
        'database',
        'schema.sql'
    )

    # 1. Attempt to run base schema
    # We use a single block, but if it fails (e.g. index exists), we continue
    if os.path.exists(schema_path):
        try:
            with get_db() as cursor:
                # To handle potential multi-statement issues, we could split by semicolon
                # but for now we just try the whole file. If it fails, migrations will catch the gap.
                with open(schema_path, 'r') as f:
                    cursor.execute(f.read())
            print("[DB] Base schema applied or already present.")
        except Exception as e:
            print(f"[DB] Base schema init note: {e}")

    # 2. Manual Migrations (Run each independently so failures don't cascade)
    print("[DB] Running migrations...")
    
    migrations = [
        # User Table
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(32) DEFAULT 'database';",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture TEXT;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS points_cache INTEGER DEFAULT 0;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(255);",
        
        # Issues Table
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS sla_hours INTEGER DEFAULT 48;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS sla_expires_at TIMESTAMPTZ;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS safety_risk_probability FLOAT DEFAULT 0.1;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS cluster_id UUID;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolution_note TEXT;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS impact_scale INTEGER DEFAULT 1;",
        
        # Constraints/Foreign Keys (just in case)
        "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_issues_cluster') THEN ALTER TABLE issues ADD CONSTRAINT fk_issues_cluster FOREIGN KEY (cluster_id) REFERENCES issue_clusters(id) ON DELETE SET NULL; END IF; END $$;",
    ]

    for sql in migrations:
        try:
            with get_db() as cursor:
                cursor.execute(sql)
        except Exception as e:
            print(f"[DB Migration Warning] Failed to run: {sql[:50]}... Error: {e}")
    
    print("[DB] Migrations complete.")
