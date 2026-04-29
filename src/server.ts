import dotenv from "dotenv";
import express from "express";
import pool from "./db/db.js";
import { randomBytes } from "node:crypto";
dotenv.config();

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

app.post("/shorten", async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  const code = randomBytes(6).toString("hex");

  try {
    const result = await pool.query(
      `INSERT INTO urls(code, original_url) 
       VALUES ($1, $2) 
       ON CONFLICT (original_url) 
       DO UPDATE SET original_url = EXCLUDED.original_url
       RETURNING *`,
      [code, url],
    );
    res.status(200).json({
      shorten_url: new URL(
        `/${result.rows[0].code}`,
        process.env.PUBLIC_BASE_URL,
      ).href,
    });
  } catch (err) {
    console.error("Error inserting URL:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/:code", async (req, res) => {
  const { code } = req.params;
  try {
    const result = await pool.query(
      "SELECT original_url FROM urls WHERE code = $1",
      [code],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "URL not found" });
    }
    res.status(302).redirect(result.rows[0].original_url);
  } catch (err) {
    console.error("Error retrieving URL:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

process.on("SIGTERM", () => {
  console.log(
    JSON.stringify({ event: "shutdown_initiated", signal: "SIGTERM" }),
  );
  server.close(() => {
    console.log(JSON.stringify({ event: "http_server_closed" }));
    pool.end(() => {
      console.log(JSON.stringify({ event: "pool_closed" }));
      process.exit(0);
    });
  });

  setTimeout(() => {
    console.error(
      "Could not close connections in time, forcefully shutting down",
    );
    process.exit(1);
  }, 10000).unref();
});
