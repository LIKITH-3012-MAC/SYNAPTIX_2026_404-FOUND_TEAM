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
            cursor_factory=RealDictCursor,
            connect_timeout=10,
            keepalives=1,
            keepalives_idle=30,
            keepalives_interval=10,
            keepalives_count=5
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

        # Welcome Email Tracking
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_email_sent BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_email_message_id TEXT;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_email_status VARCHAR(32) DEFAULT 'pending';",
        
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
        
        # User Table Extensions
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider_id VARCHAR(255);",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture TEXT;",

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
        """
        CREATE TABLE IF NOT EXISTS email_audit_logs (
            id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            issue_id       UUID REFERENCES issues(id) ON DELETE SET NULL,
            email_sent     BOOLEAN DEFAULT FALSE,
            status         VARCHAR(32) DEFAULT 'pending',
            recipient      VARCHAR(255) NOT NULL,
            subject        TEXT NOT NULL,
            template_name  VARCHAR(64),
            retry_count    INTEGER DEFAULT 0,
            error_message  TEXT,
            response_body  TEXT,
            resend_message_id VARCHAR(255),
            failed_at      TIMESTAMPTZ,
            created_at     TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        "ALTER TABLE email_audit_logs ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'pending';",
        "ALTER TABLE email_audit_logs ADD COLUMN IF NOT EXISTS template_name VARCHAR(64);",
        "ALTER TABLE email_audit_logs ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;",
        "ALTER TABLE email_audit_logs ADD COLUMN IF NOT EXISTS resend_message_id VARCHAR(255);",
        "ALTER TABLE email_audit_logs ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;",
        "ALTER TABLE email_audit_logs ADD COLUMN IF NOT EXISTS response_body TEXT;",
        """
        CREATE TABLE IF NOT EXISTS password_reset_tokens (

            id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id            UUID REFERENCES users(id) ON DELETE CASCADE,
            email_snapshot     VARCHAR(255) NOT NULL,
            token_hash         VARCHAR(255) NOT NULL,
            expires_at         TIMESTAMPTZ NOT NULL,
            used               BOOLEAN DEFAULT FALSE,
            used_at            TIMESTAMPTZ,
            created_at         TIMESTAMPTZ DEFAULT NOW(),
            requested_ip       VARCHAR(45),
            user_agent         TEXT,
            resend_message_id  VARCHAR(255),
            invalidated_at     TIMESTAMPTZ,
            invalidated_reason VARCHAR(255)
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS email_verification_otps (
            id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            email              VARCHAR(255) NOT NULL,
            otp_hash           VARCHAR(255) NOT NULL,
            expires_at         TIMESTAMPTZ NOT NULL,
            attempt_count      INTEGER DEFAULT 0,
            max_attempts       INTEGER DEFAULT 5,
            verified           BOOLEAN DEFAULT FALSE,
            verified_at        TIMESTAMPTZ,
            created_at         TIMESTAMPTZ DEFAULT NOW(),
            requested_ip       VARCHAR(45),
            user_agent         TEXT,
            resend_message_id  VARCHAR(255),
            purpose            VARCHAR(32),
            invalidated_at     TIMESTAMPTZ,
            invalidated_reason VARCHAR(255)
        );
        """,

        # ─── RESOLVIT CARE EXTENSIONS ──────────────────────────────────────────
        """
        CREATE TABLE IF NOT EXISTS ngos (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            name VARCHAR(255) NOT NULL,
            slug VARCHAR(255) UNIQUE NOT NULL,
            description TEXT,
            specialization VARCHAR(128),
            contact_name VARCHAR(255),
            contact_email VARCHAR(255),
            contact_phone VARCHAR(32),
            operating_region VARCHAR(128),
            district VARCHAR(128),
            address TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            created_by_admin_id UUID REFERENCES users(id),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS ngo_operators (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            ngo_id UUID NOT NULL REFERENCES ngos(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role_within_ngo VARCHAR(64) DEFAULT 'member',
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(ngo_id, user_id)
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS volunteers (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            ngo_id UUID REFERENCES ngos(id) ON DELETE SET NULL,
            full_name VARCHAR(255) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            phone VARCHAR(32),
            skills TEXT,
            languages VARCHAR(255),
            availability_status VARCHAR(64) DEFAULT 'available',
            current_region VARCHAR(128),
            is_verified BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS reports (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            complaint_code VARCHAR(32) UNIQUE NOT NULL,
            user_id UUID NOT NULL REFERENCES users(id),
            title VARCHAR(255) NOT NULL,
            description TEXT NOT NULL,
            category VARCHAR(64) NOT NULL,
            subcategory VARCHAR(64),
            location_text TEXT,
            district VARCHAR(128),
            ward VARCHAR(128),
            latitude FLOAT,
            longitude FLOAT,
            urgency_score INTEGER,
            severity_level INTEGER,
            status VARCHAR(64) DEFAULT 'submitted',
            assigned_ngo_id UUID REFERENCES ngos(id) ON DELETE SET NULL,
            assigned_admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
            resolution_summary TEXT,
            latest_public_update TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            resolved_at TIMESTAMPTZ,
            closed_at TIMESTAMPTZ
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS report_status_history (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
            old_status VARCHAR(64),
            new_status VARCHAR(64) NOT NULL,
            changed_by_user_id UUID REFERENCES users(id),
            changed_by_role VARCHAR(64),
            change_reason TEXT,
            note TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS report_notes (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
            author_user_id UUID NOT NULL REFERENCES users(id),
            author_role VARCHAR(64) NOT NULL,
            note_type VARCHAR(64) DEFAULT 'general',
            visibility_scope VARCHAR(64) DEFAULT 'internal',
            body TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS ngo_assignment_log (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
            ngo_id UUID NOT NULL REFERENCES ngos(id),
            assigned_by_admin_id UUID REFERENCES users(id),
            assignment_reason TEXT,
            assigned_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS care_email_dispatch_log (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
            recipient_email VARCHAR(255) NOT NULL,
            recipient_type VARCHAR(64),
            template_name VARCHAR(64),
            subject TEXT NOT NULL,
            body_snapshot TEXT,
            dispatch_status VARCHAR(64) DEFAULT 'pending',
            provider_message_id VARCHAR(255),
            sent_by_admin_id UUID REFERENCES users(id),
            triggered_by_system BOOLEAN DEFAULT FALSE,
            sent_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS care_audit_log (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            actor_user_id UUID REFERENCES users(id),
            actor_role VARCHAR(64),
            action_type VARCHAR(128) NOT NULL,
            entity_type VARCHAR(64) NOT NULL,
            entity_id UUID,
            metadata_json JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS broadcast_alerts (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            title VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            severity VARCHAR(32) DEFAULT 'info',
            target_region VARCHAR(128),
            target_role VARCHAR(32) DEFAULT 'all',
            created_by_admin_id UUID REFERENCES users(id),
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,
        # ─── END RESOLVIT CARE EXTENSIONS ──────────────────────────────────────

        # User Table Extensions for Direct Twitter
        "ALTER TABLE users ALTER COLUMN email DROP NOT NULL;",
        "ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_user_id VARCHAR(255);",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS twitter_access_token_encrypted TEXT;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS twitter_refresh_token_encrypted TEXT;",
        "CREATE INDEX IF NOT EXISTS idx_users_provider_id ON users(auth_provider, provider_user_id);",

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
