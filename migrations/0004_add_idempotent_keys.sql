--- Add idempotency keys table
-- This table will store idempotency keys for API requests to ensure that duplicate requests with the same key are not processed multiple times. 
-- The combination of user_id, endpoint, and key will be unique to prevent collisions.

CREATE TABLE idempotency_keys (
    key TEXT NOT NULL,
    user_id BIGINT NOT NULL,
    endpoint TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_status INT NOT NULL,
    response_body JSONB,
    response_headers JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, endpoint, key)
)

CREATE INDEX idx_idempotency_keys ON idempotency_keys(created_at);