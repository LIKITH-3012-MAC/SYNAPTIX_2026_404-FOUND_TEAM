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
            minconn=5,
            maxconn=100,
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
        # User Table Extensions
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS trust_score INTEGER DEFAULT 100;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(255);",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(32) DEFAULT 'database';",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture TEXT;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS points_cache INTEGER DEFAULT 0;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS district VARCHAR(128);",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS rank VARCHAR(32) DEFAULT 'New Citizen';",
        
        # New Tables
        """
        CREATE TABLE IF NOT EXISTS authorities (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            name VARCHAR(128) NOT NULL,
            department VARCHAR(128) NOT NULL,
            region VARCHAR(128),
            status VARCHAR(32) DEFAULT 'active',
            email VARCHAR(128),
            phone VARCHAR(32),
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS issue_attachments (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
            file_url TEXT NOT NULL,
            file_name VARCHAR(255),
            mime_type VARCHAR(64),
            file_type VARCHAR(32),
            uploaded_by UUID REFERENCES users(id),
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS issue_history (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
            action_type VARCHAR(64) NOT NULL,
            old_value JSONB,
            new_value JSONB,
            note TEXT,
            actor_id UUID REFERENCES users(id),
            actor_role VARCHAR(32),
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS citizen_activity (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            issue_id UUID REFERENCES issues(id) ON DELETE SET NULL,
            action VARCHAR(64) NOT NULL,
            credits_delta INTEGER DEFAULT 0,
            note TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            admin_id UUID NOT NULL REFERENCES users(id),
            entity_type VARCHAR(64) NOT NULL,
            entity_id UUID,
            action VARCHAR(64) NOT NULL,
            old_value JSONB,
            new_value JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,

        # Issues Table Extensions
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS tracking_id VARCHAR(32) UNIQUE;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS subcategory VARCHAR(64);",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS address TEXT;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS ward VARCHAR(64);",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS district VARCHAR(64);",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS state VARCHAR(64);",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS pincode VARCHAR(16);",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS severity SMALLINT DEFAULT 3;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS ai_risk FLOAT DEFAULT 0.0;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS civic_impact_score FLOAT DEFAULT 0.0;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS sla_hours INTEGER DEFAULT 48;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS sla_expires_at TIMESTAMPTZ;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS support_count INTEGER DEFAULT 0;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS source VARCHAR(32) DEFAULT 'web';",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS visibility VARCHAR(32) DEFAULT 'public';",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS is_fake BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolution_note TEXT;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS pressure_score FLOAT DEFAULT 0.0;",
        "ALTER TABLE issues ADD COLUMN IF NOT EXISTS priority_manual_override BOOLEAN DEFAULT FALSE;",
        
        # New Tables
        """
        CREATE TABLE IF NOT EXISTS anomalies (
            id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            authority_id    UUID REFERENCES users(id) ON DELETE CASCADE,
            anomaly_type    VARCHAR(64) NOT NULL,
            description     TEXT,
            severity        VARCHAR(32) DEFAULT 'warning',
            is_resolved     BOOLEAN DEFAULT FALSE,
            created_at      TIMESTAMPTZ DEFAULT NOW()
        );
        """,

        # User Indexes
        "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);",
        "CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);",
        "CREATE INDEX IF NOT EXISTS idx_users_points ON users(points_cache DESC);",
        "CREATE INDEX IF NOT EXISTS idx_users_status ON users(is_suspended, is_active);",
        "CREATE INDEX IF NOT EXISTS idx_issues_pressure_score ON issues(pressure_score DESC);",
        
        # Image BLOB Store (persistent storage for Render)
        """
        CREATE TABLE IF NOT EXISTS image_store (
            id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            data          BYTEA NOT NULL,
            mime_type     VARCHAR(64) NOT NULL DEFAULT 'image/jpeg',
            original_name VARCHAR(255),
            size_bytes    INTEGER,
            created_at    TIMESTAMPTZ DEFAULT NOW()
        );
        """,

        # Adjusting Constraints
        "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_issues_cluster') THEN ALTER TABLE issues ADD CONSTRAINT fk_issues_cluster FOREIGN KEY (cluster_id) REFERENCES issue_clusters(id) ON DELETE SET NULL; END IF; END $$;",
    ]

    for sql in migrations:
        try:
            with get_db() as cursor:
                cursor.execute(sql)
        except Exception as e:
            # We cast sql to string just in case, though it is usually a string
            sql_str = str(sql)
            print(f"[DB Migration Warning] Failed to run: {sql_str[:50]}... Error: {e}")
    
    print("[DB] Migrations complete.")
