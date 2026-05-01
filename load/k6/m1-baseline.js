// Module 1 baseline load test.
//
// Goal: drive shortn until something saturates. Watch p99 latency and
// DB connection count. The exercise is observing where it breaks, not
// passing a threshold.
//
// Run:   k6 run load/k6/m1-baseline.js
// Tweak: rps, duration, target endpoint

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  // stages: [
  //   { duration: '30s', target: 100 },   // ramp to 100 vus
  //   { duration: '1m',  target: 500 },   // ramp to 500
  //   { duration: '2m',  target: 1000 },  // hold at 1000
  //   { duration: '30s', target: 0 },     // ramp down
  // ],
  // thresholds: {
  //   // Deliberately loose — the point is to see what breaks, not to pass.
  //   http_req_duration: ['p(99)<5000'],
  // },
  vus: 1000,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(99)<5000'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  // Mix: 80% reads of an existing code, 20% writes.
  // Adjust once you have real data.
  const isWrite = Math.random() < 0.2;

  if (isWrite) {
    const res = http.post(`${BASE}/shorten`, JSON.stringify({
      url: `https://example.com/${Math.random()}`,
    }), { headers: { 'Content-Type': 'application/json' } });

    check(res, { 'shorten 2xx': (r) => r.status >= 200 && r.status < 300 });
  } else {
    // Replace 'abc123' with a code that actually exists, or seed your DB first.
    const res = http.get(`${BASE}/test01`, { redirects: 0 });
    check(res, { 'redirect 30x or 404': (r) => r.status === 301 || r.status === 302 || r.status === 404 });
  }

  // sleep(0.1);
}
