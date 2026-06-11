# Module N — Postmortem

> Written by you, not Claude Code. Aim for one page. The point is to be honest
> about what surprised you, not to write a polished report.

**Date completed:** 2026-06-11
**Total time spent: 16
**Hardest stage: None
**Stage I tried to skip (and didn't): None

## What I built

We built a URL shortener that takes a long URL and converts it into a short alias. The service stores the mapping in Postgres, caches hot lookups in Redis, and handles redirect traffic under load with request coalescing and a circuit breaker in front of Redis.

## What broke

F-07: Thundering herd
- Sent 1000 requests simultaneously after a cache miss by removing the cache

F-08: Slow failures under Redis network partition (fail-open's blind spot)
- simulated a network partition between app and Redis (Redis process up, network unreachable) while concurrent requests hit the same cold key

## Hardest Stage

- Circuit breaker: understanding the three states (closed → open → half-open) and why "half-open" exists — using a single probe request to decide whether to close again rather than just waiting out a fixed cooldown.


## What I'd do differently

- **Calibrate `commandTimeout` against peak load p99, not idle.** I set 100ms on a quiet box, deployed to ElastiCache, and it falsely tripped the circuit breaker under real load (p99 exceeded 100ms at 1000 VUs). Had to raise it to 500ms mid-exercise. Next time: run a quick load baseline *before* setting the timeout — the right number is "just above measured p99 under realistic concurrency," not a gut-feel round number.

- **Test the retry counter explicitly before running load tests.** The `retryCount++` post-increment bug (passing current value instead of incremented value to the recursive call) meant the retry loop never exited — 30s max requests under load. A simple unit test asserting that retries exhaust after N attempts would have caught it in 30 seconds.

## What I still don't understand

Why a single request occasionally took up to 30 seconds (origin unconfirmed). Suspect the `onRedisUnavailable` DB fallback path under extreme pool contention — `connectionTimeoutMillis` may not be surfacing the right error message, so the timeout isn't caught and handled correctly in the retry logic.

## Concept I'm most confident in now

Pick one. Write a 3-sentence explanation as if to a junior engineer who has
never heard of it. If you can't, you're not as confident as you think.

Request coalescing
Under a cache miss, instead of letting every concurrent request hammer the database, we acquire a SETNX lock so that exactly one request fetches the value from the DB and warms the cache. All other requests retry on a short backoff until the cache is warm; if retries are exhausted before the cache is populated, they receive a 503 instead of falling through to the DB.

Circuit Breaker
A circuit breaker wraps a dependency (like Redis) and tracks consecutive failures. When failures exceed a threshold it "opens," meaning all requests skip the dependency immediately instead of waiting on a timeout that will fail anyway. After a cooldown period it enters "half-open," sends one probe request, and closes again only if that probe succeeds — protecting the system from slow cascading failures.

## Cost reality check

Module cost: $0.90