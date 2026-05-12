import "dotenv/config";
import { Redis } from "ioredis";

const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 0,
  lazyConnect: true,
  enableReadyCheck: true,
});

redis.on("error", (err) => {
  console.error("Redis error:", err);
});

export default redis;
