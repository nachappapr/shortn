-- Migration to add an auto-incrementing ID column to the urls table
-- This will allow us to have a unique identifier for each URL entry, 
-- which can be useful for cursor pagination and other operations.

ALTER TABLE urls
ADD COLUMN id BIGSERIAL;

-- Create an index on the code column to improve lookup performance
CREATE INDEX idx_urls_id ON urls(id);