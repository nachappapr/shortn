## Current Position

Current Position:
Module: 1
Stage: 6 — Cost check + teardown  
Last session: 2026-04-28
Next action: Check Cost Explorer for zero charges, then cover graceful shutdown + idempotency, then Stage 7 postmortem

**Open questions / things I'm stuck on:**
- _(blank to start)_

---

## Module Status

| # | Module | Status | Started | Finished | Notes |
|---|--------|--------|---------|----------|-------|
| 1 | Single Box | 🟡 In progress | 2026-04-27 | — | — |
| 2 | API Design | ⬜ | — | — | — |
| 3 | Caching | ⬜ | — | — | — |
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

### Example (delete once you have your own)

```
### F-01: Connection pool exhaustion under load
- **Module/Stage:** M1 S1
- **What I did:** k6 ramp to 1000 RPS against single Node + Postgres
- **What broke:** p99 went from 8ms to 4200ms at ~600 RPS, then 503s
- **Root cause in one sentence:** No pool configured — pg client opened a fresh
  connection per request, Postgres hit max_connections, new requests queued in Node
  until upstream timeout.
- **Fix:** pg.Pool with max=20, idleTimeoutMillis=30000
- **What I'd watch for in production:** active_connections vs pool_size as a
  ratio metric; alert at >80%. Also: queue length in app, not just DB.
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

---

## Cost Log

> Pulled from AWS Cost Explorer at the end of each AWS exercise. Track even if it's $0.30 — pattern recognition matters more than the absolute number.

| Date | Module | Services used | Hours active | Cost (USD) | Notes |
|------|--------|---------------|--------------|------------|-------|
| 2026-04-28 | 1 | EC2 t3.micro x2, RDS db.t3.micro | 2h | ~$0.12 | k6 EC2 + app EC2 + RDS, Mumbai region |

**Running total:** $0.00

**Cost surprises** (things that cost more than I expected — review before starting next module):
- _(blank to start)_

---

## Concepts Earned

> Claude should not let you check a concept off until you can explain it in your own words *to a junior engineer who's never heard of it*. The test is the explanation, not the build. If you can't write the one-sentence explanation, the concept isn't earned yet.

### Module 1
- [x] Throughput vs latency (and why p99 ≠ p50 × constant)
- [x] Little's Law in plain English
- [x] Why every connection pool size is a guess that needs validation
- [ ] What backpressure is and where it lives in your stack
- [ ] Why graceful shutdown is non-negotiable
- [ ] Idempotency — and the request that taught you why

### Module 2
- [ ] Why offset pagination dies on large tables
- [ ] When gRPC is right and when it's resume-driven design
- [ ] Idempotency keys — why client-generated, not server-generated
- [ ] The async API pattern (202 → poll / webhook) and when each fits

### Module 3
- [ ] Cache-aside vs write-through — when each makes sense
- [ ] Thundering herd — what it looks like in metrics
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

- M1: _link when written_
- M2: _link when written_
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
| 2026-04-28 | ~Xh | M1 S4 | pool size experiments, Little's Law, F-03,EC2+RDS deploy, k6 from AWS, teardown | graceful shutdown, idempotency |
