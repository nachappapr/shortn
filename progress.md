## Current Position
Current Position: Module 4, Stage 3 (in progress — worker unit CODED, happy-path GREEN; crash test next)
Module: Module 4
Stage: 3
Last session: 2026-07-02
Next action: Worker unit CODED & happy-path VERIFIED this session (60 URLs → 60
completed, bulk_jobs → 'completed'). Two worker versions now exist, deliberately, for
contrast:
  - processBatchInsertJob   — PER-ROW transaction (BEGIN/INSERT/UPDATE/COMMIT per URL):
    per-row failure isolation, N round trips. The correctness-first shape.
  - processBatchInsertJobV2 — TRUE BATCH (one CTE per chunk, all-or-nothing per chunk):
    fewer commits (throughput), but one bad row condemns the whole chunk + loses per-row
    error identity. Kept as a learning artifact.
Both share: atomic claim (UPDATE...WHERE id AND status='pending' RETURNING id, branch on
rowCount===0 → return); heartbeat setInterval(5s) started AFTER claim wins, clearInterval
in finally; terminal status derived from a POST-LOOP aggregate query over bulk_job_items
(NOT in-memory counters — a reaped worker only has its own partial counts in RAM), fed to
getFInalCompletionStatus → completed/partial/failed.

CRASH TEST IS THE ACTUAL POINT OF STAGE 3 — still ahead, do it next:
(1) ✅ bulk_job_items migration + backfill — DONE 2026-06-30.
(2) ✅ atomic claim — CODED & running.
(3) ✅ heartbeat (5s, cleared in finally) — CODED & running.
(4) reaper cron (~60s) — DESIGNED, NOT YET CODED. Predicate: status='processing' AND
    updated_at < now() - interval '15s'. (< not >: stale = pulse fell BEHIND cutoff.)
(5) dispatcher cron (~1–2s) — DESIGNED, NOT YET CODED. Scan status='pending', run claim.
(6) worker resume query — DESIGNED (already implicit in the WHERE status='pending' item
    scan), NOT YET wired as the resume path.
Crash-test recipe (agreed this session): 60-URL body, small chunk, add a TEST-ONLY sleep
after each chunk commit so the job spans real wall-clock time (the sleep buys a mid-flight
kill window — the 60s reaper interval already guarantees the 15s pulse goes stale, so no
need to engineer staleness). kill -9 mid-job → watch reaper flip processing→pending on a
later sweep (from a SIBLING instance, not the dead box) → dispatcher re-claim → resume
query picks up ONLY the uncompleted items. If V2 (batch) is killed mid-chunk, whole chunk
returns pending (coarse); per-row returns row-granular. Rip the sleep out after.
Then k6 to pin chunk size (cost-per-commit/fsync vs work-lost-per-crash).

DON'T FORGET (carried): the bulk_job_results DROP TABLE is still a separate later migration
AFTER API cutover.

**Open questions / things I'm stuck on:**
- ~~Heartbeat granularity: in-txn per chunk vs separate write?~~ Resolved 2026-06-29:
  separate write on a fixed timer. Riding it inside the chunk txn makes the reaper
  threshold hostage to chunk size → false-reaps a healthy worker on a fat chunk →
  duplicate processor. See D-log 2026-06-29.
- ~~Stuck job reaper not implemented → now fully DESIGNED.~~ Reaper + dispatcher
  both designed 2026-06-30; reaper still not BUILT (code next session).
- ~~Known gap: failed-row error detail.~~ Resolved 2026-06-30: add a nullable
  `error TEXT` column on `bulk_job_items` (not derived elsewhere) — the row stays the
  complete per-item record, results+resume remain one indexed scan with no join. See
  D-log 2026-06-30.
- ~~Known gap: backfill migration not yet written.~~ Resolved 2026-06-30: expand-
  migrate-contract, backfill DONE & verified (26→26). Old table frozen; the `DROP
  TABLE` is still a SEPARATE later migration to write AFTER API cutover — don't forget
  it. See D-log 2026-06-30.
