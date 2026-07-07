import cron from "node-cron";
import { logger } from "../utils.ts/logger.js";
import pool from "../db/db.js";
import { processBatchInsertJobV2 } from "../services/urls.js";

export function scheduleWorkerCronJob() {
  cron.schedule("*/2 * * * * *", async () => {
    try {
      logger("Worker cron job triggered");
      const result = await pool.query(
        `SELECT id FROM bulk_jobs WHERE status = 'pending' ORDER BY created_at ASC`,
      );

      try {
        for (const row of result.rows) {
          const jobId = row.id;
          processBatchInsertJobV2(jobId).catch((err) => {
            console.error(`Error processing batch insert job ${jobId}:`, err);
          });
        }
      } catch (err) {
        logger(`Error processing jobs in worker cron job: ${err}`);
      }

      if (result.rowCount && result.rowCount === 0) return;
    } catch (error) {
      logger(`Error in worker cron job: ${error}`);
    }
  });
}
