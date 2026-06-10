import { randomBytes } from "node:crypto";
import pool from "../db/db.js";
import {
  BatchJobStatusApi,
  BulkJobResultRow,
  SaveShortUrlApi,
} from "../types/url.js";
import { AppError } from "../errors/app.error.js";
import { CircuitBreakerError } from "../errors/circuit.error.js";
import redis, { redisCircuitBreaker } from "../db/redis.js";

export async function saveShortUrl(
  originalUrl: string,
): Promise<SaveShortUrlApi | null> {
  const shortCode = randomBytes(6).toString("hex");
  const result = await pool.query<SaveShortUrlApi>(
    `INSERT INTO urls(code, original_url) 
       VALUES ($1, $2) 
       ON CONFLICT (original_url) 
       DO UPDATE SET original_url = EXCLUDED.original_url
       RETURNING *`,
    [shortCode, originalUrl],
  );

  return result.rowCount && result.rows[0] ? result.rows[0] : null;
}

async function getOriginalUrlFromDb(shortCode: string): Promise<string | null> {
  const result = await pool.query(
    "SELECT original_url FROM urls WHERE code = $1",
    [shortCode],
  );

  return result.rows.length > 0 ? result.rows[0].original_url : null;
}

async function safeRedis<T>(
  fn: () => Promise<T>,
): Promise<{ value: T | null; ok: boolean; circuitOpen: boolean }> {
  try {
    return {
      value: await redisCircuitBreaker.call(fn),
      ok: true,
      circuitOpen: false,
    };
  } catch (error) {
    if (error instanceof CircuitBreakerError) {
      console.warn("Circuit breaker is open. Redis is unavailable.");
      return { value: null, ok: false, circuitOpen: true };
    }
    return { value: null, ok: false, circuitOpen: false };
  }
}