- Known gap (scale, deferred): each instance runs its own dispatcher cron, so at N
  instances N pollers race per ~2s tick. Safe via the atomic claim but wasteful —
  defer to leader election / SKIP LOCKED (literally the M5 preview).
- ~~Open-breaker behavior unverified — fail-over to DB or error to client?~~
  Resolved 2026-06-16: code returns SERVICE_UNAVAILABLE on breaker-open, and
  this is now the *intended* behavior (fail-closed) — see Decisions Log 2026-06-16.
  Not a bug. Revises the 2026-05-22 fail-open stance.
- Known gap: 30s max request origin unconfirmed — suspect onRedisUnavailable 
  DB fallback path under extreme pool contention. connectionTimeoutMillis 
  error message mismatch means timeout isn't caught correctly. 
  Fix: normalize error handling to catch all pg timeout variants.

---

## Module Status

| # | Module | Status | Started | Finished | Notes |
|---|--------|--------|---------|----------|-------|
| 1 | Single Box | ✅ Done | 2026-04-27 | 2026-04-29 | — |
| 2 | API Design | ✅ Done | 2026-05-01 | 2026-05-12 | — |
| 3 | Caching | ✅ Done| 2026-05-12 | 2026-06-11 | — |
| 4 | Horizontal Scale | 🟡 | 2026-06-11 | — | — |
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
| 2026-05-20 | 3 | On coalescing retry exhaustion, return 503 instead of falling back to DB | Two reasons: (1) if the lock holder hasn't warmed the cache before retries exhaust, it's about to — the client retry interval gives it time to land; (2) a DB fallback after all waiters have exhausted retries recreates the thundering herd at the application layer, defeating the entire lock | 503s are visible noise in client metrics and require the client to implement retries — callers that don't retry get a hard error instead of waiting transparently |
| 2026-05-21 | 3 | cache-aside over write-through for URL updates | write-through pays two round trips on every write (SET requires full object) and warms cache for entries that may never be read again; cache-aside only touches Redis on invalidation — DEL requires no value, no round trip to fetch the updated record | one cache miss after every update; healed on next read by the SETNX coalescing lock, so the miss never fans out to a stampede |
| 2026-05-22 | 3 | fail open to DB when Redis is down, but return 503 when the Redis connection pool is exhausted | Two distinct failure modes, two different responses. Redis down → fail open is a product call: a URL shortener should serve reads even in degraded state. Pool exhausted → 503 is a capacity signal, not a transient blip — falling back to DB when the pool is gone bypasses all coalescing protection and recreates the thundering herd at the DB layer | Redis-down fallback adds DB load during outages; pool-exhaustion 503s are visible noise to callers and require client retries |
| 2026-06-08 | 3 | Circuit breaker in front of Redis over per-call retry exhaustion | Per-call retries treat each request in isolation — under a network partition every request still pays the full socket timeout before failing, and the coalescing lock re-arms the trap on each TTL boundary (F-08). A breaker shares state across calls: once tripped it fails fast for *all* callers and skips Redis entirely until a half-open probe proves it's back | Adds shared mutable state and tuning (trip threshold, open duration, probe policy); a falsely-tripped breaker bypasses a healthy cache and sends full load to the DB |
| 2026-06-10 | 3 | `commandTimeout: 100ms` on Redis client | Without it, a silent network partition (packet black-hole) hangs each call ~15s on TCP retransmit timeout — the breaker takes ~75s to trip instead of protecting fast | A genuinely slow-but-healthy Redis moment above 100ms gets counted as a failure and can trip the breaker, dumping load on the DB |
| 2026-06-10 | 3 | commandTimeout raised from 100ms to 500ms for ElastiCache | Real p99 under 1000 VUs exceeded 100ms, falsely tripping the breaker and taking Redis offline. Timeout must be calibrated to peak load p99, not idle baseline | A genuinely slow Redis moment above 500ms now counts as a failure — acceptable tradeoff given measured p99 was well under 500ms |
| 2026-06-10 | 3 | retryCount++ bug fix → retryCount + 1 in coalescing lock retry loop | Post-increment passed current value to recursive call, never advancing the counter — retry loop never exited, producing 30s max requests under load | — |
| 2026-06-11 | 4 | Redis-backed rate limiter over in-memory | in-memory state is per-instance — 3 instances means 3x the allowed limit effectively | extra Redis round trip on every request; if Redis is down, rate limiting fails open |
| 2026-06-12 | 4 | Accept per-instance circuit breaker state (over shared-in-Redis or gossip) | Shared-in-Redis is a circular dependency — the breaker exists to protect against Redis failure, so its state can't live in Redis; gossip adds a coordination protocol for marginal benefit; at 3 instances the blast radius of disagreement is too small to justify shared-state complexity | Split-brain during Redis incidents (F-09): instances disagree on breaker state, producing bimodal latency, and each instance pays its own trip/half-open-probe cycle. Flips at scale — a large fleet means N independent half-open probes hammering a recovering Redis and a longer window of inconsistent client experience |
| 2026-06-23 | 4 | Mint request ID at Nginx edge (`$request_id`), forward as `X-Request-ID`; Node reads header, generates UUID only as fallback | The outermost component that touches the request should mint the ID so it covers the *entire* lifetime — including hops upstream of the app (LB timeout, all instances busy) that an app-minted ID would be blind to. Node generating its own when the header is present would sever the chain: two IDs for one request, defeating tracing | Trusting an inbound header means a client could spoof `X-Request-ID`; fine internally (Nginx overwrites/sets it) but must not be trusted as a security identifier |
| 2026-06-23 | 4 | Carry request ID via `AsyncLocalStorage`, not by threading `req` through every function | A shared module-level `let currentRequestId` is clobbered when requests interleave on the event loop (A parks at `await`, B overwrites, A resumes reading B's id — silent mis-attribution). Threading `req` everywhere pollutes non-HTTP function signatures (cacheService, redis wrapper) just so logs can reach the id. `als` binds the id to the async execution context, isolated per request, readable at any depth | Adds an implicit-context mechanism that's easy to misuse (reading `getStore()` at module load captures the startup value forever — must read at call time, per call); instanceId stays a process-level const since it never changes |
| 2026-06-25 | 4 | Switch bulk job processing from single-outer-transaction (all-or-nothing) to incremental commits (durable per-chunk progress) | a worker crash near the end of a large batch rolls back all completed work, forcing a full redo and showing the polling client zero progress after minutes of waiting — a broken promise, not just wasted CPU | the job is now observable mid-flight (rows commit as they go), but we take on resumability — a reaped job must resume from where the dead worker stopped, not restart, which reintroduces the duplicate-work / double-claim problem a reaper must guard against |
| 2026-06-25 | 4 | Persist batch input as child rows in `bulk_job_items` (one per URL, with per-item status), written at job creation | input must outlive the worker process for a reaped job to resume; per-item status makes "remaining work" a single indexed query instead of diffing inputs against `bulk_job_results` | N extra rows + N status updates per job; the input is now stored twice (request body + item rows) until the job completes |
| 2026-06-25 | 4 | Merge `bulk_job_results` into `bulk_job_items`: one row per input URL carrying URL + status + result (`url_id`/error) | input and output were two near-identical tables; one table makes "remaining work" and "results" the same query and removes the input/output diff on resume | migration to move/backfill existing result rows; the row is now mutated in place (pending→completed) rather than insert-only, so the audit trail of "when did this flip" is lost unless we add it |
| 2026-06-29 | 4 | Heartbeat (`updated_at` bump) is a separate write on a fixed timer, not ridden inside the chunk transaction | coupling heartbeat to chunk commit makes the reaper threshold hostage to chunk size — a slow chunk false-reaps a healthy worker, spawning a duplicate processor | heartbeat can persist after the work it implied rolls back, but that's harmless — resumption keys off committed item status, not the heartbeat, so a stale pulse only delays the reap by seconds |
| 2026-06-29 | 4 | Partial index on `bulk_job_items (job_id) WHERE status='pending'` for the resume query, over a composite `(job_id, status)` | high-write table; only pending rows are ever queried on the hot path. The partial index materializes only pending entries and drops them as items complete, keeping the index small and write cost low | index is unusable for non-pending queries (e.g. "show completed items") — acceptable, that's a cold path |
| 2026-06-29 | 4 | Two separate crons — reaper (~60s, unstrand dead workers) and dispatcher (~1–2s, pick up pending jobs) — over one fused cron | different staleness tolerances: a dead job waiting 60s to be reaped is harmless, but a new job waiting 60s to *start* is not. Fusing forces both to the fast interval, wasting scans on dead-worker detection every tick | two crons to maintain instead of one; at N instances each runs its own dispatcher, so N pollers race per tick — safe via atomic claim but wasteful at scale (defer to leader election / `SKIP LOCKED`) |
| 2026-06-29 | 4 | `bulk_job_items.url_id` is `ON DELETE SET NULL` (not CASCADE) | the item row is a historical record of what the batch contained — deleting a shortened URL months later shouldn't erase the fact it was part of bulk job #847. SET NULL keeps the row, just nulls the pointer (same shape as a failed row's null url_id) | creates a distinct state: `status='completed'` + null `url_id` means "succeeded once, result since deleted" — code reading results must treat null url_id as "no live result" regardless of status |
| 2026-06-30 | 4 | Failed-row error detail lives in a nullable `error TEXT` column on `bulk_job_items`, not derived elsewhere | the row is the complete per-item lifecycle record; status + error + url_id on one row makes results and resume the same indexed scan with no join | another nullable column whose meaning is only legible in combination with status — the client/result-builder must branch on status first, not on column nullity |
| 2026-06-30 | 4 | Backfill `bulk_job_results` → `bulk_job_items` via expand-migrate-contract; defer the `DROP TABLE` to a later migration after API cutover, not the migration that creates the new table | during a rolling deploy both old and new code run simultaneously — dropping the old table immediately fails any in-flight request still on the old path. Keeping both tables until all readers/writers are migrated means no instance ever finds its expected table missing | a window where both tables coexist and the old one must be treated as frozen (no new writes), plus a second migration to remember later for the drop |
| 2026-07-02 | 4 | Terminal job status (`completed`/`partial`/`failed`) is derived from a post-loop aggregate query over `bulk_job_items`, NOT from in-memory `successCount`/`failedCount` counters incremented during the loop | the job is resumable — a reaped worker inherits a job a dead worker already made progress on, and starts with its counters at zero in fresh RAM. Counters only ever reflect the *current* worker's slice, so a resumed worker would stamp `completed` over a job that actually has failures the dead worker recorded in the table. The table is the source of truth; RAM dies with the process | one extra aggregate query per job at the end; the verdict is only as correct as the committed row statuses (fine — that's exactly what durability bought us) |
| 2026-07-02 | 4 | Keep BOTH a per-row-transaction worker (`processBatchInsertJob`) and a true-batch CTE worker (`processBatchInsertJobV2`); for `shortn`'s workload the per-row shape is the correct default | URL inserts fail *independently* (one bad URL is not the batch's shared fate), so a bulk/all-or-nothing statement condemns all N rows for one bad row AND collapses per-row error identity (every failed row gets the same error text). Per-row isolation is a *correctness* property already decided ("19 good, 1 fails"); batch buys *throughput* (fewer commits/fsync) which is unmeasurable at 60 URLs. Kept the batch version only as a learning artifact to feel the contrast | per-row pays N round trips per job (invisible at this scale, real at 10k+); maintaining two code paths that must not drift. Batch/bulk is the right tool only when the batch shares a single fate — not here |

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
- **What broke:** P99 spiked due to DB connection pool exhaustion — 4012 failures (0.47% error rate)
- **Root cause in one sentence:** When the cache expires, every concurrent request misses simultaneously and races to query the DB, exhausting the connection pool before any response can be cached
- **Fix:** Redis SETNX coalescing lock — only one request queries the DB while the rest wait and retry until the cache is warm; on retry exhaustion return 503 (no DB fallback — see Decisions Log 2026-05-20) — result: 0 failures after fix
- **What I'd watch for in production:** P99 spikes that correlate with TTL boundaries or cache restarts — that's the signature

