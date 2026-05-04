import { NextFunction, Request, Response } from "express";
import { createHash } from "node:crypto";
import pool from "../db/db.js";
import { AppError } from "../errors/app.error.js";

export async function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const key = req.headers["idempotency-key"];
  if (!key) return next();

  // compute the request hash based on the method, url, and body
  const requestHash = createHash("sha256")
    .update(JSON.stringify(req.body))
    .digest("hex");

  const client = await pool.connect();
  const userId = "1"; // In a real application, you would get this from the authenticated user context
  const keyStr = Array.isArray(key) ? key[0] : key;
  const lockKey = `${userId}:${req.path}:${keyStr}`;
  const endpoint = `${req.method} ${req.path}`;

  try {
    await client.query("BEGIN");

    await client.query(
      `
      SELECT pg_advisory_xact_lock(hashtext($1)::bigint);
    `,
      [lockKey],
    );

    const { rows } = await client.query(
      `
      SELECT response_status, response_body, response_headers,request_hash
      FROM idempotency_keys
      WHERE user_id = $1 AND endpoint = $2 AND key = $3
    `,
      [userId, endpoint, keyStr],
    );

    if (rows.length > 0) {
      const row = rows[0];
      await client.query("ROLLBACK");
      client.release();

      if (row.request_hash !== requestHash) {
        return next(
          new AppError(
            "Idempotency key reused with a different request",
            422,
            "Idempotency key collision: request hash does not match",
          ),
        );
      }
      return res
        .status(row.response_status)
        .set(row.response_headers ?? {})
        .json(row.response_body);
    }

    const originalResponse = res.json.bind(res);
    (res as any).json = (body: unknown) => {
      client
        .query(
          `
        INSERT INTO idempotency_keys (user_id, endpoint, key, request_hash, response_status, response_body,response_headers)
        VALUES ($1, $2, $3, $4, $5, $6,$7)
      `,
          [
            userId,
            endpoint,
            keyStr,
            requestHash,
            res.statusCode,
            body,
            res.getHeaders(),
          ],
        )
        .then(() => client.query("COMMIT"))
        .catch((err) => client.query("ROLLBACK"))
        .finally(() => client.release())
        .then(() => originalResponse(body));
      return res;
    };

    next();
  } catch (error) {
    await client.query("ROLLBACK");
    client.release();
    next(
      new AppError(
        "Failed to acquire lock for idempotency key",
        500,
        "IDEMPOTENCY_LOCK_ERROR",
      ),
    );
  }
}
