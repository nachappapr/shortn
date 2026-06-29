CREATE TABLE bulk_job_items(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES bulk_jobs(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    url_id BIGINT REFERENCES urls(id) ON DELETE SET NULL,
    status job_result_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)

CREATE INDEX idx_items_resume ON bulk_job_items (job_id) WHERE status = 'pending';