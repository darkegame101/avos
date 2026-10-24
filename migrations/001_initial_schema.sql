-- 001_initial_schema.sql: AVOS Datastore Schema

CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    budget_ceiling_usd NUMERIC(10, 2) NOT NULL DEFAULT 50.00,
    spent_usd NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
    action_class VARCHAR(64) NOT NULL,
    target_resource VARCHAR(512),
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key VARCHAR(128) UNIQUE,
    estimated_cost_usd NUMERIC(10, 4) NOT NULL DEFAULT 0.0,
    actual_cost_usd NUMERIC(10, 4) NOT NULL DEFAULT 0.0,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    evidence JSONB,
    error_details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_transitions (
    id VARCHAR(64) PRIMARY KEY,
    task_id VARCHAR(64) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    from_status VARCHAR(32) NOT NULL,
    to_status VARCHAR(32) NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_requests (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id VARCHAR(64) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    action_class VARCHAR(64) NOT NULL,
    target_resource VARCHAR(512) NOT NULL,
    parameters_hash VARCHAR(64) NOT NULL,
    rationale TEXT NOT NULL,
    estimated_cost_usd NUMERIC(10, 2) NOT NULL DEFAULT 0.0,
    budget_ceiling_usd NUMERIC(10, 2) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    approved_by VARCHAR(128),
    approved_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policy_rules (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    action_class VARCHAR(64) NOT NULL,
    allowed BOOLEAN NOT NULL DEFAULT FALSE,
    requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_project_action UNIQUE (project_id, action_class)
);

CREATE TABLE IF NOT EXISTS budget_ledger (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id VARCHAR(64) REFERENCES tasks(id) ON DELETE SET NULL,
    entry_type VARCHAR(32) NOT NULL,
    amount_usd NUMERIC(10, 4) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
    id VARCHAR(64) PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    actor VARCHAR(128) NOT NULL,
    project_id VARCHAR(64),
    task_id VARCHAR(64),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    prev_event_hash VARCHAR(64),
    event_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    key VARCHAR(128) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    response_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS worker_leases (
    task_id VARCHAR(64) PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    worker_id VARCHAR(128) NOT NULL,
    lease_expires_at TIMESTAMPTZ NOT NULL,
    heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS emergency_stop_state (
    scope VARCHAR(64) PRIMARY KEY,
    is_stopped BOOLEAN NOT NULL DEFAULT FALSE,
    reason TEXT,
    activated_by VARCHAR(128),
    activated_at TIMESTAMPTZ,
    deactivated_by VARCHAR(128),
    deactivated_at TIMESTAMPTZ
);

-- Seed default global emergency stop row
INSERT INTO emergency_stop_state (scope, is_stopped, reason)
VALUES ('GLOBAL', FALSE, 'Initial system startup')
ON CONFLICT (scope) DO NOTHING;
