import pool from "./db/db.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./utils.ts/logger.js";

const __filename = fileURLToPath(import.meta.url);

async function migrate() {
  try {
    await pool.query(
      "CREATE TABLE IF NOT EXISTS migrations (id SERIAL PRIMARY KEY, filename VARCHAR(255) NOT NULL UNIQUE, applied_at TIMESTAMP DEFAULT NOW())",
    );

    const appliedMigrations = await pool.query(
      "SELECT filename FROM migrations",
    );
    const appliedMigrationSet = new Set(
      appliedMigrations.rows.map((row) => row.filename),
    );

    const migrationFiles = fs
      .readdirSync(path.join(process.cwd(), "migrations"))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of migrationFiles) {
      if (appliedMigrationSet.has(file)) {
        logger(`Skipping migration (already applied): ${file}`);
        continue;
      }
      const filePath = path.join(process.cwd(), "migrations", file);
      const sql = fs.readFileSync(filePath, "utf8");

      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO migrations (filename) VALUES ($1)", [
          file,
        ]);
        await client.query("COMMIT");
        logger(`Executed migration: ${file}`);
      } catch (error) {
        logger(`Error executing migration ${file}: ${error}`);
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      logger(`Migration failed:${error.message}`);
    } else {
      logger("Migration failed: An unknown error occurred.");
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
