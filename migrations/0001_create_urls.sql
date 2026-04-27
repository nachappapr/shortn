

-- Migration: 0001_create_urls
-- Description: Create the urls table to store shortened URL mappings
-- Created: 2024
-- Purpose: Initialize the database schema with the primary urls table containing
--          short codes, original URLs, and creation timestamps

CREATE TABLE IF NOT EXISTS urls (
    code TEXT PRIMARY KEY,
    original_url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)