### F-08: Slow failures under Redis network partition (fail-open's blind spot)
- **Module/Stage:** M3 S4
- **What I did:** simulated a network partition between app and Redis (Redis process up, network unreachable) while concurrent requests hit the same cold key
- **What broke:** every request stalled on Redis. The first request acquired the SETNX lock but its call never returned (network black-holed, no RST); waiters retried until exhausted; once the lock TTL expired, the next wave of requests re-acquired the lock and repeated the same hang — a sustained queue of slow failures instead of fast ones
- **Root cause in one sentence:** fail-open assumes Redis calls fail *fast*, but a network partition (vs. a dead process) gives no signal — calls hang until socket timeout, so every request pays the full timeout and the coalescing lock keeps re-arming the trap on each TTL boundary
- **Fix:** circuit breaker in front of Redis — closed = healthy (normal path), open = Redis treated as down, skip it and fall through to DB immediately, half-open = single probe request decides whether to close again. Trips on consecutive timeouts/errors, not just exceptions. **Correction (2026-06-10):** the breaker alone wasn't enough. Without `commandTimeout: 100ms` on the Redis client, each call still hangs ~15s under a true silent partition — the breaker never sees errors fast enough to trip. The timeout is what converts a 15s hang into a fast failure the breaker can act on.
- **What I'd watch for in production:** p99 latency climbing toward the Redis socket timeout (not spiking past it) while Redis health checks still pass — that gap between "Redis is up" and "Redis is reachable from the app" is where fail-open silently degrades into slow failure

