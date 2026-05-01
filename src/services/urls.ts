import { randomBytes } from "node:crypto";
import pool from "../db/db.js";

export async function saveShortUrl(
  originalUrl: string,
): Promise<{ code: string; original_url: string }> {
  const shortCode = randomBytes(6).toString("hex");
  const result = await pool.query(
    `INSERT INTO urls(code, original_url) 
       VALUES ($1, $2) 
       ON CONFLICT (original_url) 
       DO UPDATE SET original_url = EXCLUDED.original_url
       RETURNING *`,
    [shortCode, originalUrl],
  );
  return result.rows[0];
}

export async function fetchOriginalUrl(
  shortCode: string,
): Promise<string | null> {
  const result = await pool.query(
    "SELECT original_url FROM urls WHERE code = $1",
    [shortCode],
  );
  return result.rows.length > 0 ? result.rows[0].original_url : null;
}

export async function fetchAllUrls(
  limit: number,
  after?: string,
): Promise<{
  data: { code: string }[];
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const decodedAfter = after
    ? Buffer.from(after, "base64").toString("utf-8")
    : null;

  const query = `SELECT original_url,id
                 FROM urls 
                 WHERE id > $1 
                 ORDER BY id 
                 LIMIT $2`;

  const result = await pool.query(query, [decodedAfter || 0, limit + 1]);
  const lastId =
    result.rows.length > 0 ? result.rows[result.rows.length - 1].id : null;

  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const originalUrls = rows.map((row) => row.original_url);

  return {
    data: originalUrls,
    nextCursor: hasMore
      ? Buffer.from(lastId.toString()).toString("base64")
      : null,
    hasMore,
  };
}
