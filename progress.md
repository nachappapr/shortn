## Current Position

Current Position: Module 3, Stage 1 — thundering herd observed and understood, single-flight fix designed but not yet implemented
Module: Module 3
Stage: 1
Last session: 2026-05-14
Next action:  Implement single-flight lock (SET NX) in GET /:code handler, then re-run k6 + FLUSHALL to verify spike is gone

**Open questions / things I'm stuck on:**
- Known gap: stuck job reaper not implemented — jobs that crash mid-processing 
  stay in pending/processing forever. Needs a cron in production.

---

## Module Status

| # | Module | Status | Started | Finished | Notes |
|---|--------|--------|---------|----------|-------|
| 1 | Single Box | ✅ Done | 2026-04-27 | 2026-04-29 | — |
| 2 | API Design | ✅ Done | 2026-05-01 | 2026-05-12 | — |
| 3 | Caching | 🟡 In progress | 2026-05-12 | — | — |
| 4 | Horizontal Scale | ⬜ | — | — | — |
| 5 | Async Work | ⬜ | — | — | — |
| 6 | Data: Replication, Sharding, Migrations | ⬜ | — | — | — |
| 7 | Auth & Security | ⬜ | — | — | — |
| 8 | Search | ⬜ | — | — | — |
| 9 | Reliability & Observability | ⬜ | — | — | — |
| 10 | Real-Time & Geo (optional) | ⬜ | — | — | — |

**Status legend:** ⬜ Not started · 🟡 In progress · ✅ Done · ⏸️ Paused · 🔁 Revisited

---

## Decisions Log

> One row per non-obvious design decision. Future-you will thank present-you. Keep "Why" and "Tradeoff" honest — if you picked something because a tutorial said so, write that.

