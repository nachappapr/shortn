import cron from "node-cron";
import { logger } from "../utils.ts/logger.js";
import pool from "../db/db.js";
import { processBatchInsertJobV2 } from "../services/urls.js";

export function scheduleWorkerCronJob() {
  cron.schedule("*/2 * * * * *", async () => {
    try {
      const result = await pool.query(
        `SELECT id FROM bulk_jobs WHERE status = 'pending' ORDER BY created_at ASC`,
      );

      for (const row of result.rows) {
        const jobId = row.id;
        try {
          processBatchInsertJobV2(jobId).catch((err) => {
            console.error(`Error processing batch insert job ${jobId}:`, err);
          });
        } catch (err) {
          logger(
            `[job ${jobId}] recovery write failed, reaper will handle: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      if (result.rowCount && result.rowCount === 0) return;
    } catch (error) {
      logger(`Error in worker cron job: ${error}`);
    }
  });
}
