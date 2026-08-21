import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: {
    burst: {
      executor: "per-vu-iterations",
      vus: 24,          // ← the rung: 6, then 12, then 24
      iterations: 1,   // each VU sends exactly ONE job
    },
  },
  thresholds: {
    checks: ["rate==1.0"], // any non-202 fails the run
  },
};

export default function () {
  const urls = Array.from({ length: 60 }, (_, i) => ({
    url: `https://example.com/vu-${__VU}/page-${i}`,
  }));

  const res = http.post(
    "http://localhost/v1/shorten/batch-v2",
    JSON.stringify({ urls }),
    { headers: { "Content-Type": "application/json" }, timeout: "30s" },
  );

  check(res, {
    "status is 202": (r) => r.status === 202,
    "returned a jobId": (r) => !!r.json("jobId"),
  });

  console.log(`vu=${__VU} status=${res.status} durationMs=${res.timings.duration} body=${res.body}`);
}
