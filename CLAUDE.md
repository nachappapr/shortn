# Claude Code — project instructions for `shortn`

This file is read automatically by Claude Code on every session. The full
curriculum and operating principles live in `SYSTEM_DESIGN_INSTRUCTIONS.md` —
read that file once at the start of any new session and treat it as authoritative.

## Strict mode (active)

### You may edit:
- `infra/**` — Docker, Terraform, observability configs
- `load/**` — k6 scripts, chaos scripts
- `progress.md` — only on explicit "log this" or end-of-session ritual
- `COSTS.md` — at Stage 6 of any module
- `postmortems/**` — scaffold only; user fills in analysis
- `runbooks/**`
- `README.md`, `.gitignore`, `package.json`, `.env.example`

### You may NOT edit, ever:
- `src/**` — application code is the user's domain
- `migrations/**` — schema is design, not plumbing
- `decisions/**` — ADRs are the user's reasoning, not yours

### You may run:
- `docker`, `docker compose`
- `npm`, `node`
- `k6`
- `psql`, `redis-cli`
- `aws` CLI
- `terraform`
- shell utilities (`tc`, `pumba`, `curl`, etc.)

## Behavior rules

1. **Run-but-don't-narrate.** Run commands when asked. Report raw output.
   Do NOT pre-empt the user's diagnosis with conclusions.

2. **No proactive fixes during break stages.** In Stage 1 and Stage 4, do not
   propose patches until the user articulates root cause in their own words.

3. **No reading ahead.** If the user is on Module N, do not preview Module N+1
   problems even if they're visible in the codebase.

4. **Decision capture is real-time.** When the user makes a non-obvious config
   choice (pool size, TTL, retry budget, timeout), say:
   "log this — Decisions Log entry?"
   Write the entry only after the user dictates Why and Tradeoff.

5. **Failure capture is non-negotiable.** When a Stage 1 or Stage 4 break is
   reproduced, say: "F-NN entry?"
   If the user skips, repeat once. If still skipped, log a stub:
   `# TODO: user to fill in root cause`.

6. **End-of-session ritual.** At session end:
   - Read current `progress.md`.
   - Propose a diff updating Current Position, Decisions Log, Failure Catalog,
     Cost Log.
   - Show the diff. User approves or edits.
   - NEVER tick Concepts Earned automatically. Ask "explain X to me as if I'm
     a junior" first; if the explanation holds up, *user* ticks the box.

7. **Cost is enforced.** Refuse to close an AWS Stage 6 without a Cost Log row.
   If the user says "skip it, it was nothing," log `$0.00 — verified zero` with
   the date. Even zero is data.

## Session start protocol

1. Read `progress.md` "Current Position" block.
2. Confirm Module / Stage in one sentence.
3. State the goal of this stage in one sentence.
4. Ask one diagnostic question to confirm prior stage is solid.
5. Wait for the user before proceeding.

If `progress.md` Current Position is missing or stale (>7 days old), ask the
user to update it before starting any technical work.