| Date | Module | Decision | Why | Tradeoff accepted |
|------|--------|----------|-----|-------------------|
| 2026-04-27 | 1 | Code length = 12 hex chars (randomBytes(6)) | 4 bytes caused duplicate key collisions at 3300 RPS — birthday problem | Longer URLs (12 chars vs 8), but 281 trillion possibilities makes collision negligible |
| 2026-05-01 | 2 | Cursor pagination over offset for list endpoints | Offset scans all preceding rows — gets slower with depth | No arbitrary page jumps, no total page count |
| 2026-05-01 | 2 | Client-generated idempotency keys | the failure mode we're protecting against is "response never arrived" — a server-generated key only exists in that response, so if the response is lost the key is lost with it and the retry looks like a fresh request. The key must exist before the request is sent | clients have to know to generate and send the key (UUIDv4 in a header); we can't protect clients that don't participate. |
| 2026-05-01 | 2 | Base64 encode cursor id | Hides internal DB sequence from clients | Trivial to decode, but raises the bar for casual snooping |
| 2026-05-04 | 2 | separate idempotency_keys table, not a column on urls | idempotency replays the response, including for requests that don't create a resource (validation failures, 4xx, etc.) — coupling to urls means you can only remember successes | extra table, extra write per POST, response body stored verbatim. |
| 2026-05-04 | 2 | on idempotency key reuse with mismatched request body, return 422 Unprocessable (Stripe-style), not silent replay | silent replay hides client bugs; a key reused with a different payload is always a client error and should fail loudly | requires storing a request body hash on every idempotent write; clients that genuinely want to "change their mind" must use a new key (which is the correct semantic anyway). |
| 2026-05-04 | 2 | advisory lock (Pattern B) over insert-first (Pattern A) for idempotency concurrency control | avoids extra INSERT + UPDATE round trip; single transaction wrapping both urls and idempotency_keys inserts is atomic — crash rolls back both, no orphaned rows. Advisory lock tied to connection, auto-released on death | lock key must be derived deterministically from (user_id, endpoint, key) — need a stable hash function for it.|
| 2026-05-05 | 2 | or async bulk endpoints, idempotency replay stores only the 202 response (job ID + status), not the full result body | result body is too large and clients poll for results anyway. | client must use the job ID to get actual results, can't get them from a replay alone. |
| 2026-05-05 | 2 | row-by-row insert in processJob over bulk insert | need per-row failure tracking in bulk_job_results. | slower (N round trips), but partial failures are visible to the client. Chunking deferred as optimization. |
| 2026-05-05 | 2 | Savepoints for per-URL error isolation inside outer transaction | without a savepoint, one bad URL aborts the entire batch transaction — savepoints let a per-row INSERT fail and roll back only that row while the outer transaction continues | savepoints add a round trip per row; if the batch is huge this compounds the N-round-trips cost already accepted in the row-by-row decision |
| 2026-05-05 | 2 | bulk_job_results stores original_url for failed rows instead of null url_id | failed rows have no url_id (the INSERT never committed), so storing NULL would lose the identity of what failed — original_url is the only stable identifier the client gave us | duplicates data already in the request body, but it's the only way to return meaningful per-row error detail to the caller |
| 2026-05-05 | 2 | Job terminal states: completed = all rows succeeded, partial = at least one row failed but at least one succeeded, failed = all rows failed | three states let the client distinguish "retry the whole job" (failed) from "cherry-pick failures" (partial) from "nothing to do" (completed) — a binary success/failure collapses that signal | more states mean more code paths in the client; partial is the one most clients forget to handle |
| 2026-05-06 | 2 | webhook delivery outside the database transaction | Firing the webhook inside an open transaction holds a DB connection for the full HTTP round-trip to the subscriber — potentially seconds. This exhausts the connection pool under load and couples transaction success to external HTTP availability: a slow or failing webhook would roll back the URL creation. | Commit can succeed but webhook delivery fails (network drop, subscriber down, process crash between commit and send) — the URL exists but the subscriber is never notified. Requires a retry mechanism (outbox pattern, job queue) for at-least-once guarantees. |
| 2026-05-07 | 2 | full jitter on webhook retries (`random(0, base * 2^attempt)`) over plain exponential backoff | plain exponential backoff causes synchronized retry bursts — all deliveries that fail together retry together on every interval, flooding a recovering subscriber and potentially preventing it from recovering at all (F-06) | individual retry latency is less predictable (some retries fire earlier than the "ideal" backoff delay); acceptable because system-level recovery time is strictly better |
| 2026-05-08 | 2 | no API gateway — cross-cutting concerns handled in-app | API gateway earns its weight when many services share the same requirements (rate limiting, auth, validation) and you need a single enforcement point. With one service, the gateway adds a network hop, an extra failure domain, and operational complexity with no benefit — the same middleware runs directly in Express at negligible cost | if the service count grows or teams diverge on how they handle auth/rate-limiting, extracting to a gateway becomes the right call |
| 2026-05-14 | 3 | Redis SETNX lock for stampede protection over in-memory Promise map | In-memory lock only works on a single process — once the service scales horizontally, each instance has its own map and all instances stampede the DB simultaneously. Redis SETNX is process-agnostic and survives scale-out without code changes | Extra round trip to Redis on every cache miss; if the lock holder crashes before releasing, the TTL must expire before other waiters can proceed — a hung process can stall reads for up to TTL seconds |


---

## Failure Catalog

> Every failure you produced and what it taught you. This becomes your personal "things that bite in production" reference. Don't water it down — write what actually happened.



### Template

```
### F-NN: <short title>
- **Module/Stage:** M_ S_
- **What I did:** (the action that caused it)
- **What broke:** (symptom — error, latency spike, data loss, etc.)
- **Root cause in one sentence:**
- **Fix:**
- **What I'd watch for in production:**
```

