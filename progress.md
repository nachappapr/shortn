## Current Position
Current Position: Module 4, Stage 4 — IN PROGRESS, NEARLY CLOSED. Session 08-26 closed
  the two oldest open items and one carried receipt:
  (1) The CREATION TRANSACTION is BUILT — but NOT as a transaction. `createBatchInsertJobV2`
  is now a SINGLE-STATEMENT CTE, so atomicity is free (every statement in PG runs in its own
  implicit transaction) and the 07-07 "no pinned client, `pool.query` everywhere"
  simplification survives intact. AMENDS 08-18, which had accepted `pool.connect`/BEGIN/COMMIT
  as the price. Includes `WHERE cardinality($2::text[]) > 0` so a zero-item job is
  structurally unrepresentable, not merely rejected upstream by the validator.
  (2) `21000` is CLOSED by CHUNK-TIME DEDUPE (`DISTINCT ON (u.url)` over a multi-argument
  `unnest($1,$2)`), NOT by extending the classifier. The allowlist stays `23xxx`-only because
  the error can no longer be raised. Client still gets 60-in / 60-out; duplicates share one
  `url_id` via the url-based join, which is exactly the 08-18 global-code rule.
  (3) The real `23xxx` receipt is CLOSED: a genuine Postgres `23514` (`check_url_format`)
  executed the permanent branch for the first time — `DatabaseError`, real SQLSTATE, not the
  hand-built `23123`. Chunks 20 and 40 logged `chunk_ok` after it, which also DEMONSTRATES
  the head-of-line argument for `continue` instead of a blanket un-fail-on-retry.
  Prior session (08-24): THE TRANSIENT-FAILED-ITEMS BUG IS FIXED AND PROVEN (F-13). Chunk failures now classify on `err.code`: `23xxx`
  permanent (stamp + continue), everything else transient (rethrow into the outer catch's
  retry path). Both branches executed deliberately via a new `FORCE_CHUNK_ERROR` hook —
  the bug is no longer correct-by-timing. Also settled a 7-week notes-vs-code drift: the
  CTE worker is the default, amending 07-02.
  Prior session (08-21): the k6 chunk ladder validated `query_timeout: 5000` at
  6 / 12 / 24 concurrent jobs (max 2 / 4 / 18ms); chunk size stays 20.
