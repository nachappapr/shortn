import http from 'k6/http';
import { check, sleep } from 'k6';

const ALB = 'http://shortnload-188950873.us-east-1.elb.amazonaws.com';
const CODE = '4e8f5336bfb4';

export const options = {
  stages: [
    { duration: '30s', target: 100 },
    { duration: '1m',  target: 100 },
    { duration: '30s', target: 0   },
  ],
};

export default function () {
  const res = http.get(`${ALB}/v1/${CODE}`, {
    redirects: 0,  // don't follow the 302 — we're testing the app, not GitHub
  });
  check(res, {
    'status is 302': (r) => r.status === 302,
  });
}