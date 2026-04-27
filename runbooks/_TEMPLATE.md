# Runbook: <symptom>

> One runbook per failure mode you've actually seen. Symptom-first, not
> cause-first. The on-call engineer knows what they see, not what's wrong.

## Symptom

What does the on-call engineer observe? (Alert fired, dashboard panel,
user report, etc.)

## Quick triage

The 60-second checks before paging anyone else.

1. Check X
2. Check Y
3. If Z, escalate

## Likely causes (ordered by frequency)

1. **Cause A** — diagnosis: ...; fix: ...
2. **Cause B** — ...

## Mitigations

- Immediate: how to stop the bleeding
- Recovery: how to restore service
- Prevention: what to do later (link to ticket)

## Last seen

| Date | Module that produced it | Postmortem link |
|------|--------------------------|-----------------|