Module: Module 4
Stage: 4 (break the fix) 🟡
Last session: 2026-08-26
Next action: Stage 4 has ONE UNPAID RECEIPT. The creation CTE's `cardinality > 0` branch
  has NEVER EXECUTED. Run it: temporarily relax the validator, POST an empty array, assert
  ZERO new rows in BOTH `bulk_jobs` and `bulk_job_items`. Until that run, the creation fix
  is BUILT AND REASONED, **NOT PROVEN** — do not write "proven" in this file for it. The
  `23514` run proved the CHUNK CLASSIFIER, not the creation statement; the null went
  straight through creation untouched.
  Then: cleanup (the typo'd `console.log("premanentErrors", ...)` — still visible in the
  08-26 logs — and the shadowed `error` in the nested guard's catch), and close Stage 4.
  503 translation is DEFERRED TO STAGE 5 (see Open questions — this is a judgement call
  worth revisiting, it is not obviously AWS work).

### K6 CHUNK RUN — RESULT (ran 2026-08-21)

| rung (concurrent jobs) | chunks | max chunk | wall clock for the whole burst |
|---|---|---|---|
| 6  | 18 | 2ms  | 9ms  |
| 12 | 36 | 4ms  | 36ms |
| 24 | 72 | 18ms | 75ms |

  - VERDICT: `query_timeout: 5000` holds. Worst observed chunk = 18ms →
    ~277× margin. CHUNK SIZE STAYS 20. No change shipped.
  - THE CURVE IS NOT LINEAR: 2 → 4 → 18 for 2× steps each. The last step is
    4.5× for 2× the load. So this measures MARGIN, not HEADROOM — where the
    wall is remains unknown, and the punishment is a CLIFF not a slope
    (4999ms completes; 5001ms cancels and stamps 20 healthy URLs `failed`).
  - THE 18ms SPIKE was 7 chunks landing inside 4ms of each other, all of
    them chunk 0, ACROSS TWO INSTANCES. Two independent Node processes slow
    at the same instant by the same amount → the shared thing is the cause,
    i.e. Postgres, not an event loop. Attributed to the creation-write
    backlog: 24 POSTs × 60 item rows ≈ 1,440 inserts landing moments
    earlier. Every chunk after index 0 dropped back to 2–6ms — the backlog
    clears in ~4ms. **Attributed by inference, NOT proven** — proving it
    means timing the creation insert too and checking the overlap.
  - WHY THE FIRST RUNGS MEASURED NOTHING: 6 and 12 jobs never produced 6 or
    12 concurrent chunks. ~2–3 chunks in flight, `pg_stat_activity` showed
    1–2 active, pool of 10 mostly idle. A Node instance can only SEND one
    query at a time, and it spends most of its life not-querying (parsing
    POSTs, building 60-URL arrays, randomBytes ×60, writing item rows). The
    apps could not feed the DB fast enough to make it struggle. Real
    contention only appeared at 24 — and even then it was creation-write
    pressure, not chunk-vs-chunk.
  - CORRECTION TO THE 08-18 DESIGN NOTE (it was WRONG): the `query_timeout`
    clock does NOT include pool-wait. `pool.query()` is two steps —
    `pool.connect()` (governed by `connectionTimeoutMillis`) then
    `client.query()` (governed by `query_timeout`). The timer is armed
    AFTER a connection is in hand. So the "waits 3s for a connection,
    executes in 500ms, trips 5000ms" scenario cannot happen. Measuring in
    Node is still correct, but for a sharper reason: what the timeout
    enforces is send → reply-handled (PG time + network + Node's delay in
    noticing the reply), and `pg_stat_statements` sees only the middle
    slice — plus it gives mean/min/max, never a percentile.
  - HARNESS (this was the 08-18 blocker, now solved): k6 with
    `executor: "per-vu-iterations"`, `vus: N`, `iterations: 1`. All N VUs
    fire one POST together — a starting gun, not RPS. k6's own numbers are
    irrelevant (it measures the 202, ~5ms); the data lives in the app logs.
    Per-VU unique URLs are MANDATORY (`vu-${__VU}/...`) or every job fights
    the same rows through `ON CONFLICT` and you measure lock queueing on
    deliberately identical data. Tag the run too (`RUN=r6/r12/r24`) or
    later rungs take the DO UPDATE path instead of the insert path and the
    rungs stop being comparable.
  - INSTRUMENTATION NOW PERMANENT: `t0 = Date.now()` OUTSIDE the chunk
    try (so a failure gets a duration too), one JSON line per chunk —
    `chunk_ok` / `chunk_fail` with jobId, chunk index, durationMs, error;
    instanceId rides along via the M4-S2 logger. JSON so p99 is a 5-line
    script, not a regex at 11pm.
  - CAVEAT ON THE WHOLE RESULT: laptop, Docker, unloaded PG, 60-URL jobs,
    repeated URLs on some runs. 277× absorbs a lot of that, but it is not
    proof at production scale.


Verified this session (2026-08-18) — cold-start code read:
  - COLD-START RITUAL after a long gap: read the CODE against the NOTES
    before trusting either. This is the F-12 lesson generalized — the
    notes said the guard shipped and the code disagreed for 11 days.
    28 days is a wider version of the same gap. Audit held: guard is in
    the worker's outer catch with log-before-write ordering, dispatcher's
    dead try/catch is deleted, `query_timeout: 5000` is on the pool.
  - ORPHAN JOB found (new): `createBatchInsertJobV2` does two UNWRAPPED
    writes — insert `bulk_jobs`, then insert `bulk_job_items`. If the
    second throws (or the process dies between them), a `pending` job row
    exists with ZERO item rows. Not the reaper's problem — the row is
    already `pending`, so the DISPATCHER picks it up ~2s later. Worker
    claims it, self-queries, gets zero rows, loop never runs, aggregate
    reads 0/0/0, and `notDelivered=0` is checked first → verdict
    **`completed`**. A job with no items reports success. Blast radius is
    small (the controller's catch 500s, so no client holds the jobId and
    nobody polls it) but it's a wasted claim cycle and a lying row.
    → FIX = transaction around both writes. NOT a guard in the verdict
    function: with the transaction in place a zero-item job is
    unreachable, so a guard would be an unprovable branch next to a
    failure path it claims to cover — the exact F-12 disease.
  - INNER CATCH mislabels transient failures (new, carried): when a chunk
    throws, the catch stamps those 20 items `status='failed'` — and
    NOTHING ever moves an item from `failed` back to `pending`. The
    resume query only selects `pending`. So `failed` currently means both
    "this URL is bad" (correct, permanent) and "the DB blipped for 2
    seconds" (a false accusation, also permanent). Today it self-corrects
    ONLY because the recovery write hits the same dead DB and throws,
    escaping to the outer catch which retries the whole job. If PG comes
    back a moment earlier, the write lands and 20 healthy URLs are dead
    for good. **Correctness by timing — same smell as F-12, where the
    07-09 test passed because PG returned at the right moment.**
    → **FIXED 2026-08-24, see F-13.** Chunk failures now classify on
    `err.code`: `23xxx` permanent (stamp + continue), everything else
    transient (touch nothing, rethrow to the outer catch's retry path).
  - ON CONFLICT (original_url) is a PRODUCT decision hiding in a DB
    clause (new): same URL always maps to the same code, fleet-wide,
    forever. Arrived as a side effect of duplicate-protection on retry;
    nobody decided it. Blocks per-user analytics on a shared destination,
    custom codes, per-user expiry. Cheap to change now, expensive once
    there's data. Accepted deliberately; logged.
  - Re-derived (not new, but re-earned): claim = take + start-the-clock +
    count-the-try in one statement; losers BLOCK, then PG re-checks their
    WHERE against the winner's committed row (EvalPlanQual) → rowCount=0,
    and losers burn no attempt. The controller's un-awaited worker fire
    races the 3 dispatchers for a fresh job — all safe, same referee.
  - Re-derived: `attempts` copy must sit above anything that can throw.
    A stale `0` in the catch makes `attempts < maxAttempts` always true →
    job goes back to `pending` forever, cap unreachable. Also noted the
    `?.` / `|| 0` on that line is dead weight (rowCount===0 already
    returned above) and actively harmful if it ever fired — silently
    substituting 0 is the exact stale-value bug.
  - Re-derived: fast lane vs slow lane = "the fast lane handles the
    errors your code SURVIVES; the slow lane handles the ones it
    doesn't." Reaper is the floor, not the normal path.

CARRIED / DON'T FORGET:
- ~~k6 to pin chunk size — THE MAIN EVENT~~ — DONE 2026-08-21. Result block
  above; D-logged. Chunk size 20 and query_timeout 5000 both unchanged.
- NEW: the `AND status = 'pending'` on the inner catch's recovery write is
  LOAD-BEARING, and not for the reason it was written. It was added to
  avoid stomping an existing error. What it ALSO buys: `query_timeout` is
  a client-side timer — Node gives up and stamps items `failed` while the
  abandoned CTE may still commit server-side. If the CTE commits first the
  predicate no longer matches (rowCount=0); if the catch's UPDATE arrives
  first it BLOCKS on the CTE's row locks and PG re-checks the predicate
  against the winner's committed row (EvalPlanQual again, same referee as
  the atomic claim) → also rowCount=0. Either ordering is safe. DO NOT
  "simplify" this predicate away as redundant.
  **PROVEN 2026-08-24** (F-13 `after` run: throw AFTER the CTE committed →
  `chunk_failed` logged at 4ms, predicate matched nothing, 60/60 completed,
  short codes live). Retired from reasoned to demonstrated.
- NEW: the curve is non-linear (2 → 4 → 18ms for 6 → 12 → 24). Headroom
  past 24 concurrent jobs is UNMEASURED. Re-run the ladder if job volume,
  job size, or DB hardware changes.
- NEW: the 18ms spike is attributed to creation-write backlog by inference.
  To prove it: time the creation insert as well and check whether creation
  writes were genuinely in flight during the spike window.
- UNEXPLAINED (08-19, vanished rather than fixed): a run where six workers
  logged chunks 0 and 20 but never 40, then a second cluster of jobs
  started 37s later — timing that fits reaper (15s stale + ~60s tick) plus
  dispatcher re-claim. Never confirmed; `bulk_jobs.attempts` on those rows
  would have settled it. If it reappears at higher rungs, that query is
  the way in.
- ~~inner catch stamps items `failed` on a TRANSIENT DB error and nothing
  ever un-fails them~~ — **FIXED 2026-08-24, F-13.** Classifier on
  `err.code`; both branches executed deliberately. D-logged.
- ~~wrap job creation in a transaction (decided 08-18, not yet built)~~ — **BUILT
  2026-08-26**, as a SINGLE-STATEMENT CTE, not BEGIN/COMMIT. D-logged. **RECEIPT
  OUTSTANDING:** the `cardinality > 0` branch has not been executed. Built ≠ proven.
- Optional receipt: live-test that query_timeout actually fires on the
  chunk CTE path (design review says yes; every link proven separately).
- Fencing tokens side-read (Kleppmann, queued since 06-29) — Option A's
  two-owner window is the concrete anchor for it.
- Dispatcher's discovery SELECT fails during a DB outage — harmless
  (skips a tick), confirmed instances keep breathing; no action needed.
- Dispatcher's discovery SELECT has NO LIMIT — fires a worker per pending
  job per tick per instance. Fine at current volume, ugly under a backlog.
  Related to the M5 SKIP LOCKED gap.
- 503-vs-500 translation for DB-down errors deferred (one branch in the
  error middleware: 57P01/ECONNREFUSED/ENOTFOUND → 503 + Retry-After).
- ~~Death-path partial/completed arm does NOT clear `error`~~ — DECIDED
  2026-08-18, keep it. D-logged.
- bulk_job_results DROP TABLE — separate later migration AFTER API cutover.
- ~~`21000` — ON CONFLICT DO UPDATE cannot affect row a second time~~ — **CLOSED
  2026-08-26** by chunk-time dedupe, not by classifier surgery. D-logged. NOTE HONESTLY:
  `21000` was found and closed BY REASONING — it was never once reproduced in a real run.
  The mechanism is understood (`DO UPDATE` only resolves conflicts against rows committed
  BEFORE the statement; a row created by the same command isn't in its snapshot, so PG
  refuses), and the dedupe makes it unraisable, but no log line has ever carried `21000`.
  Cheap receipt if ever wanted: revert the `DISTINCT ON` and POST a batch with the same URL
  twice inside chunk 0.
- NEW (08-26, asymmetry worth remembering): the SAME duplicate is harmless ACROSS chunks
  and fatal WITHIN one. Chunk 0 commits, so chunk 2's `DO UPDATE` has a visible row to
  resolve against. Identical client input, opposite outcomes, decided purely by where the
  chunk boundary lands. That is what made this a chunk-level fix rather than a data fix.
- ~~the real `23xxx` path has never executed (proven only with a fake `23123`)~~ —
  **CLOSED 2026-08-26.** A `null` inside the urls array produced a genuine
  `23514 check_url_format` violation from Postgres: `permanentErrors true errorCode 23514`,
  `chunk failed (items 0-20)`, then `chunk_ok` on 20 and 40. Real `DatabaseError`, real
  SQLSTATE, `instanceof` held, permanent branch stamped-and-continued as designed.
- Cleanup: stray `console.log("premanentErrors", ...)` left in the chunk catch (typo and
  all) — CONFIRMED STILL PRESENT, it showed up in the 08-26 run logs. Shadowed `error` in
  the nested guard's catch — rename to `writeError`.
- NEW (08-26): `bulk_job_items.url` is NULLABLE, discovered because a `null` sailed through
  creation and only died at the chunk. It should be `NOT NULL`. A malformed URL is client
  data — stampable `failed`, with a real error the client can act on. A `null` is the
  ABSENCE of data: nothing to report, nothing to resubmit, and under the CTE worker it
  condemns all 20 items in its chunk with one identical message (19 healthy). `NOT NULL`
  costs one precise 400; nullable costs 19 good URLs and tells nobody why. Small migration,
  not yet built.
- NEW (08-26): `DISTINCT ON (u.url) ... ORDER BY u.url` picks ARBITRARILY among tied rows,
  so which of the two generated codes survives is nondeterministic. Harmless today (both
  codes are random and equally valid) and one generated code goes unused per duplicate —
  also harmless, `randomBytes` is cheap and it never reaches PG. Add a tiebreaker only if
  determinism ever matters.
- OPEN (08-26, unanswered): after chunk-time dedupe, `chunkItems.length` (20) no longer
  equals the number of rows sent to the insert (19 with one duplicate). The TERMINAL VERDICT
  is safe — it comes from the post-loop aggregate (07-02), not from counting. But audit the
  chunk LOGGING and any per-chunk counter: a mismatch there won't throw, it will just report
  the wrong number quietly.

**Open questions / things I'm stuck on:**
- Known gap (scale, deferred): N dispatcher pollers race per tick → M5 (SKIP LOCKED).
- Known gap: 30s max request origin unconfirmed — carried from M3.
- Is Stage 4 done? k6 landed 08-21; transient-failed-items closed 08-24 (F-13); creation
  CTE + `21000` + the real `23xxx` receipt all landed 08-26. Remaining before close: the
  `cardinality > 0` execution receipt, and the two cleanup items. That is the whole list.
- 503 translation: FILED AS STAGE 5 on 08-26 — but flag this as a judgement call, because
  it is not obviously AWS-native work either. It is one branch in the error middleware
  (`57P01` / `ECONNREFUSED` / `ENOTFOUND` → 503 + `Retry-After`), and it is the SAME SHAPE
  as the F-13 classifier: read `err.code`, decide whether the failure is about the request
  or about the plumbing, and say so honestly. Difference is the audience — F-13 talks to the
  retry loop, this talks to the client. The 07-09 `process.exit(-1)` removal explicitly
  deferred it, and every `docker stop postgres` since (including the F-13 transient run) has
  had a healthy app answering clients with 500 while nothing in the code was broken.

---

## Module Status

| # | Module | Status | Started | Finished | Notes |
|---|--------|--------|---------|----------|-------|
| 1 | Single Box | ✅ Done | 2026-04-27 | 2026-04-29 | — |
| 2 | API Design | ✅ Done | 2026-05-01 | 2026-05-12 | — |
| 3 | Caching | ✅ Done| 2026-05-12 | 2026-06-11 | — |
| 4 | Horizontal Scale | 🟡 | 2026-06-11 | — | S3 ✅ closed 07-09; S4 🟡 in progress (guard branch proven 07-20, F-12; cold-start re-audit 08-18 clean, 3 new findings; k6 chunk run DONE 08-21 — 5000ms validated, chunk size 20 unchanged; transient-failed-items fixed 08-24, F-13; creation CTE built + `21000` closed by dedupe + real `23514` receipt 08-26 — one unpaid receipt left); S5/S6/S7 remain |
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
| 2026-07-02 | 4 | Keep BOTH a per-row-transaction worker (`processBatchInsertJob`) and a true-batch CTE worker (`processBatchInsertJobV2`); for `shortn`'s workload the per-row shape is the correct default | URL inserts fail *independently* (one bad URL is not the batch's shared fate), so a bulk/all-or-nothing statement condemns all N rows for one bad row AND collapses per-row error identity (every failed row gets the same error text). Per-row isolation is a *correctness* property already decided ("19 good, 1 fails"); batch buys *throughput* (fewer commits/fsync) which is unmeasurable at 60 URLs. Kept the batch version only as a learning artifact to feel the contrast. **AMENDED 2026-08-24 — this is no longer true: the CTE worker (`processBatchInsertJobV2`) is the default and has been since 07-03. See the 2026-08-24 row.** | per-row pays N round trips per job (invisible at this scale, real at 10k+); maintaining two code paths that must not drift. Batch/bulk is the right tool only when the batch shares a single fate — not here |
| 2026-07-03 | 4 | Worker takes `jobId` ONLY and self-queries its work (`bulk_job_items WHERE job_id AND status='pending'`) as its first act, over trusting a caller-passed `urls` array | collapses fresh-start and resume into a SINGLE code path — the worker always asks the table "what's pending for this job?", getting all 60 on a fresh run and only the leftovers on a resume, so there is no "resume mode" to special-case and nothing to drift. The row status in the table is the single source of truth for "what's left"; an argument would be a second source that can disagree and cause reprocessing of already-committed rows (duplicate short codes). On the resume path there is no caller holding the urls anyway, so the query happens either way | one extra indexed SELECT on the fresh path where the caller already had the urls in hand — sub-ms against the partial index, dwarfed by the inserts that follow |
| 2026-07-03 | 4 | Dispatcher DISCOVERS ONLY (plain `SELECT id FROM bulk_jobs WHERE status='pending'`, no UPDATE); the atomic claim lives PER-JOB inside the worker, over a dispatcher that claims all pending rows in one `UPDATE ... RETURNING id` | one UPDATE that claims all pending rows funnels the whole fleet's work onto whichever instance's dispatcher ticks first — the other two instances SELECT/UPDATE, find zero pending, and sit idle. Discovery-only + per-job claim means all 3 instances fire a worker per candidate id, the workers race the claim per job (one wins, two get rowCount=0 and bounce), and jobs spread naturally across the fleet. Dispatcher is allowed to over-select; the claim is the referee | dispatcher over-selects and fires workers that will lose the claim — cheap wasted UPDATEs, no correctness cost. Also fire workers WITHOUT await (with `.catch`) so a slow job doesn't starve the tick |
| 2026-07-07 | 4 | `attempts` incremented inside the claim UPDATE (crash-proof counting); the attempt cap is enforced by the claim winner AFTER `RETURNING`, not as a filter in the claim's WHERE clause | putting `attempts < cap` in the claim WHERE means a row that has exhausted its attempts can never be claimed by ANY worker again — the condition is never satisfied, so no worker can lock the row to flip it to `failed`, and the job is stuck in a reap/redispatch loop forever. The check must live after the claim: the winner reads the returned `attempts`, and if the cap is exceeded it marks the job `failed` instead of processing. Incrementing in the claim UPDATE itself makes the count crash-proof — the attempt is recorded atomically with taking ownership, so a worker that dies mid-job has still burned its attempt | the claim UPDATE always succeeds even for exhausted jobs, so a worker is spent just to deliver the `failed` verdict — one extra claim/UPDATE cycle per dead job. A row's `attempts` can exceed the cap by one (the counting claim that discovers exhaustion), so the cap reads as "attempts allowed to start", not a hard ceiling on the stored value |
| 2026-07-07 | 4 | Job-level `error` on `bulk_jobs` is written on EVERY failed attempt — including when status goes back to `pending` for retry — and cleared on a successful terminal status | the process that actually saw the failure is the only one that has the error message, and it may die right after writing it. If the error were only written at the `failed` verdict, the worker delivering that verdict (a later claim, possibly after a reap) has no RAM from the run that broke — the message would be lost. Writing it on every failed attempt means the row carries it across process boundaries: run 3 writes `status='pending', error='connection refused'` and dies; run 4 claims, sees attempts exhausted, stamps `failed` — and the error is already sitting on the row, written by the last process that saw it. The row is the messenger, same as everything else in this design | `status='pending'` with a non-null `error` looks contradictory but is information: "retryable, and here's why the last attempt failed." Same shape already accepted for `bulk_job_items.error` (2026-06-30): the column's meaning is only legible in combination with status — readers must branch on status first; `error` is "most recent failure, if any," never the state itself |
| 2026-07-08 | 4 | Cap branch derives the terminal verdict from the `bulk_job_items` aggregate (same `jobFinalStatus` as the happy path), instead of unconditionally stamping `failed` | resumability means the process delivering the exhaustion verdict has no knowledge of what the dead processes accomplished — killed runs bank chunks durably, so a job can exhaust attempts with all/some/none of its work done. "Exhausted = failed" was an assumption baked into a branch, written imagining a job that never worked; the table is the only witness. Found because the first Run B attempt kept COMPLETING before the third kill — the test difficulty was the data | one extra aggregate query on the death path; `attempts=4, status='completed'` looks odd but is the truth ("succeeded, took every life it had"); epitaph now only fires on the true zero-progress case |
| 2026-07-08 | 4 | Terminal verdict counts abandoned `pending` items as undelivered (folded with `failed`): notDelivered=0 → completed, success=0 → failed, else partial | on a terminal job, a pending item will never run — to the client, "failed" and "abandoned" are the same thing: a URL they won't get. Counting only completed vs failed made 20/0/40 read as `completed` (a lie) and 0/0/60 as unreachable-failed. On the happy path pending is always 0 at verdict time, so behavior there is unchanged — one function, both endings, no death-mode flag | pending items on a terminal job carry no per-item error (nothing ever touched them) — client sees `partial` but abandoned rows are only distinguishable from failed rows by their NULL error + pending status |
| 2026-07-09 | 4 | Recovery writes in the outer catch are guarded (inner try/catch, log "reaper will handle", swallow — never re-throw) | the catch block is the last place the original job error exists; a failed recovery write re-thrown REPLACES it on the way up, so logs show "connection refused" and the real failure reason exists nowhere. Guard preserves the witness testimony; survival was never the issue — reaper handles the parked row. **AMENDED 2026-07-20: this guard was never actually built as described — see F-12 and the 07-20 row. The kill test passed while the code was wrong.** | row sits at status='processing' with a dead heartbeat until the reaper flips it (~60s after DB returns); the guard's log line is the only evidence recovery was attempted; ~~the guard branch itself has never executed in a real run~~ (executed & proven 07-20) |
| 2026-07-20 | 4 | Guard moved INTO the worker's outer catch, with log-before-write ordering (log original error → try recovery write → catch/swallow), replacing the dispatcher-level try/catch | honest why: the 07-09 version was written in the dispatcher around an UN-AWAITED promise call — a synchronous try/catch closes before an async rejection arrives, so it was dead code, and the test passed anyway because PG came back before the catch ran. The guard must live in the worker's catch because that's the only scope where the original error and the write error coexist; the log must come FIRST because it's the only operation in the block that can't be killed by a dead DB — write-then-log means a throw destroys the witness | dispatcher loses its (illusory) visibility into recovery failures — the fired promise's .catch is now a generic last-resort net only; the guard's swallowed error means a failed recovery write is invisible except as one log line, and the row's fate rests entirely on the reaper (the slow lane, ~60s + ~2s dispatcher = ~61s worst-case resume after DB returns) |
| 2026-07-20 | 4 | Zombie workers (alive-but-not-progressing) handled by BOUNDING THE OPERATION (query timeout → hang becomes a thrown error the existing catch/recovery/reaper machinery handles), NOT by a progress-watching reaper on item-status movement | heartbeat attests liveness, not progress — a hung chunk query pulses forever while the item count freezes, and every mechanism (reaper, dispatcher, cap) keys off liveness or death, so a zombie evades all of them. Both fixes must guess at slow-vs-dead with a threshold; the difference is the cost of a WRONG guess: a progress-reaper's false positive reaps a worker whose query is still in flight → two owners (the exact corruption the atomic claim exists to prevent, reintroduced by the rescue mechanism); a timeout's false positive makes the worker cancel ITSELF → ownership transfers cleanly, a healthy chunk gets redone. Waste heals itself, corruption doesn't — pick the design whose wrong guess costs throughput, not correctness. Then found `query_timeout: 5000` (the M1/F-02 fix) already on the pool: the zombie was already impossible; nothing new to build | a legitimately >5s chunk under load burns an attempt on healthy work — three in a row and the cap fails a viable job. 5000ms was calibrated for M1 single-row lookups, not a 20-row chunk CTE; must be validated against measured chunk p99 under load (k6 chunk-size run promoted from perf tuning to correctness validation — same lesson as commandTimeout 100→500ms) |
| 2026-07-09 | 4 | Removed `process.exit(-1)` from `pool.on('error')` (kept the log) | the docs-example handler executed the entire process because ONE idle pool client errored — a 2s blip, a PG restart, a failover all trigger it. It killed the reaper and dispatcher crons, invalidating the whole self-heal chain proven on 07-03: no surviving process = no recovery. The pool already absorbs dead clients and mints fresh connections; the exit overruled the mechanism designed for exactly this | a process that can't reach the DB stays alive and keeps taking traffic, returning errors (500 today; 503-translation deferred). "Don't take traffic" now has no mechanism at all — acceptable while all instances share one DB (nowhere better to route), revisit if per-instance DB paths ever diverge |
| 2026-08-18 | 4 | Job creation (`createBatchInsertJobV2`) wrapped in a single transaction — a job exists with ALL its items or not at all. Fix the state, don't label it: NO zero-item guard in `getFinalCompletionStatus` | today the two inserts are unwrapped, so a throw on the items insert (or a death between them) leaves a `pending` job row with zero item rows. The reaper never sees it (already `pending`); the DISPATCHER picks it up ~2s later, the worker claims it, self-queries zero rows, skips the loop, and the aggregate reads 0/0/0 — where `notDelivered=0` is checked first, so the verdict is **`completed`**. A job with no items reports success. The alternative fix (guard the verdict function) leaves the bad state in the table and merely renames it; worse, once the transaction lands a zero-item job is UNREACHABLE, so the guard would be a branch that can never execute sitting next to a failure path it claims to cover — precisely the F-12 disease I just spent a session deleting | back to a checked-out client (`pool.connect` / BEGIN / COMMIT / ROLLBACK / `release` in finally) for this one path, partially walking back the 07-07 "no pinned client, `pool.query` everywhere" simplification. Acceptable because it wraps two fast inserts with no sleeps between them — it does not reintroduce connection-hoarding-through-sleeps. **DECIDED, NOT YET BUILT.** |
| 2026-08-18 | 4 | Death-path (`attempts > cap`) `completed`/`partial` arm KEEPS the existing `error`; only the happy path clears it. Contract is now explicit: `error` = "the last thing that went wrong," and it may be present alongside any non-fresh verdict | closes a question open since 07-20. `partial` from the happy path and `partial` from the death path are NOT the same event: one means "some URLs were bad," the other means "the job kept dying and we gave up with work outstanding." The second has a REASON, and the `error` column is the only place that reason exists — the process delivering the verdict has no RAM from the run that broke, so wiping the column throws away the only explanation for why N URLs were never attempted | the same verdict string can arrive with or without an `error` depending on which code path delivered it, so a client author must handle both shapes and cannot tell from the status alone which one they got. Consistent with the 06-30 and 07-07 rule (branch on status first; `error` is never the state itself) — but it makes the happy path's CASE-WHEN clear the odd one out, not this branch |
| 2026-08-18 | 4 | Short codes are GLOBAL per URL — the same `original_url` always resolves to the same code, fleet-wide, forever (consequence of `ON CONFLICT (original_url) DO UPDATE`). Accepted deliberately rather than left as an accident | the clause was added as a third duplicate-net on retry (`DO UPDATE SET original_url = EXCLUDED.original_url` rather than `DO NOTHING`, so the conflicting row still lands in `RETURNING` and its item gets marked completed — `DO NOTHING` would leave that item `pending` forever). But its real effect is a product rule: two clients shortening the same destination share one row, one id, one code. Nobody decided that; it arrived as a side effect, and side-effect semantics get expensive once there's data | blocks per-user analytics on a shared destination (two users share the code, so they share its click stats), per-user custom codes, and per-user expiry. Also means "same URL twice in one batch" collapses to one row. Fine for `shortn` today; revisit before per-user links or analytics ownership (M5/M7) — changing it later means a new uniqueness model and a migration |
| 2026-08-21 | 4 | Chunk size STAYS 20 and `query_timeout` STAYS 5000 — measured, not assumed. Max chunk CTE = 18ms at 24 concurrent jobs (2ms @6, 4ms @12) | closes the calibration question opened 07-20, where the 5000ms was flagged as an M1 single-row number being asked to cover a 20-row CTE. It covers it: ~277× margin at the worst observed chunk. Explicitly REJECTED the tempting inverse experiment ("find the biggest chunk that fits in 5000ms") — chunk size is a BLAST-RADIUS knob, not a throughput knob. One timeout stamps every URL in the chunk `failed`, so 20 costs 20 and 200 costs 200; round trips are invisible at this scale, so there is nothing to buy by sizing up, and a 4000ms chunk would sit one hiccup from a cliff | the number is laptop-scale: Docker, unloaded PG, 60-URL jobs, and the measured curve is NON-LINEAR (2 → 4 → 18 for 2× steps), so headroom past 24 concurrent jobs is unknown. Also: the 18ms spike is attributed to creation-write backlog by inference, not proof. Re-run the ladder if volume, job size, or DB hardware changes |
| 2026-08-21 | 4 | The `AND status = 'pending'` predicate on the inner catch's recovery write is KEPT and documented as load-bearing, not tidied away | it was written to mean "don't stomp an existing error." Its real value is bigger: `query_timeout` is a CLIENT-side timer, so Node can throw and stamp 20 items `failed` while the abandoned CTE is still committing in PG. The predicate makes both orderings safe — CTE-commits-first means the predicate no longer matches; catch-arrives-first means it BLOCKS on the CTE's row locks and PG re-checks it against the winner's committed row (EvalPlanQual), so rowCount=0 either way. Without it, a completed chunk could be overwritten to `failed` with live short codes sitting in `urls` | it reads as redundant ("we already know they're pending"), so it is exactly the kind of clause a future refactor deletes. Costs nothing; the only price is that its importance is invisible from the code and lives here instead |
| 2026-08-24 | 4 | `processBatchInsertJobV2` (chunked CTE) is `shortn`'s DEFAULT worker — AMENDS 2026-07-02, which named the per-row worker the default and the CTE "a learning artifact" | notes-vs-code drift found while fixing F-13: everything built since 07-03 — the atomic claim, reaper, dispatcher, the 07-20 guard, the 08-21 k6 ladder — was built and proven against the CTE path. The per-row worker has none of that behind it. Re-pointing the dispatcher now would invalidate seven weeks of proof to buy per-row error identity on a failure class that fires roughly never today. Throughput is NOT the reason — round trips are invisible at 60 URLs (07-02 said so and 08-21 measured it) | per-row error identity is gone: a `23xxx` chunk condemns all 20 items with one identical error, 19 of them healthy. The client cannot tell which URL was bad and must resubmit all 20 (cheap — `ON CONFLICT` absorbs the 19). REVISIT when per-user custom codes or per-user expiry land (M7): each new constraint multiplies the ways Postgres can reject a single row, which makes the collapsed identity expensive instead of theoretical |
| 2026-08-24 | 4 | Chunk failures are CLASSIFIED, not uniformly stamped: `23xxx` → permanent (stamp items `failed`, guard the write, `continue`); everything else, including no-code errors → transient (touch nothing, rethrow to the outer catch's existing retry path) | F-13: an exception is evidence about the statement, not about the rows. Only the integrity-violation class (`23xxx`) is Postgres saying "I looked at this row and rejected it"; `57xxx`/`08xxx`/no-code are the plumbing. A transient blip must leave items `pending` so the resume self-query (07-03) finds them without being told. Chose an ALLOWLIST (`23xxx` = permanent) over a denylist because the wrong guess is asymmetric: misclassifying transient-as-permanent kills healthy URLs forever; misclassifying permanent-as-transient costs at most 3 wasted attempts and still reaches a truthful verdict from the items aggregate. Waste heals, corruption doesn't — same rule as the 07-20 zombie decision | an allowlist is wrong BY OMISSION: any permanent error outside `23xxx` burns the full attempt cap for nothing. Known gap already: `21000` (see carried). Also, a transient blip now costs one attempt out of 3 — accepted, since 3 transient failures across 3 attempts is an outage, not a blip, and refusing to spin forever is what the cap is for |
| 2026-08-26 | 4 | Job creation is ONE STATEMENT (a data-modifying CTE: `INSERT INTO bulk_jobs ... RETURNING id` feeding `INSERT INTO bulk_job_items ... SELECT`), NOT a pinned client with BEGIN/COMMIT — AMENDS 2026-08-18 | the 08-18 row accepted walking back the 07-07 "no pinned client, `pool.query` everywhere" simplification as the price of atomicity. It isn't the price. EVERY statement in Postgres already runs inside its own implicit transaction — if any part of it throws, everything it did rolls back, no `BEGIN` required. Collapsing the two writes into one statement therefore buys the same guarantee for free, and buys a STRONGER one: with two statements the process can die BETWEEN them, and no transaction protects against a process that never reaches COMMIT; with one statement there is no "between" to die in. The job id, previously read in Node between the two inserts, comes back from the final `RETURNING bulk_job_items.job_id` — the controller still has what it needs for the 202 | the id is now generated and consumed inside Postgres, so Node cannot see it before the items land — fine here, but any future step that needs the id BETWEEN the two writes would force a real transaction back. Also the statement is denser to read than two obvious inserts, and its atomicity is implicit (a reader has to know the implicit-transaction rule to see it); this row is where that knowledge lives |
| 2026-08-26 | 4 | `WHERE cardinality($2::text[]) > 0` on the job insert is KEPT even though the request validator already rejects an empty array — and this is NOT the F-12 disease | first, they are different rules wearing one hat: the validator enforces a PRODUCT rule ("a client who sends `[]` gets a 400 with a useful message") and covers only callers arriving through the HTTP route; the predicate enforces a STRUCTURAL INVARIANT ("a `bulk_jobs` row without items must not exist") and binds every writer of that table — retry paths, backfills, a `psql` session at 11pm. Second, and the reusable rule: **a dead HANDLER is F-12; a dead CONSTRAINT is not.** The rejected 08-18 zero-item guard in `getFinalCompletionStatus` would only run once corruption already existed — it observes a bad state and relabels it, so it cannot be tested and it rots. The predicate never reacts to anything; it is a condition on the write that makes the bad state unrepresentable, and it is EVALUATED ON EVERY INSERT FOREVER — always true, never dead. Same category as `job_id NOT NULL`, which nobody calls dead code. The test is: does it run only in the bad case, or on every write? | without the predicate the failure mode is silent and legal, not an error: with an empty array the statement SUCCEEDS, `bulk_jobs` gets its row, `bulk_job_items` gets none, PG has nothing to roll back, Node throws a TypeError on `rows[0]`, the controller 500s — and the committed `pending` orphan is picked up by the dispatcher ~2s later and reported `completed`. The 08-18 bug, re-entering through a legal statement rather than a throw. Atomicity does not cover this; only the predicate does |
| 2026-08-26 | 4 | `21000` closed by DEDUPING WITHIN THE CHUNK (`SELECT DISTINCT ON (u.url) u.code, u.url FROM unnest($1::text[], $2::text[]) AS u(code, url)`), over (a) deduping at creation or (b) adding `21000` to the permanent allowlist | (b) is wrong because it makes the client pay for a legal request: a batch listing one destination twice is not a malformed batch, and under the CTE worker a permanent stamp condemns all 20 items in the chunk, 19 of them healthy, to buy nothing. (a) is wrong because the client sends 60 URLs and gets 59 results — the response shape stops matching the request shape and the client must diff their input against the output to work out what happened. (c), chunk-time, preserves 60-in/60-out AND makes the batch path agree with the rule 08-18 already committed to: same URL, same row, same code. One insert, both item rows stamped `completed` by the url-based join, both carrying the same `url_id` — which is correct, they ARE the same destination. Best property: the classifier is untouched, because the error can no longer be RAISED. Removing the condition beats extending the allowlist | the url-based join (`WHERE bjt.url = inserted.original_url AND bjt.job_id = $3`) is now LOAD-BEARING rather than incidental — it is what makes both duplicate item rows resolve from one inserted row, and it also means a chunk can stamp item rows belonging to a LATER chunk when a duplicate spans chunk boundaries (harmless, idempotent, but true). Same shape as the 08-21 `AND status='pending'` predicate: it reads as ordinary SQL and its importance lives here, not in the code. Also: multi-argument `unnest` is what makes this safe — pairing the code and url arrays INSIDE Postgres means there is no moment where two independently-mutable JS arrays can desynchronise and mint codes against the wrong destinations |

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

### F-10: Dispatcher claimed all pending jobs in one UPDATE — fleet funneled onto one instance
- **Module/Stage:** M4 S3
- **What I did:** wrote the dispatcher as `UPDATE bulk_jobs SET status='processing' WHERE status='pending' RETURNING id` — claimed *all* pending rows in a single atomic statement instead of just discovering their ids and letting each worker claim its own job
- **What broke:** no crash, no error — that's what makes it dangerous. Whichever instance's dispatcher ticked first flipped every pending job to `processing` and got all the ids back; the other two instances ticked a moment later, found zero pending rows, and went idle. All resume work concentrated on one box while two sat doing nothing — the exact opposite of the horizontal-scale goal
- **Root cause in one sentence:** the claim was placed in the dispatcher (discovery layer) instead of per-job in the worker, so "select candidates" and "take ownership" were fused into one fleet-wide statement — the first tick to run vacuumed up everything
- **Fix:** split the two roles. Dispatcher does DISCOVERY only — a plain `SELECT id WHERE status='pending'`, no UPDATE — then loops firing `processBatchInsertJobV2(id)` per id, without await, each with a `.catch`. The atomic claim moves INTO the worker, per job (`UPDATE ... WHERE id AND status='pending' RETURNING id`), so all 3 instances race the claim per job, one wins, two bounce (rowCount=0), and jobs spread across the fleet
- **What I'd watch for in production:** per-instance job-processing counts diverging — one instance doing ~all the work while siblings idle is the signature. Alert on max/min ratio of jobs-claimed-per-instance over a window; a healthy fleet stays roughly balanced

### F-11: Exhausted job stamped 'failed' over fully-completed work
- **Module/Stage:** M4 S3
- **What I did:** ran Run B (3× docker kill mid-sleep) to verify the attempts-cap epitaph — but each killed run had already durably committed a chunk before dying
- **What broke:** nothing crashed — the test refused to produce the scenario. The job kept COMPLETING before the third kill because resumable chunks banked progress each run. Tracing why revealed the real bug: run 4's cap branch would stamp `status='failed'` on a job whose 60 items were ALL completed — client retries a fully-delivered job. Never fired in a real run; caught in the trace
- **Root cause in one sentence:** the cap branch assumed "exhausted attempts = no work done," but resumability means the verdict-delivering process knows nothing about what dead processes banked — the verdict was assumed from the code path instead of derived from durable state (same disease as the 07-02 RAM counters, one level up: a stale assumption instead of a stale variable)
- **Fix:** cap branch calls the same items-aggregate verdict as the happy path; verdict function extended to count pending as undelivered (see both 2026-07-08 D-log rows). Verified with real kills: all-banked → completed, partial → partial, zero-progress → failed + epitaph
- **What I'd watch for in production:** client retry rate on jobs whose items are all completed — a spike means a verdict path is lying; also any `status='failed'` job with completed_items > 0 is worth an alert, it should be partial or completed

### F-12: Guard that could never fire — sync try/catch around an un-awaited promise
- **Module/Stage:** M4 S4
- **What I did:** on 07-09, "guarded" the recovery write by wrapping the dispatcher's `processBatchInsertJobV2(jobId)` call in a synchronous try/catch with the "recovery write failed, reaper will handle" log — while firing the promise WITHOUT await (with a `.catch`). Progress notes recorded the guard as shipped and verified.
- **What broke:** nothing visibly — that's the failure. The catch block was dead code: it could never fire, its log line could never appear, and the 07-09 kill test passed anyway because PG came back before the worker's catch ran, so the recovery write never failed. Meanwhile the real failure path (recovery write throws inside the worker's catch) would have rejected the promise carrying the recovery write's error, REPLACING the original job error — the exact witness-destruction the guard existed to prevent. Discovered 07-20 by reading the code against the progress notes, then proven by executing the branch with a real dead-DB kill.
- **Root cause in one sentence:** we relied on the dispatcher's try/catch to catch an error born inside the writer — but try/catch only catches synchronous code in its block, and since we never awaited `processBatchInsertJobV2`, the try block finished before the error even existed; the rejection could only travel through the promise's `.catch`, and it arrived carrying the recovery write's error with the original cause already overwritten.
- **Fix:** guard moved into the worker's own outer catch — the only scope where original error and write error coexist. Ordering is the guard: log the original error FIRST, then attempt the recovery write inside a nested try/catch that logs "reaper will handle" and swallows. Dispatcher's dead try/catch deleted; `.catch` on the fired promise kept as a generic last-resort net. Proven with a real kill: PG dead AT the moment the catch ran (CHUNK_SLEEP window, PG restarted only after the guard's log line appeared) → both log lines in order → reaper flipped the parked row → job completed, 60/60, 0 duplicates.
- **What I'd watch for in production:** a log line that has never once appeared in months of operation next to a failure path it claims to cover — grep your "impossible" branches periodically; a guard with zero executions is unproven, not reliable. Also: any error log whose message is a write/cleanup failure with no preceding line for the original failure — that's a witness being replaced.

### F-13: Transient chunk failure stamped 20 healthy URLs permanently `failed`
- **Module/Stage:** M4 S4
- **What I did:** built `FORCE_CHUNK_ERROR=before|after` (dev-gated, chunk 0, attempt 1
  only) to throw inside the chunk `try` on demand — removing the timing dependency that
  made this bug untestable. `before` throws with the rows still `pending`; `after` throws
  with the CTE already committed. Reproducing the EFFECT beat reproducing the CAUSE: a
  synthetic throw also models the COMMON transient case (socket reset, `query_timeout`
  trip, failover) better than a `docker kill` does, since in all of those PG is alive
  again milliseconds later.
- **What broke:** `before` run: 20 items stamped `failed`, 40 `completed`, job `partial`,
  `attempts=1`, `error=NULL`, and ZERO short codes minted for the 20 — they were never
  sent to Postgres at all. Nothing crashed, nothing retried, no reap. The job looks like a
  clean run that found 20 bad URLs. A client polls, sees `partial` + 20 error strings, and
  concludes those URLs are bad. They aren't. Nothing ever moves an item from `failed` back
  to `pending`, and the resume query only selects `pending` — so they are dead for good.
- **Root cause in one sentence:** the inner catch wrote a verdict about the DATA using
  evidence about the PLUMBING — an exception says the statement didn't complete, not that
  the rows in it were bad, so stamping `failed` converted "we don't know" into "these are
  permanently bad." Same disease as F-11 and the 07-02 RAM counters one layer over: a
  verdict assumed from the code path instead of derived from evidence.
- **Previously "correct" only by timing:** if PG was still dead when the catch ran, the
  recovery write ALSO threw, escaped to the outer catch, and the job retried and healed.
  If PG came back a moment earlier, the write landed and 20 healthy URLs died. Same blip,
  opposite outcomes, decided by milliseconds.
- **Fix:** classify on `err.code` at the catch.
  - `23xxx` (integrity constraint) → PERMANENT: stamp the 20 `failed` (keeping the
    load-bearing `AND status='pending'` predicate), guard the write in a nested
    try/catch, `continue` the loop. Job carries on and reaches a real verdict.
  - everything else — `57xxx` admin_shutdown, `08xxx` connection, `ENOTFOUND`, and
    `query_timeout` trips (which carry NO code at all) → TRANSIENT: touch nothing,
    RETHROW. The outer catch is already the retry path (07-07): writes the job error,
    checks the cap, sets `pending`, dispatcher re-claims in ~2s, worker self-queries and
    finds the 20 still `pending`. No new machinery; the inner catch had been swallowing
    errors that belonged to the outer one.
  - `42601` (syntax error) deliberately NOT treated as permanent — that's a bug in my SQL,
    not a bad row; let it blow up the job and land in the logs.
- **Proven both ways (2026-08-24):** permanent (synthetic `DatabaseError`, code `23123`) →
  20 `failed` / 40 `completed`, `attempts=1`, chunks 20 and 40 ran, no retry cycle.
  Transient (`docker stop postgres` mid-job) → `ENOTFOUND`, nothing stamped, rethrown,
  outer catch's recovery write ALSO failed → 07-20 guard fired ("reaper will handle") →
  reaper flipped the parked row → retry completed 60/60. Note this exercised the SLOW lane
  (~60s reaper), not the ~2s dispatcher path.
- **What I'd watch for in production:** this failure has no server-side symptom — no
  error log, no retry, no reap, `attempts=1`. The only tell is on the client side:
  RESUBMISSION SUCCESS RATE. If a URL that came back `failed` succeeds on a plain
  resubmit with no change to the payload, the original verdict was a lie. Alert on
  `bulk_job_items` rows whose `error` text is identical across an entire chunk boundary
  (20 rows, same message, contiguous) — a real constraint violation is one bad row, so
  20 identical errors means the batch shape collapsed the identity. Also: any `failed`
  item with no corresponding `urls` row AND an error that isn't a `23xxx` message.

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
- [x] Atomic claim vs check-then-act — `UPDATE...WHERE id AND status='pending'` fuses the check into the locked write, so the loser blocks, Postgres re-evaluates the predicate against the winner's committed row (EvalPlanQual recheck), it fails, rowCount=0 → walk away. A SELECT-then-UPDATE races because the SELECT holds no lock: both workers read 'pending' unlocked, and the second UPDATE (`WHERE id` only, no status) blindly overwrites — the claim decision was made before any lock existed. The lock at UPDATE time is too late; the decision must live *inside* the lock. rowCount is the signal; RETURNING id feeds the winner. Same shape as an idempotent `ON CONFLICT DO NOTHING` — let the single atomic statement *be* the check, then read the result. (Reaper resets to 'pending', so re-claim == claim: one path, no special case.) **PROVEN end-to-end in the 07-03 crash test: kill mid-job → sibling reaper flipped → sibling dispatcher re-claimed → resume via committed item status → 60/60 completed, 0 duplicate URLs.** Corollary re-derived 08-18: the loser burns NO attempt — no row matched, no increment — so only the winner pays.
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
| 2026-07-03 | Xh | M4 S3 ✅ | CODED reaper + dispatcher crons and PASSED THE CRASH TEST — the actual point of Stage 3. Refactored worker to jobId-only + self-query of pending items (fresh & resume = one path, D-log); added `updated_at=NOW()` to the claim so the claim is its own first heartbeat; reaper = atomic flip (`< NOW() - 15s`, node-cron 6-field ~60s, rowCount log as proof); dispatcher = discovery-only SELECT + un-awaited per-job worker fire w/ .catch (~2s). Fixed the fatal design bug where the dispatcher claimed ALL pending rows in one UPDATE and funneled the fleet onto one instance → F-10. Ran on real containers: docker kill instances mid-job → SIBLING reaper flipped processing→pending → sibling dispatcher re-claimed → resume picked up only pending items. Verified in PG: 60/60 completed, 0 pending, 0 duplicate URLs, bulk_jobs.status='completed'. Articulated the full lifecycle in own words | ripping out the TEST-ONLY per-chunk sleep; deciding outer-catch failed-vs-pending policy; Stage 4 (break the fix); k6 chunk size |
| 2026-07-07 | Xh | M4 S3 | Closed the outer-catch question via attempts cap: counted IN the claim (crash-proof — catch blocks can't see kill -9), enforced by claim WINNER post-RETURNING (WHERE-clause cap = zombie job nobody can flip; a terminal state must be WRITTEN). error = "most recent failure": catch overwrites fresh, cap branch COALESCEs, success clears. Gated test sleep behind CHUNK_SLEEP_MS (numeric = gate+duration, absent = prod-safe). Dropped pinned client — no multi-stmt txn in V2, pool.query everywhere, no more connection hoarding through sleeps. Untangled threads-vs-connections mental model (pool = phone lines, one event loop). Cleaned dispatcher dead code. 2 D-log rows | RUNNING Run A/B cap verification; the attempts+error migration; FORCE_JOB_ERROR hook; guarding recovery writes; Stage 4; k6 chunk size |
| 2026-07-08 | Xh | M4 S3 ✅ | VERIFIED the cap: migration landed; Run A green (3 attempts, catch self-terminates); Run B ×3 scenarios green (completed / partial / failed+epitaph at attempts=4). Fixed stale-local-attempts ordering bug (copy from RETURNING before anything can throw), catch boundary <= → <, and F-11 (cap verdict now derived from items aggregate, pending counted as undelivered). Earned: verdict must come from durable state because the verdict-writer and work-doer can be different processes | recovery-write guard; death-path error-clearing decision; Stage 4; k6 chunk size |
| 2026-07-09 | Xh | M4 S3 ✅ CLOSED | Recovery-write guard + logger format ([job id] prefix, attempt in outer catch); root-caused app-dies-with-PG to process.exit(-1) in pool.on('error') — removed, self-heal chain now survives DB death; kill test: containers survived, attempt 1 failed (ENOTFOUND), attempt 2 completed | guard catch-branch never exercised; 503 translation; death-path error-clearing; Stage 4; k6 chunk size |
| 2026-07-20 | Xh | M4 S4 🟡 | Stage 4 first blood: discovered the 07-09 guard was DEAD CODE (sync try/catch around un-awaited promise in dispatcher — F-12); rebuilt guard in worker's catch w/ log-before-write ordering; EXECUTED the guard branch for the first time with a real dead-DB kill → witness preserved, reaper flipped, dispatcher re-claimed, 60/60, attempts=2, 0 dups, error=NULL (policy, not luck); derived worst-case resume = 60s reaper + 2s dispatcher stacked; F-12 root cause articulated & logged. Then: claim-then-die gap cleared by design review (claim = first heartbeat, 3× margin protects slow starters); zombie-worker analysis (heartbeat = liveness ≠ progress) → Option B (bound the operation) over progress-reaper (false-positive asymmetry: waste vs two-owner corruption) → found query_timeout:5000 already covers it; k6 chunk run promoted to load-bearing (validates the 5000ms) | RUNNING the k6 chunk-size calibration; deciding if S4 is done (503 translation? death-path error-clearing?); fencing-tokens side-read (Option A = the anchor) |
| 2026-08-18 | ~2h | M4 S4 🟡 | COLD START after a 28-day gap — read the worker line by line against the notes instead of trusting either. Audit clean (guard in worker's catch, dispatcher's dead try/catch gone, query_timeout:5000 present). 3 new findings: (1) ORPHAN JOB — unwrapped two-write creation can leave a `pending` job with zero items that the DISPATCHER picks up (not the reaper) and the 0/0/0 aggregate reports as `completed`; fix = transaction, explicitly NOT a verdict-function guard (would be an unprovable branch = F-12 disease). (2) INNER CATCH mislabels a transient DB blip as permanent item `failed` and nothing ever un-fails them — today it self-corrects only because the second write also fails, i.e. correctness by timing. (3) `ON CONFLICT (original_url)` silently made short codes global-per-URL — a product rule nobody decided. 3 D-log rows written (2 decided, 1 decided-not-built). Designed the k6 chunk measurement: time it in NODE (pool-wait is inside the timeout's clock; pg_stat_statements has no percentiles and can't see it), sweep concurrent WORKERS not RPS, chunk size is the knob rather than raising the timeout | ACTUALLY RUNNING k6 (blocked on: no way to create N concurrent jobs on demand); building the creation transaction; the transient-failed-items bug; 503 translation; fencing-tokens side-read |
| 2026-08-21 | ~3h | M4 S4 🟡 | RAN THE K6 CHUNK LADDER — the blocker from 08-18 is gone and Stage 4's main event is closed. Solved "N concurrent jobs on demand" with k6 `per-vu-iterations` (vus=N, iterations=1) as a starting gun rather than an RPS load test; per-VU unique URLs so jobs don't collide on `ON CONFLICT`. Made the instrumentation permanent: `t0` outside the chunk try, JSON `chunk_ok`/`chunk_fail` lines with duration on BOTH paths (caught a copy-paste where the catch logged `chunk_ok` — a mislabelled line in a failure path that had never run, F-12's cousin). Results 6/12/24 → max 2/4/18ms vs a 5000ms timeout; kept chunk size 20 and the timeout unchanged, and logged WHY sizing up is the wrong search (blast radius, not throughput). Learned the harness lesson the hard way: 6 and 12 jobs produced only ~2 concurrent chunks because a Node instance can only send one query at a time and spends most of its life not-querying — the apps couldn't feed PG hard enough to make it struggle. Traced the 18ms spike to two DIFFERENT instances slowing simultaneously → cause must be the shared thing (PG), attributed to ~1,440 creation-write inserts from the burst. Corrected the 08-18 note claiming `query_timeout` includes pool-wait (it doesn't — the timer arms after `pool.connect` returns). Noticed the inner catch's `status='pending'` predicate is load-bearing against the abandoned-CTE race. 2 D-log rows | the transient-failed-items bug (still un-attacked, now the leading Stage-4 candidate); building the creation transaction; proving rather than inferring the creation-write backlog; the unexplained 08-19 missing-chunk-40 / 37s-gap anomaly; 503 translation; fencing-tokens side-read || 2026-08-24 | ~2h | M4 S4 🟡 | FIXED the transient-failed-items bug (F-13), the leading Stage-4 candidate since 08-18. Killed the timing dependency first: built `FORCE_CHUNK_ERROR=before\|after` (dev-gated, chunk 0, attempt 1) so the branch fires deterministically instead of requiring PG to die and revive inside a millisecond window — reproducing the EFFECT beat reproducing the CAUSE, and the synthetic throw turned out to model the common case (socket reset, timeout trip, failover) better than a docker kill did. `before` run: 20 healthy URLs stamped `failed`, no short codes ever minted, job `partial`, `attempts=1`, `error=NULL` — a job that looks perfectly healthy and lies. `after` run: `chunk_failed` logged at 4ms and 60/60 completed — which RETIRES the 08-21 "load-bearing predicate" claim from reasoned to PROVEN. Fix = classify on `err.code`, permanent swallows and continues, transient rethrows into the outer catch that was already the retry path. Verified both branches + a real `docker stop postgres` (exercised the SLOW lane: outer guard fired, reaper flipped the row, retry completed 60/60). Found `21000` as the allowlist's known omission. Amended 07-02: the CTE worker is the default, and had been for 7 weeks without a decision | building the creation transaction (decided 08-18, STILL not built); 503 translation; the real `23505` receipt; the `21000` gap; proving rather than inferring the 08-21 creation-write backlog; the unexplained 08-19 missing-chunk-40 anomaly; fencing-tokens side-read |
| 2026-08-26 | ~2h | M4 S4 🟡 | CLOSED the two oldest open items plus a carried receipt. CREATION TRANSACTION built — and built BETTER than decided: realised a data-modifying CTE makes it ONE STATEMENT, so implicit-transaction atomicity is free and 07-07's no-pinned-client rule survives; amends 08-18. Caught the hole the transaction alone does NOT close — an empty array is a LEGAL statement that commits a job row and inserts no items, so PG rolls back nothing and the 08-18 orphan walks back in through a success rather than a throw; fixed with `WHERE cardinality > 0`, and defended it against my own F-12 rule by separating a dead HANDLER (observes corruption, rots) from a dead CONSTRAINT (evaluated on every write, always true). `21000` CLOSED by chunk-time `DISTINCT ON` over a multi-arg `unnest` — chose removing the condition over extending the allowlist, and chunk-time over creation-time to keep 60-in/60-out. Real `23xxx` receipt CLOSED for free while testing: a `null` in the array produced a genuine `23514 check_url_format` from PG, permanent branch stamped and `continue`d, chunks 20 and 40 ran after it — which also DEMONSTRATED (not asserted) why `continue` beats blanket un-fail-on-retry: one bad chunk must not head-of-line-block the rest. Found `bulk_job_items.url` is nullable. 3 D-log rows | THE CARDINALITY RECEIPT — `cardinality > 0` has never executed, so the creation fix is built-and-reasoned, NOT proven, and I nearly wrote "proven" in this file (the exact F-12 sentence). The two cleanup items (`premanentErrors` typo, shadowed `error`). The `chunkItems.length` vs insert-count audit. 503 translation (filed to S5, arguably dodged). Proving rather than inferring the 08-21 creation-write backlog; the 08-19 missing-chunk-40 anomaly; fencing-tokens side-read |