### F-09: Circuit breaker split-brain across instances
- **Module/Stage:** M4 S1
- **What I did:** ran 3 app instances behind Nginx and partitioned Redis mid-load — each instance has its own in-memory circuit breaker
- **What broke:** each instance's breaker tripped (and recovered) independently, so identical requests landed on instances in different breaker states — some fast-failed to DB while others hung on dead Redis; half-open probes fired per-instance too, so the fleet never agreed on whether Redis was back
- **Root cause in one sentence:** breaker state is in-memory per Node process, so "is Redis healthy" is answered N times by N instances instead of once by the fleet — scale-out turned one circuit breaker into three that can disagree
- **Fix:** accept per-instance breaker state — blast radius too small to justify shared-state complexity. Shared-in-Redis rejected: circular dependency — the breaker exists to protect against Redis failure, so its state can't live in Redis (see Decisions Log 2026-06-12)
- **What I'd watch for in production:** bimodal redirect latency / p50–p99 divergence on the same endpoint during a Redis blip — the histogram splits into a fast-fail hump (~1–5ms, open breaker → DB) and a hung-on-timeout hump (~500ms, closed breaker → dead Redis); a coherent fleet shifts as one peak, a split-brain fleet shows two
---

## Cost Log

> Pulled from AWS Cost Explorer at the end of each AWS exercise. Track even if it's $0.30 — pattern recognition matters more than the absolute number.

