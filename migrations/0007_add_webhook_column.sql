-- This migration adds a new column 'webhook_url' to the 'bulk_jobs' table to store the URL for webhook notifications.

ALTER TABLE bulk_jobs ADD COLUMN webhook_url VARCHAR(255);