### F-01: Duplicate key collision under load
- **Module/Stage:** M1 S1
- **What I did:** ran k6 at 1000 VUs with randomBytes(4) code generation
- **What broke:** 6 duplicate key 500s out of 800k requests
- **Root cause in one sentence:** 4 bytes = 4 billion possibilities, birthday problem causes collisions at high RPS
- **Fix:** randomBytes(6) = 281 trillion possibilities, one line change
- **What I'd watch for in production:** 500s on /shorten, alert on any duplicate key errors in logs

### F-02: 15 second hang on Postgres death
- **Module/Stage:** M1 S1
- **What I did:** docker kill postgres container mid-load test
- **What broke:** in-flight requests hung for 15 seconds, 93% failure rate
- **Root cause in one sentence:** docker kill sent no FIN/RST, socket went 
  silent, Node waited until OS TCP stack gave up after ~15 seconds
- **Fix:** configure query timeout in pg pool so app fails in 2s, not 15s
- **What I'd watch for in production:** p99 spikes to 15s during DB restarts 
  or network blips — that's the tell

### F-03: Pool size vs throughput tradeoff
- **Module/Stage:** M1 S4
- **What I did:** ran k6 at 1000 VUs without sleep, compared pool max:2 / max:10 / max:50
- **What broke:** pool max:2 → avg 47ms, 11k RPS. Pool max:50 → p99 68ms despite higher RPS. No single size was obviously "right"
- **Root cause in one sentence:** when the pool is exhausted, requests queue in Node and wait for a free connection — the optimal pool size depends on Postgres capacity, not just request volume
- **Fix:** use the formula `(max_connections - reserved_for_other_services) / num_app_instances` to derive a per-instance pool ceiling, then validate with pg_stat_activity under load
- **What I'd watch for in production:** active connection ratio vs pool max — alert when active connections exceed 80% of pool size sustained; also watch Node's internal queue length, not just DB metrics

### F-04: Request entity too large (body parser limit)
- **Module/Stage:** M2 S4
- **What I did:** sent a bulk shorten request with a payload large enough to exceed Express's default body-parser limit
- **What broke:** Express rejected the request with 413 Payload Too Large before it reached any route handler
- **Root cause in one sentence:** Express body-parser defaults to 100kb; a bulk array of URLs blows past that limit silently from the client's perspective
- **Fix:** raise the `limit` option on `express.json()` to a value appropriate for the max batch size, or cap batch size in validation before the body is parsed
- **What I'd watch for in production:** 413s on bulk endpoints with no corresponding server-side business logic error — the request never made it in

### F-05: Client timeout with server still processing
- **Module/Stage:** M2 S4
- **What I did:** sent a synchronous bulk shorten request with a large batch; client timeout fired before the server finished
- **What broke:** client received a timeout error, but the server kept processing and committed work the client never saw — result was lost or ambiguous
- **Root cause in one sentence:** long-running synchronous work violates the HTTP request/response contract — the client cannot wait indefinitely, but the server has no way to report partial progress mid-request
- **Fix:** move bulk processing behind an async job pattern (202 Accepted + polling), so the HTTP round trip is just "job accepted," not "job done"
- **What I'd watch for in production:** client-reported timeouts that don't correlate with server errors — the work is completing successfully, it's just invisible to the caller


### F-06: Retry Storm
- **Module/Stage:** M2 S4
- **What I did:** implemented exponential backoff for webhook delivery without adding jitter — retries used fixed intervals (`base * 2^attempt`)
- **What broke:** when the subscriber went down and many deliveries failed at the same time, every retry timer fired in lockstep. The recovering subscriber was immediately flooded with a synchronized burst on each backoff interval instead of getting breathing room — preventing it from recovering at all
- **Root cause in one sentence:** exponential backoff without jitter serializes retries rather than distributing them — all callers that failed together will retry together, creating repeating thundering-herd bursts
- **Fix:** add full jitter: `base * 2^attempt * (0.5 + random * 0.5)` so each delivery picks a random point inside the backoff window; the burst spreads into a smooth drizzle even when hundreds of retries are in-flight simultaneously
- **What I'd watch for in production:** retry queue depth spiking in rhythmic waves (rising, brief dip as the burst lands, rising again) rather than a smooth exponential decay — that oscillating pattern is the signature of synchronized retries hitting a struggling subscriber

