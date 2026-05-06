-- name: Add error column to bulk_job_results
-- This migration adds an error column to the bulk_job_results table to store any error messages that may occur during the processing of bulk URL shortening jobs.
-- It also adds a check constraint to ensure that the original_url column in the urls table starts with "http".

ALTER TABLE bulk_job_results ADD COLUMN error TEXT;

ALTER TABLE urls ADD CONSTRAINT check_url_format
    CHECK (original_url LIKE 'http%' OR original_url LIKE 'https%');