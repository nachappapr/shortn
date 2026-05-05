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

export async function createBatchInsertJob(): Promise<number> {
  const result = await pool.query(
    `INSERT INTO bulk_jobs (status) VALUES ($1) RETURNING id`,
    ["pending"],
  );
  return result.rows[0].id;
}

export async function processBatchInsertJob(
  jobId: number,
  urls: string[],
): Promise<void> {
  const client = await pool.connect();
  let successCount = 0;
  let failedCount = 0;

  try {
    await client.query("BEGIN");

    await client.query(`UPDATE bulk_jobs SET status = $1 WHERE id = $2`, [
      "processing",
      jobId,
    ]);

    for (const url of urls) {
      try {
        await client.query("SAVEPOINT sp");
        const result = await client.query(
          `INSERT INTO urls (code, original_url) VALUES ($1, $2) ON CONFLICT (original_url) DO UPDATE SET updated_at = NOW() RETURNING *`,
          [randomBytes(6).toString("hex"), url],
        );
        await client.query(
          `INSERT INTO bulk_job_results (job_id, url_id, status, original_url) VALUES ($1, $2, $3, $4)`,
          [jobId, result?.rows[0]?.id, "success", url],
        );
        await client.query("RELEASE SAVEPOINT sp");
        successCount++;
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT sp");
        await client.query(
          `INSERT INTO bulk_job_results (job_id, url_id, status, original_url) VALUES ($1, $2, $3, $4)`,
          [jobId, null, "failed", url],
        );
        failedCount++;
      }
    }
    let finalStatus: string;
    if (failedCount === 0) {
      finalStatus = "completed";
    } else if (successCount === 0) {
      finalStatus = "failed";
    } else {
      finalStatus = "partial";
    }
    await client.query(`UPDATE bulk_jobs SET status = $1 WHERE id = $2`, [
      finalStatus,
      jobId,
    ]);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
