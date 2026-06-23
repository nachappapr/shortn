import als from "./context.js";
import os from "os";

const instanceId = process.env.INSTANCE_ID || os.hostname();

function logger(message: string, extra: Record<string, unknown> = {}) {
  const store = als.getStore();
  const requestId = store?.requestId || "no-request-context";

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      message,
      instanceId,
      requestId,
      ...extra,
    }),
  );
}
export { logger };