async function onRedisUnavailable(
  shortCode: string,
  circuitOpen: boolean = false,
): Promise<{ result: string | null; error_type: string | null }> {
  // if (percentageUsed > 80 || waitingQueueLength > 0) {
  //   return {
  //     result: null,
  //     error_type: "SERVICE_UNAVAILABLE",
  //   };
  // }
  try {
    if (circuitOpen) {
      console.warn("Circuit breaker is open. Redis is unavailable.");
      return { result: null, error_type: "SERVICE_UNAVAILABLE" };
    }
    console.warn(
      `onRedisUnavailable called at ${Date.now()}, circuitOpen: ${circuitOpen}`,
    );
    const start = Date.now();
    const result = await getOriginalUrlFromDb(shortCode);
    return {
      result,
      error_type: result ? null : "NOT_FOUND",
    };
    console.warn(`DB query took ${Date.now() - start}ms`);
  } catch (error) {
    if (
      error instanceof Error &&
      error?.message.includes("timeout exceeded when trying to connect")
    ) {
      return { result: null, error_type: "SERVICE_UNAVAILABLE" };
    } else {
      console.error("Error retrieving URL from database:", error);
      return { result: null, error_type: "NOT_FOUND" };
    }
  }
}
export async function fetchOriginalUrl(
  shortCode: string,
  retryInterval: number = 100,
  retryCount: number = 0,
): Promise<{ result: string | null; error_type: string | null }> {
  const maxRetries = 3;

  // const resourceUser = pool.totalCount - pool.idleCount;
  // const percentageUsed =
  //   pool.totalCount > 0 ? (resourceUser / pool.totalCount) * 100 : 0;

  const {
    ok: redisUp,
    value: cached,
    circuitOpen,
  } = await safeRedis(() => redis.get(shortCode));

  if (!redisUp || circuitOpen)
    return onRedisUnavailable(shortCode, circuitOpen);

  if (cached) {
    console.info(`Cache hit for code: ${shortCode}`);
    return { result: cached, error_type: null };
  }

  const { value: accquired, circuitOpen: circuitOpenOnAccquiringLock } =
    await safeRedis(() => redis.set(`lock:${shortCode}`, "1", "EX", "5", "NX"));

  if (circuitOpenOnAccquiringLock) {
    console.warn(
      "Circuit breaker is open while trying to acquire lock. Redis is unavailable.",
    );
    return { result: null, error_type: "SERVICE_UNAVAILABLE" };
  }

  if (accquired) {
    const result = await getOriginalUrlFromDb(shortCode);

    if (result) {
      try {
        console.info(`Cache miss for code: ${shortCode}. Caching result.`);
        await redis.set(
          shortCode,
          result,
          "EX",
          parseInt(process.env.URL_CACHE_TTL_SECONDS || "60", 10),
        );
      } catch (error) {
        console.error("Error setting Redis cache:", error);
      } finally {
        await redis.del(`lock:${shortCode}`); // Release lock after caching
        return { result, error_type: null };
      }
    }
  } else {
    if (retryCount < maxRetries) {
      retryInterval = retryInterval * (0.5 + Math.random()); // Exponential backoff with jitter
      await new Promise((resolve) => setTimeout(resolve, retryInterval));
      return fetchOriginalUrl(shortCode, retryInterval, retryCount + 1);
    } else {
      const { value: fallback } = await safeRedis(() => redis.get(shortCode));
      if (fallback) return { result: fallback, error_type: null };
      if (!fallback) return onRedisUnavailable(shortCode);
    }
  }
  return {
    result: null,
    error_type: "NOT_FOUND",
  };
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

export async function createBatchInsertJob(
  webhookUrl?: string,
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO bulk_jobs (status,webhook_url) VALUES ($1, $2) RETURNING id`,
    ["pending", webhookUrl || null],
  );
  return result.rows[0].id;
}

async function webhookNotification(
  webhookUrl: string,
  payload: BatchJobStatusApi,
  retryCount: number = 0,
  retryDelay: number = 1000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 5000);
  const maxRetries = 3;

  try {
    const result = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!result.ok) {
      throw new Error(`Webhook responded with status ${result.status}`);
    }
  } catch (err) {
    if (retryCount < maxRetries) {
      retryCount++;
      retryDelay = retryDelay * 2 * Math.random(); // Exponential backoff with jitter
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      return webhookNotification(webhookUrl, payload, retryCount, retryDelay);
    }

    console.error("Error sending webhook notification:", err);
  } finally {
    clearTimeout(timeout);
  }
}

export async function processBatchInsertJob(
  jobId: string,
  urls: string[],
  webhookUrl?: string,
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
          `INSERT INTO urls (code, original_url) VALUES ($1, $2) ON CONFLICT (original_url) DO UPDATE SET original_url = EXCLUDED.original_url RETURNING *`,
          [randomBytes(6).toString("hex"), url],
        );
        await client.query(
          `INSERT INTO bulk_job_results (job_id, url_id, status, original_url, error) VALUES ($1, $2, $3, $4, $5)`,
          [jobId, result?.rows[0]?.id, "completed", url, null],
        );
        await client.query("RELEASE SAVEPOINT sp");
        successCount++;
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT sp");
        await client.query(
          `INSERT INTO bulk_job_results (job_id, url_id, status, original_url, error) VALUES ($1, $2, $3, $4, $5)`,
          [
            jobId,
            null,
            "failed",
            url,
            error instanceof Error ? error.message : "Unknown error",
          ],
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

    if (webhookUrl) {
      const urlsResult = await client.query(
        `SELECT u.code, u.original_url, br.status, br.error FROM bulk_job_results br
         LEFT JOIN urls u ON br.url_id = u.id
         WHERE br.job_id = $1`,
        [jobId],
      );

      const payload: BatchJobStatusApi = {
        jobId,
        status: finalStatus,
        successCount,
        failedCount,
        results: urlsResult.rows.map((row) => ({
          shortenedUrl: row.code
            ? new URL(`/${row.code}`, process.env.PUBLIC_BASE_URL).href
            : null,
          originalUrl: row.original_url,
          status: row.status,
          error: row.error,
        })),
      };
      await webhookNotification(webhookUrl, payload, 0);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function fetchBatchJobStatus(
  jobId: string,
): Promise<BatchJobStatusApi> {
  const jobStatusResult = await pool.query(
    `SELECT status FROM bulk_jobs WHERE id = $1`,
    [jobId],
  );

  const jobStatus =
    jobStatusResult.rows.length > 0 ? jobStatusResult.rows[0].status : null;

  if (jobStatus === "pending" || jobStatus === "processing") {
    return {
      jobId,
      status: jobStatus,
      successCount: 0,
      failedCount: 0,
      results: [],
    };
  }
  if (!jobStatus) {
    throw new AppError("Batch job not found", 404, "BATCH_JOB_NOT_FOUND");
  }

  const result = await pool.query<BulkJobResultRow>(
    `SELECT b.id AS jobId, 
            b.status AS status, 
            br.original_url,
            br.status AS urlStatus,
            br.error,
            u.code AS shortenedUrl
     FROM bulk_job_results br 
     LEFT JOIN bulk_jobs b ON br.job_id = b.id
     LEFT JOIN urls u ON br.url_id = u.id
     WHERE b.id = $1`,
    [jobId],
  );

  const updatedResult = result?.rows?.reduce(
    (acc, row) => {
      if (!acc["jobId"]) {
        acc["jobId"] = row.jobid;
      }
      if (!acc["status"]) {
        acc["status"] = row.status;
      }

      if (row.urlstatus === "completed") {
        acc["successCount"]++;
      } else if (row.urlstatus === "failed") {
        acc["failedCount"]++;
      }

      acc["results"].push({
        shortenedUrl: row.shortenedurl
          ? new URL(`/${row.shortenedurl}`, process.env.PUBLIC_BASE_URL).href
          : null,
        originalUrl: row.original_url,
        status: row.urlstatus,
        error: row.error,
      });

      return acc;
    },
    {
      jobId: "",
      status: "",
      successCount: 0,
      failedCount: 0,
      results: [],
    } as BatchJobStatusApi,
  );

  return updatedResult;
}

export async function modifyShortUrl(
  originalUrl: string,
  shortCode: string,
): Promise<SaveShortUrlApi | null> {
  const result = await pool.query<SaveShortUrlApi>(
    `UPDATE urls 
       SET original_url = $1 
       WHERE code = $2 
       RETURNING *`,
    [originalUrl, shortCode],
  );

  try {
    if (result.rowCount && result.rows[0]) {
      await redis.del(shortCode); // Invalidate cache for this code
    }
  } catch (error) {
    console.error("Error invalidating Redis cache:", error);
  }

  return result.rowCount && result.rows[0] ? result.rows[0] : null;
}
