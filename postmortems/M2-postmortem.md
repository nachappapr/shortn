# Module N — Postmortem

> Written by you, not Claude Code. Aim for one page. The point is to be honest
> about what surprised you, not to write a polished report.

**Date completed: 2026-05-12
**Total time spent: 16
**Hardest stage: None
**Stage I tried to skip (and didn't): None

## What I built

we built a url shotner, which would take a long url and convert it into a shortend url. 

## What broke

F-04: Request entity too large (body parser limit)
- Express rejected the request with 413 Payload Too Large before it reached any route handler

F-05: Client timeout with server still processing
- client received a timeout error, but the server kept processing and committed work the client never saw — result was lost or ambiguous

F-06: F-06: Retry Storm
- when the subscriber went down and many deliveries failed at the same time, every retry timer fired in lockstep. The recovering subscriber was immediately flooded with a synchronized burst on each backoff interval instead of getting breathing room — preventing it from recovering at all

## Hardest Stage

- Idempotent keys and async patterns were the hardest, as the concepts were new to me. Now I have better clarity on what each method solves and when to use them.


## What I'd do differently

- **Batch requests**: For any batch request, I would always choose between polling or webhooks instead of carrying out every request sequentially. This prevents blocking and reduces query delays under heavy load.

- **Pagination**: For any pagination, I would use cursor pagination if there's no requirement to jump to a specific page, as it's more efficient and faster than offset-based pagination.

- **Retry synchronization**: Exponential backoff spaces out retries over time—attempt 1 waits 1s, attempt 2 waits 2s, attempt 4 waits 8s. However, when many callers fail simultaneously (e.g., when a subscriber goes down under load), they all start retrying at attempt 1 at the same time, then attempt 2 simultaneously. The backoff grows, but they remain in lockstep. Every interval, a synchronized wave hits the recovering subscriber. The problem isn't the frequency—it's the synchronization. Jitter fixed the synchronization, not the frequency.


## What I still don't understand

stuck job reaper not implemented — jobs that crash mid-processing stay in pending/processing forever

## Concept I'm most confident in now

Pick one. Write a 3-sentence explanation as if to a junior engineer who has
never heard of it. If you can't, you're not as confident as you think.

Async Pattern
Whenever we have batch uploads, we should always choose between polling or webhooks.
The choice of method depends on the subscriber. For webhooks, we need a server to send confirmation notifications.
Polling helps us solve two problems:
- If we execute every request sequentially, the processing time for each request increases, which in turn leads to query delays. Under heavy load, this tends to cause more failures.
- The async pattern solves this by sending confirmation earlier and processing in the background without blocking the request.

Idempotent Keys
Requests like GET, PUT, and DELETE are idempotent, meaning they produce the same state for a given input. POST and PATCH, however, change state with each request.

With idempotent keys implementation, we solve two problems:
- **State consistency**: For subsequent requests with the same input, we don't change the state, making the application more robust.
- **Retry safety**: We generate the key at the client end when initiating the request. For the initial request, we store the key, method, headers, and body in a table. If the network drops, the client can retry. If the data exists in the idempotent table, we return the snapshot, eliminating duplicate data issues on errors.

## Cost reality check

module costed merly 0.72$