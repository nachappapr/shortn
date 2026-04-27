
-- This migration adds a unique constraint to the original_url column in the urls table.
-- This ensures that each original URL can only be shortened once, preventing duplicate entries.

DELETE FROM urls
WHERE code IN (
    SELECT code
    FROM (
SELECT code, ROW_NUMBER() OVER (PARTITION BY original_url ORDER BY created_at DESC) AS rn
FROM urls
) sub
WHERE rn > 1
);


ALTER TABLE urls
ADD CONSTRAINT unique_original_url UNIQUE (original_url);