| Date | Module | Services used | Hours active | Cost (USD) | Notes |
|------|--------|---------------|--------------|------------|-------|
| 2026-04-28 | 1 | RDS db.t3.micro, EC2 t3.micro x2, VPC, EC2-Other | 2h | $0.11 | RDS $0.06, EC2 $0.03, VPC $0.01, EC2-Other $0.01 — Mumbai region |
| 2026-05-08 | 2 | Route 53, EC2, RDS, VPC, Others | ~2d | $0.72 (+$0.13 tax = $0.85) | Route 53 $0.50, EC2 $0.09, RDS $0.06, VPC $0.04, Others $0.03 — ALB + load test session |
| 2026-06-10 | 3 | EC2, RDS, VPC, ElastiCache, Route 53 | ~6h | $0.76 (+$0.14 tax = $0.90) | ElastiCache too short-lived to bill; Route 53 $0.50 flat fee dominates again |


**Running total:** $1.59 (excl. tax) / $1.86 (incl. tax)

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
- [x] Cache-aside vs write-through — when each makes sense
- [x] Thundering herd — what it looks like in metrics
- [x] Why "fail open vs fail closed" is a product decision, not a tech one
- [x] Circuit breaker states (closed/open/half-open) without looking it up

### Module 4
- [ ] Every piece of accidental state in a single-instance app
- [x] Why distributed locks are not as simple as `SETNX` — a TTL releases on a blind clock: too short → it frees the lock under a worker that's still alive (two owners, duplicate work); too long → a genuinely dead worker's job stays frozen for the whole TTL, and each failed retry adds another full TTL. There's no safe middle because the TTL is guessing at something it can't observe — "is the worker alive?". A correct lock needs a *liveness signal*. The Postgres claim (`UPDATE...WHERE status='pending'`) has no timer — the row stays 'processing' until something *deliberately* moves it, so two owners is structurally impossible; the dead-worker case is handled by the reaper, which *checks a heartbeat* (observes liveness) rather than counting down a clock. The reaper is "a TTL done right" — its threshold is keyed to the heartbeat cadence (constant), not to job length.
- [x] Atomic claim vs check-then-act — `UPDATE...WHERE id AND status='pending'` fuses the check into the locked write, so the loser blocks, Postgres re-evaluates the predicate against the winner's committed row (EvalPlanQual recheck), it fails, rowCount=0 → walk away. A SELECT-then-UPDATE races because the SELECT holds no lock: both workers read 'pending' unlocked, and the second UPDATE (`WHERE id` only, no status) blindly overwrites — the claim decision was made before any lock existed. The lock at UPDATE time is too late; the decision must live *inside* the lock. rowCount is the signal; RETURNING id feeds the winner. Same shape as an idempotent `ON CONFLICT DO NOTHING` — let the single atomic statement *be* the check, then read the result. (Reaper resets to 'pending', so re-claim == claim: one path, no special case.)
- [ ] Fencing tokens — what they prevent that TTLs can't
- [ ] Stateless vs stateful services, sharply
- [x] Bimodal latency / circuit-breaker split-brain — why per-instance breaker state splits one endpoint's latency histogram into two humps (fast-fail open breaker vs slow-fail closed breaker waiting out commandTimeout), and why a single p95 lands in the empty valley between them and lies
- [x] Request-ID / correlation-ID tracing across instances — before: 3 separate log streams, a "slow at 14:32" complaint can't be tied to one request because timestamps collide, the code isn't unique per trip, and user/IP identifies the person not the request; after: one ID minted at Nginx, forwarded inward unchanged, stamped on every line via AsyncLocalStorage, so grepping one id assembles the whole journey (Nginx + app + breaker) and tells you which instance served it and what its breaker was doing

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
| 2026-05-20 | Xh | M3 S1 | Implemented Redis SETNX coalescing lock, 503-on-retry-exhaustion pattern; 4012 failures → 0; logged F-07 final numbers and D-log entry | — |
| 2026-05-20 | Xh | M3 S3 | Redis INFO stats, confirmed 99.85% hit rate, proved DB called exactly once per cache miss event via application logs | — |
| 2026-05-21 | Xh | M3 S3 | Fail open with Redis pool exhaustion circuit — 503 on pool exhaustion instead of DB fallback; logged decision | — |
| 2026-06-08 | 3 | M3 S4→S5 | Circuit breaker in front of Redis (closed/open/half-open) after reproducing network-partition slow-failures (F-08); logged breaker-over-retry-exhaustion decision; noted per-process breaker state as M4 gap | — |
| 2026-06-10 | Xh | M3 S5 | VPC + EC2 + ElastiCache + RDS provisioned on AWS; measured cross-AZ latency (0.54ms avg); calibrated commandTimeout to 500ms; fixed retryCount++ bug; 0% errors at 1273 RPS | Multi-AZ replica (AWS console limitation) |
| 2026-06-11 | 3h | M4 S0 | Added 3 Node.js app instances behind Nginx (upstream round-robin); added global rate limiter in Redis (fixed-window counter per IP); containerized with Docker Compose | — |
| 2026-06-12 | Xh | M4 S1 | Reproduced circuit breaker split-brain across 3 instances (F-09); derived bimodal latency / p50–p99 divergence as the production signal; decided to accept per-instance breaker state for now | verifying open-breaker behavior (DB fail-over vs client error) |
| 2026-06-16 | Xh | M4 S1 | Traced open-breaker path in code → confirmed returns SERVICE_UNAVAILABLE; decided fail-closed is the intended behavior (D-log 2026-06-16, revises 2026-05-22 fail-open); re-derived bimodal latency from first principles and earned the concept; reaffirmed accept-split-brain (shared state deferred to next module) | Stage 2 (centralized logging / request-ID tracing) |
| 2026-06-23 | Xh | M4 S2 | Request-ID propagation: Nginx mints `$request_id` + logs it (traced log_format) + forwards `X-Request-ID`; Node middleware reads header w/ UUID fallback, runs request inside `als.run`; logger pulls requestId from `als.getStore()` (call-time) + instanceId from process const; breaker logs the trip/fallback decision (colocated w/ cause, id attaches via als). Verification half-done — burst hit the rate limiter (all 429), concept confirmed instead | Re-running trace verification past the rate limiter; logging the other endpoints |
| 2026-06-25 | Xh | M4 S3 | Designed durable/resumable batch processing: chunked commits over single-txn; persist input as bulk_job_items; merge bulk_job_results into it; atomic DB claim (UPDATE...WHERE status='pending') over Redis SETNX for single-winner; reaper cron keyed on stale heartbeat; heartbeat on bulk_jobs row. Design only, no code | heartbeat in-txn or separate; the actual build; k6 for chunk size + threshold |
| 2026-06-29 | Xh | M4 S3 | Finished the resumable-batch design: heartbeat = separate timed write (not in chunk txn); finalized bulk_job_items migration (job_id NOT NULL, url_id ON DELETE SET NULL, partial index WHERE status='pending'); walked the atomic-claim row-lock semantics (re-claim == claim after reaper resets to pending); split reaper (~60s) from dispatcher (~1–2s) crons; established push-signal is optional, poll is the correctness floor; resume query = items WHERE job_id AND status='pending'. Earned the "SETNX isn't simple" concept (TTL trap both directions; reaper = TTL done right via heartbeat). Design fully locked, no code yet | the actual build (migration→claim→crons→resume); the failed-row `error` column decision; the backfill migration; k6 for chunk size |
| 2026-06-30 | Xh | M4 S3 | Resolved failed-row error col (nullable error TEXT on bulk_job_items, D-log); built + verified bulk_job_items migration + partial index; wrote & ran backfill (expand-migrate-contract, 26→26, old table frozen, drop deferred); designed+defended atomic claim (rowCount signal, why SELECT-then-UPDATE races), heartbeat (5s/15s 3× margin, clearInterval in finally), reaper (both-predicate, slow-is-fine tolerance); earned the atomic-claim concept | coding claim+heartbeat+reaper; dispatcher; resume query; k6 chunk size |
| 2026-07-02 | Xh | M4 S3 | CODED the worker unit + happy-path green (60→60 completed). Traced the full row lifecycle & every seam by hand before coding (heartbeat cleanup on the 3 exit paths, kill -9 = pulse-stops-itself, reaper caught by a sibling instance, resume via committed item status). Fixed 3 bugs in review: heartbeat 15s→5s (restore 3× margin), bare UPDATE → atomic claim w/ rowCount guard, per-job commit → per-row/per-chunk transactions on a checked-out client (release in finally). Killed the dead outer chunk loop; kept per-row + a true-batch V2 for contrast. Replaced in-memory counters w/ post-loop aggregate for terminal status (resumability). Generated 60-URL test body | THE CRASH TEST (kill -9 → reaper → dispatcher → resume) — the actual point of Stage 3; reaper+dispatcher crons not yet coded; k6 chunk size |