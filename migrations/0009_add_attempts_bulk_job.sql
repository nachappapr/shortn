ALTER table bulk_jobs ADD COLUMN attempts INT NOT NULL DEFAULT 0;
ALTER table bulk_jobs ADD COLUMN error TEXT;