### F-07: Thundering herd
- **Module/Stage:** M3 S1
- **What I did:** Sent 1000 requests simultaneously after a cache miss by removing the cache
- **What broke:** P99 spiked due to DB connection pool exhaustion
- **Root cause in one sentence:** When the cache expires, every concurrent request misses simultaneously and races to query the DB, exhausting the connection pool before any response can be cached
- **Fix:** Implement request coalescing — either an in-memory promise lock (single-flight) or a Redis NX lock — so only one request queries the DB while the rest wait and reuse the cached result
- **What I'd watch for in production:** P99 spikes that correlate with TTL boundaries or cache restarts — that's the signature




---

## Cost Log

> Pulled from AWS Cost Explorer at the end of each AWS exercise. Track even if it's $0.30 — pattern recognition matters more than the absolute number.

| Date | Module | Services used | Hours active | Cost (USD) | Notes |
|------|--------|---------------|--------------|------------|-------|
| 2026-04-28 | 1 | RDS db.t3.micro, EC2 t3.micro x2, VPC, EC2-Other | 2h | $0.11 | RDS $0.06, EC2 $0.03, VPC $0.01, EC2-Other $0.01 — Mumbai region |
| 2026-05-08 | 2 | Route 53, EC2, RDS, VPC, Others | ~2d | $0.72 (+$0.13 tax = $0.85) | Route 53 $0.50, EC2 $0.09, RDS $0.06, VPC $0.04, Others $0.03 — ALB + load test session |

**Running total:** $0.83 (excl. tax) / $0.96 (incl. tax)

**Cost surprises** (things that cost more than I expected — review before starting next module):
- Route 53 $0.50 dominated M2 costs — more than EC2+RDS+VPC combined. Hosted zone fee ($0.50/month flat) dwarfs compute at this small scale.

---

## Concepts Earned

> Claude should not let you check a concept off until you can explain it in your own words *to a junior engineer who's never heard of it*. The test is the explanation, not the build. If you can't write the one-sentence explanation, the concept isn't earned yet.

### Module 1
- [x] Throughput vs latency (and why p99 ≠ p50 × constant)
- [x] Little's Law in plain English
- [x] Why every connection pool size is a guess that needs validation
- [x] What backpressure is and where it lives in your stack
- [x] Why graceful shutdown is non-negotiable
- [x] Idempotency — and the request that taught you why

### Module 2
- [x] Why offset pagination dies on large tables
- [x] When gRPC is right and when it's resume-driven design
- [x] Idempotency keys — why client-generated, not server-generated
- [x] The async API pattern (202 → poll / webhook) and when each fits

### Module 3
- [ ] Cache-aside vs write-through — when each makes sense
- [x] Thundering herd — what it looks like in metrics
- [ ] Why "fail open vs fail closed" is a product decision, not a tech one
- [ ] Circuit breaker states (closed/open/half-open) without looking it up

### Module 4
- [ ] Every piece of accidental state in a single-instance app
- [ ] Why distributed locks are not as simple as `SETNX`
- [ ] Fencing tokens — what they prevent that TTLs can't
- [ ] Stateless vs stateful services, sharply

### Module 5
- [ ] At-least-once vs at-most-once vs effectively-once
- [ ] Idempotent consumer pattern
- [ ] Why "exactly once" is mostly marketing
- [ ] Consumer lag as the queue health metric
- [ ] When SKIP LOCKED is enough and when it isn't

### Module 6
- [ ] Replication lag — what causes it, what bounds it
- [ ] Read-your-writes and how to provide it cheaply
- [ ] Why sharding kills cross-shard joins (and what you do instead)
- [ ] Expand-contract migration in 5 ordered steps without looking it up
- [ ] PACELC over CAP — what the L and the C add

