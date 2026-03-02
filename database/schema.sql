-- ============================================================
-- RESOLVIT - Civic Resolution Platform
-- Database Schema v1.0
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text similarity search

-- ============================================================
-- USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username    VARCHAR(64) UNIQUE NOT NULL,
    email       VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role        VARCHAR(32) NOT NULL DEFAULT 'citizen'
                  CHECK (role IN ('citizen', 'authority', 'admin')),
    full_name   VARCHAR(128),
    department  VARCHAR(128),       -- For authority users
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
    
);

CREATE INDEX idx_users_email  ON users(email);
CREATE INDEX idx_users_role   ON users(role);

-- ============================================================
-- ISSUES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS issues (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title                   VARCHAR(256) NOT NULL,
    description             TEXT NOT NULL,
    category                VARCHAR(64) NOT NULL
                              CHECK (category IN ('Roads','Water','Electricity','Sanitation','Safety','Environment','Other')),
    latitude                DOUBLE PRECISION,
    longitude               DOUBLE PRECISION,
    urgency                 SMALLINT NOT NULL DEFAULT 3
                              CHECK (urgency BETWEEN 1 AND 5),
    impact_scale            INTEGER NOT NULL DEFAULT 1,
    image_url               TEXT,
    status                  VARCHAR(32) NOT NULL DEFAULT 'reported'
                              CHECK (status IN ('reported','verified','clustered','assigned',
                                                'in_progress','escalated','resolved')),
    priority_score          FLOAT DEFAULT 0.0,
    safety_risk_probability FLOAT DEFAULT 0.1,
    -- SLA Engine
    sla_hours               INTEGER DEFAULT 48,
    sla_expires_at          TIMESTAMPTZ,
    -- Community engagement
    upvotes                 INTEGER DEFAULT 0,
    report_count            INTEGER DEFAULT 1,
    escalation_level        SMALLINT DEFAULT 0,
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
CREATE INDEX idx_issues_category       ON issues(category);
CREATE INDEX idx_issues_reporter       ON issues(reporter_id);
CREATE INDEX idx_issues_authority      ON issues(assigned_authority_id);
CREATE INDEX idx_issues_created_at     ON issues(created_at DESC);
CREATE INDEX idx_issues_location       ON issues(latitude, longitude);
-- Text search index
CREATE INDEX idx_issues_title_trgm     ON issues USING GIN (title gin_trgm_ops);

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
    cluster_radius  FLOAT DEFAULT 100.0,  -- meters
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Back-reference from issues to clusters
ALTER TABLE issues ADD CONSTRAINT fk_issues_cluster
    FOREIGN KEY (cluster_id) REFERENCES issue_clusters(id) ON DELETE SET NULL;

-- ============================================================
-- ESCALATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS escalations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    issue_id        UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    escalated_by    UUID REFERENCES users(id),
    reason          TEXT,
    previous_status VARCHAR(32),
    escalated_at    TIMESTAMPTZ DEFAULT NOW(),
    acknowledged    BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES users(id)
);

CREATE INDEX idx_escalations_issue   ON escalations(issue_id);
CREATE INDEX idx_escalations_time    ON escalations(escalated_at DESC);

-- ============================================================
-- AUDIT LOGS TABLE (Blockchain Simulation)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    issue_id        UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    event_type      VARCHAR(64) NOT NULL,   -- created, updated, escalated, resolved, clustered
    actor_id        UUID REFERENCES users(id),
    old_value       JSONB,
    new_value       JSONB,
    hash            VARCHAR(64) NOT NULL,   -- SHA256 of (prev_hash + payload)
    previous_hash   VARCHAR(64),            -- Link to previous block
    timestamp       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_issue    ON audit_logs(issue_id);
CREATE INDEX idx_audit_time     ON audit_logs(timestamp DESC);
-- Ensure chain integrity — no update allowed on audit_logs

-- ============================================================
-- AUTHORITY METRICS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS authority_metrics (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    authority_id        UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    total_assigned      INTEGER DEFAULT 0,
    total_resolved      INTEGER DEFAULT 0,
    total_escalated     INTEGER DEFAULT 0,
    avg_response_time   FLOAT DEFAULT 0.0,  -- Hours
    avg_resolution_time FLOAT DEFAULT 0.0,  -- Hours
    resolution_rate     FLOAT DEFAULT 0.0,  -- 0.0 to 1.0
    escalation_rate     FLOAT DEFAULT 0.0,  -- 0.0 to 1.0
    performance_score   FLOAT DEFAULT 100.0, -- 0-100
    last_calculated_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_metrics_authority ON authority_metrics(authority_id);
CREATE INDEX idx_metrics_perf      ON authority_metrics(performance_score DESC);

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

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_issues_updated_at
    BEFORE UPDATE ON issues
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_clusters_updated_at
    BEFORE UPDATE ON issue_clusters
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_metrics_updated_at
    BEFORE UPDATE ON authority_metrics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CIVIC CREDITS TABLE (Gamified Engagement Ledger)
-- ============================================================
CREATE TABLE IF NOT EXISTS civic_credits (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issue_id    UUID REFERENCES issues(id) ON DELETE SET NULL,
    action_type VARCHAR(64) NOT NULL
                  CHECK (action_type IN ('report_issue','upvote','issue_resolved','helpful_evidence','community_mark')),
    points      INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_credits_user   ON civic_credits(user_id);
CREATE INDEX idx_credits_issue  ON civic_credits(issue_id);
CREATE INDEX idx_credits_time   ON civic_credits(created_at DESC);

-- ============================================================
-- APP FEEDBACK TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS app_feedback (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ui_rating       SMALLINT NOT NULL CHECK (ui_rating BETWEEN 1 AND 5),
    ux_rating       SMALLINT NOT NULL CHECK (ux_rating BETWEEN 1 AND 5),
    experience_rating SMALLINT NOT NULL CHECK (experience_rating BETWEEN 1 AND 5),
    comment         TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_feedback_user ON app_feedback(user_id);
