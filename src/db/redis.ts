import "dotenv/config";
import { Redis } from "ioredis";
import CircuitBreaker from "../utils.ts/circuit-breaker.js";

const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 0,
  lazyConnect: true,
  enableReadyCheck: true,
  commandTimeout: 500,
  tls: {},
});

redis.on("error", (err) => {
  console.error("Redis error:", err);
});

export const redisCircuitBreaker = new CircuitBreaker(5, 30000); // 5 failures, 30 second timeout

export default redis;