### Module 7
- [ ] Why bcrypt/argon2, not SHA-anything
- [ ] JWT revocation — actually how
- [ ] IDOR — and why authentication ≠ authorization
- [ ] Timing attacks — what makes them possible
- [ ] What WAF can and can't do at L7

### Module 8
- [ ] Inverted index intuition (how does ES find a word fast?)
- [ ] Dual-write problem — why it's a class, not a bug
- [ ] CDC vs dual-write tradeoffs
- [ ] When Postgres FTS is enough (most of the time)

### Module 9
- [ ] Four golden signals — without looking them up
- [ ] SLI vs SLO vs SLA in your own words
- [ ] Why retries with jitter, not retries
- [ ] Metastable failure — what it is, why it doesn't self-heal
- [ ] Load shedding as the answer
- [ ] Canary vs blue-green vs rolling — when each fits

---

## Postmortems

> One per module, written by you (not Claude) at Stage 7. Keep them in `/postmortems/MN-postmortem.md` and link here.

- M1: [M1-postmortem.md](postmortems/M1-postmortem.md)
- M2: [M2-postmortem.md](postmortems/M2-postmortem.md)
- ... etc

---

## Re-Reads & Side-Quests

> Books and posts you read *after* feeling the pain. Track which page/chapter mapped to which failure — that's the only reading log that matters.

| Date | Source | Triggered by | One-line takeaway |
|------|--------|--------------|-------------------|
| _ex: 2026-05-15_ | _DDIA Ch. 7_ | _F-04 (read-your-writes 404)_ | _"Linearizability is what most people think 'consistency' means"_ |

---

## Session Log

> Optional but recommended. One line per session. Helps you notice patterns ("I always burn out on Stage 4 — maybe I'm rushing Stage 3").

| Date | Duration | Module/Stage | What I shipped | What I'm avoiding |
|------|----------|--------------|----------------|-------------------|
| 2026-04-28 | 4 | M1 S1→S4 | k6 load tests, EXPLAIN ANALYZE, ON CONFLICT upsert, timeouts | pool size comparison runs |
| 2026-04-28 | 3 | M1 S4 | pool size experiments, Little's Law, F-03, EC2+RDS deploy, k6 from AWS, teardown | — |
| 2026-04-29 | 30m | M1 S6 | backpressure, idempotency, graceful shutdown verification, cost check ($0.11) | postmortem |
| 2026-04-30 | 30m | M1 S7 | postmortem review, progress.md cleanup, M1 closed | — |
| 2026-05-01 | ~Xh | M2 S0→S3 | Audited M1 API, restructured into routes/controllers/services, error envelope, 404 handler, cursor pagination | idempotency keys |
| 2026-05-04 | ~Xh | M2 S3 | idempotency keys — migration, middleware, advisory lock, race condition test | — |
| 2026-05-06 | ~Xh | M2 S4 | processBatchInsertJob with savepoints, bulk_job_results schema, partial/failed/completed states | polling endpoint, webhooks |
| 2026-05-07 | ~Xh | M2 S4 | polling endpoint, webhook with retry+timeout, idempotency verified, webhook retry test against local 500 server, reproduced retry storm (F-06), added full jitter to backoff | — |
| 2026-05-07 | ~Xh | M2 S5 | ALB created, EC2 deployed, RDS provisioned, security groups wired, migrations partially applied (0001-0004 clean, 0005 partial, 0006-0007 pending) | migrations completion, k6 load test through ALB |
| 2026-05-08 | ~Xh | M2 S5→S6 | migrations fixed, k6 through ALB (p95 290ms), teardown, cost logged | postmortem |
| 2026-05-08 | 30m | M2 S6 | postmortem |  |
| 2026-05-12 | Xh | M3 S0 | Added Redis cache, baseline p50 46ms → 1.24ms with cache |
| 2026-05-14 | Xh | M3 S1 | Reproduced thundering herd (F-07), designed single-flight fix | implementing the fix |
