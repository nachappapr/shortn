import cron from "node-cron";
import pool from "../db/db.js";
import { logger } from "../utils.ts/logger.js";

export function scheduleReaperCronJob() {
  cron.schedule("0 * * * * *", async () => {
    try {
      const result = await pool.query(
        `UPDATE bulk_jobs SET status = 'pending'
       WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '15 seconds'`,
      );
      if (result.rowCount && result.rowCount > 0) {
        logger(`Reaper flipped ${result.rowCount} stale job(s) to pending`);
      }
    } catch (error) {
      logger(`Error in reaper cron job: ${error}`);
    }
  });
}
