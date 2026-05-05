
-- Migration to add bulk job and bulk job results tables
-- This will allow us to track the status of bulk URL shortening jobs and their results.

CREATE TYPE job_status AS ENUM ('pending', 'partial', 'failed', 'completed', 'processing');
CREATE TYPE job_result_status AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TABLE bulk_jobs(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status job_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bulk_job_results(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES bulk_jobs(id) ON DELETE CASCADE,
    url_id BIGINT REFERENCES urls(id) ON DELETE CASCADE,
    status job_result_status NOT NULL DEFAULT 'queued',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
);

ALTER TABLE bulk_job_results ADD COLUMN original_url TEXT NOT NULL;
