-- ============================================================
-- RESOLVIT - Civic Resolution Platform
-- Database Schema v2.0 (Government-Grade Operations)
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text similarity search

-- ============================================================
-- USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username        VARCHAR(64) UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    role            VARCHAR(32) NOT NULL DEFAULT 'citizen'
                      CHECK (role IN ('citizen', 'authority', 'admin')),
    full_name       VARCHAR(128),
    department      VARCHAR(128),       -- For authority users
    is_active       BOOLEAN DEFAULT TRUE,
    is_verified     BOOLEAN DEFAULT FALSE,
    is_suspended    BOOLEAN DEFAULT FALSE,
    trust_score     INTEGER DEFAULT 100,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    
    -- Personalization & Auth persistence
    auth_provider   VARCHAR(32) DEFAULT 'database', -- database, google, github, twitter
    profile_picture TEXT,
    points_cache    INTEGER DEFAULT 0,
    firebase_uid    VARCHAR(255),
    district        VARCHAR(128),
    rank            VARCHAR(32) DEFAULT 'New Citizen'
);

CREATE INDEX IF NOT EXISTS idx_users_email  ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_points ON users(points_cache DESC);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(is_suspended, is_active);

-- ============================================================
-- AUTHORITIES TABLE (Formal Department Registry)
-- ============================================================
CREATE TABLE IF NOT EXISTS authorities (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(128) NOT NULL,
    department  VARCHAR(128) NOT NULL,
    region      VARCHAR(128),
    status      VARCHAR(32) DEFAULT 'active',
    email       VARCHAR(128),
    phone       VARCHAR(32),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ISSUES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS issues (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tracking_id             VARCHAR(32) UNIQUE, -- Real tracking number
    title                   VARCHAR(256) NOT NULL,
    description             TEXT NOT NULL,
    category                VARCHAR(64) NOT NULL,
    subcategory             VARCHAR(64),
    latitude                DOUBLE PRECISION,
    longitude               DOUBLE PRECISION,
    address                 TEXT,
    ward                    VARCHAR(64),
    district                VARCHAR(64),
    state                   VARCHAR(64),
    pincode                 VARCHAR(16),
    urgency                 SMALLINT NOT NULL DEFAULT 3
                               CHECK (urgency BETWEEN 1 AND 5),
    severity                SMALLINT DEFAULT 3,
    impact_scale            INTEGER NOT NULL DEFAULT 1,
    image_url               TEXT,
    status                  VARCHAR(32) NOT NULL DEFAULT 'reported'
                              CHECK (status IN ('reported','verified','clustered','assigned',
                                                'in_progress','escalated','resolved','archived')),
    priority_score          FLOAT DEFAULT 0.0,
    ai_risk                 FLOAT DEFAULT 0.0,
    civic_impact_score      FLOAT DEFAULT 0.0,
    safety_risk_probability FLOAT DEFAULT 0.1,
    
    -- SLA Engine
    sla_hours               INTEGER DEFAULT 48,
    sla_expires_at          TIMESTAMPTZ,
    sla_due_at              TIMESTAMPTZ,
    
    -- Community engagement
    upvotes                 INTEGER DEFAULT 0,
    support_count           INTEGER DEFAULT 0,
    report_count            INTEGER DEFAULT 1,
    escalation_level        SMALLINT DEFAULT 0,
    
    -- Meta
    source                  VARCHAR(32) DEFAULT 'web', -- mobile, web, system
    visibility              VARCHAR(32) DEFAULT 'public', -- public, internal
    is_fake                 BOOLEAN DEFAULT FALSE,
    is_archived             BOOLEAN DEFAULT FALSE,
    
    -- Cluster / Owner
    cluster_id              UUID,
    reporter_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_authority_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    resolution_note         TEXT,
    resolution_proof_url    TEXT,
    
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),
    resolved_at             TIMESTAMPTZ
);

-- Spatial and operational indexes
CREATE INDEX idx_issues_status         ON issues(status);
CREATE INDEX idx_issues_priority_score ON issues(priority_score DESC);
CREATE INDEX idx_issues_reporter       ON issues(reporter_id);
CREATE INDEX idx_issues_authority      ON issues(assigned_authority_id);
CREATE INDEX idx_issues_location       ON issues(latitude, longitude);

-- ============================================================
-- ISSUE ATTACHMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS issue_attachments (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    issue_id    UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    file_url    TEXT NOT NULL,
    file_name   VARCHAR(255),
    mime_type   VARCHAR(64),
    file_type   VARCHAR(32), -- photo, doc, video
    uploaded_by UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ISSUE HISTORY TABLE (Lifecycle Tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS issue_history (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    issue_id    UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    action_type VARCHAR(64) NOT NULL, -- reported, assigned, updated, resolved, etc.
    old_value   JSONB,
    new_value   JSONB,
    note        TEXT,
    actor_id    UUID REFERENCES users(id),
    actor_role  VARCHAR(32),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CITIZEN ACTIVITY TABLE (Reputation Ledger)
-- ============================================================
CREATE TABLE IF NOT EXISTS citizen_activity (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issue_id        UUID REFERENCES issues(id) ON DELETE SET NULL,
    action          VARCHAR(64) NOT NULL,
    credits_delta   INTEGER DEFAULT 0,
    note            TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ADMIN AUDIT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id    UUID NOT NULL REFERENCES users(id),
    entity_type VARCHAR(64) NOT NULL, -- user, issue, authority, config
    entity_id   UUID,
    action      VARCHAR(64) NOT NULL,
    old_value   JSONB,
    new_value   JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ISSUE CLUSTERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS issue_clusters (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    representative_issue_id UUID REFERENCES issues(id) ON DELETE SET NULL,
    total_count     INTEGER DEFAULT 1,
    total_impact    INTEGER DEFAULT 1,
    centroid_lat    DOUBLE PRECISION,
    centroid_lon    DOUBLE PRECISION,
    cluster_radius  FLOAT DEFAULT 100.0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Back-reference from issues to clusters
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_issues_cluster') THEN ALTER TABLE issues ADD CONSTRAINT fk_issues_cluster FOREIGN KEY (cluster_id) REFERENCES issue_clusters(id) ON DELETE SET NULL; END IF; END $$;

-- ============================================================
-- AUTHORITY METRICS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS authority_metrics (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    authority_id        UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    total_assigned      INTEGER DEFAULT 0,
    total_resolved      INTEGER DEFAULT 0,
    total_escalated     INTEGER DEFAULT 0,
    performance_score   FLOAT DEFAULT 100.0,
    last_calculated_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUTO-UPDATE updated_at TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_users_updated_at') THEN CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_issues_updated_at') THEN CREATE TRIGGER update_issues_updated_at BEFORE UPDATE ON issues FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_clusters_updated_at') THEN CREATE TRIGGER update_clusters_updated_at BEFORE UPDATE ON issue_clusters FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_metrics_updated_at') THEN CREATE TRIGGER update_metrics_updated_at BEFORE UPDATE ON authority_metrics FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;
;
