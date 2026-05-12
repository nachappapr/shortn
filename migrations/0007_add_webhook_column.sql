-- This migration adds a new column 'webhook_url' to the 'bulk_jobs' table to store the URL for webhook notifications.

-- To apply this migration, run the following command:
-- psql "postgresql://postgres:cyOEDD0TXCRMS6R354S2@shortn.cbqmqa0ummk8.us-east-1.rds.amazonaws.com:5432/postgres" -f 0001_create_urls.sql
-- psql "postgresql://postgres:cyOEDD0TXCRMS6R354S2@shortn.cbqmqa0ummk8.us-east-1.rds.amazonaws.com:5432/postgres" -f 0002_unique_original_url.sql
-- psql "postgresql://postgres:cyOEDD0TXCRMS6R354S2@shortn.cbqmqa0ummk8.us-east-1.rds.amazonaws.com:5432/postgres" -f 0003_add_id_to_urls.sql
-- psql "postgresql://postgres:cyOEDD0TXCRMS6R354S2@shortn.cbqmqa0ummk8.us-east-1.rds.amazonaws.com:5432/postgres" -f 0004_add_idempotent_keys.sql
-- psql "postgresql://postgres:cyOEDD0TXCRMS6R354S2@shortn.cbqmqa0ummk8.us-east-1.rds.amazonaws.com:5432/postgres" -f 0005_add_bulk_job.sql
-- psql "postgresql://postgres:cyOEDD0TXCRMS6R354S2@shortn.cbqmqa0ummk8.us-east-1.rds.amazonaws.com:5432/postgres" -f 0006_add_error_column.sql
-- psql "postgresql://postgres:cyOEDD0TXCRMS6R354S2@shortn.cbqmqa0ummk8.us-east-1.rds.amazonaws.com:5432/postgres" -f 0007_add_webhook_column.sql



ALTER TABLE bulk_jobs ADD COLUMN webhook_url VARCHAR(255);