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
    Initialize database schema from schema.sql on startup.
    """
    schema_path = os.path.join(
        os.path.dirname(__file__),
        '..',
        'database',
        'schema.sql'
    )

    if os.path.exists(schema_path):
        with get_db() as cursor:
            with open(schema_path, 'r') as f:
                cursor.execute(f.read())
        print("[DB] Schema initialized successfully.")
    else:
        print("[DB] No schema.sql file found. Skipping schema initialization.")
