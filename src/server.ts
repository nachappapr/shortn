import dotenv from "dotenv";
import express from "express";
import pool from "./db/db.js";
import errorMiddleware from "./middleware/error.middleware.js";
import notFoundMiddleware from "./middleware/not-found.middleware.js";
import urlRoutes from "./routes/urls.js";
import os from "os";
import redis from "./db/redis.js";
dotenv.config();

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const rateLimitMap = new Map<string, number>();

// Rate limiting middleware
app.use(async (req, res, next) => {
  const count = await redis.incr(req.ip as string);

  if (count === 1) {
    await redis.expire(req.ip as string, 60);
  }

  if (count > 10) {
    return res.status(429).json({ error: "Too many requests" });
  }
  next();
});
// Health check endpoint
app.get("/health", (req, res) => {
  console.log(`Request handled by ${os.hostname()}`);
  res.status(200).json({ status: "ok" });
});

// Routes
app.use("/v1", urlRoutes);

// Middleware for handling 404 Not Found
app.use(notFoundMiddleware);

// Middleware for handling errors
app.use(errorMiddleware);

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
