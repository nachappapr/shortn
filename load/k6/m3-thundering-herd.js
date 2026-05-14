import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = 'http://localhost:3000/v1';
const SHORT_CODE = 'test01'; // e.g. 'abc123'

export let options = {
  vus: 1000,
  duration: '30s',
};

export default function () {
  const res = http.get(`${BASE}/${SHORT_CODE}`, { redirects: 0 });
  check(res, {
    'redirect 30x': (r) => r.status === 301 || r.status === 302,
  });
}