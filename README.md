# shortn

A URL shortener built incrementally to learn system design — one failure at a time.

This is a learning project. The goal is not the URL shortener; it's the curriculum
of pressures applied to it across 9 modules.

## Where to start

1. Read `SYSTEM_DESIGN_INSTRUCTIONS.md` (drop in if not already present).
2. Open `progress.md` and check Current Position.
3. In Claude Code, say "Let's start" or "Continue from Module N, Stage X".

## Layout

- `src/`              — application code. **You write this.** Claude Code never edits.
- `migrations/`       — SQL schema changes. **You write these.** Each is a design decision.
- `infra/`            — Docker, Terraform, observability. Claude Code's domain.
- `load/`             — k6 scripts and chaos tooling. Claude Code's domain.
- `postmortems/`      — one per module, written by you at Stage 7.
- `runbooks/`         — operational notes, additive from Module 9 onward.
- `decisions/`        — optional ADRs for choices that need more than a progress.md row.
- `scratch/`          — gitignored exploration space.

## Running locally (Module 1)

```bash
cd infra/docker
docker compose up -d
cd ../..
npm install
npm run dev
```

Load test:

```bash
k6 run load/k6/m1-baseline.js
```

## Branching

One branch per module: `m1-single-box`, `m2-api-design`, etc.
Stages within a module are commits on that branch. Merge to `main` after the
postmortem is written.
