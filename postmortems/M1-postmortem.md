# Module N — Postmortem

> Written by you, not Claude Code. Aim for one page. The point is to be honest
> about what surprised you, not to write a polished report.

**Date completed: 2026-04-29
**Total time spent: 7.3
**Hardest stage: None
**Stage I tried to skip (and didn't): None

## What I built

we built a url shotner, which would take a long url and convert it into a shortend url. 

## What broke

F-01: Duplicate key collision under load
- 6 duplicate key 500s out of 800k requests

F-02: 15 second hang on Postgres death
- in-flight requests hung for 15 seconds, 93% failure rate

F-03: Pool size vs throughput tradeoff
- pool max:2 → avg 47ms, 11k RPS. Pool max:50 → p99 68ms despite higher RPS. No single size was obviously "right"


## What I'd do differently

i would always perform the performance testing on server instead of local to have a true picture
i would always allocate the pool resource based on the formula (total pool - emergency services)/ number of app instance
i would shutdown the server gracefully



## What I still don't understand

i'm confused on using the technical terms on explaning things, i understand the undelying concept and i have to improve upon the explaning using correct technical terms

## Concept I'm most confident in now

Pick one. Write a 3-sentence explanation as if to a junior engineer who has
never heard of it. If you can't, you're not as confident as you think.

Think of Little’s Law like a coffee shop: if customers arrive at a certain rate and take a certain amount of time to get their coffee, that determines how crowded the shop feels.
Mathematically, it’s L = λW:
L (Requests in Flight): The number of people standing in the shop.
λ (Arrival Rate): How fast people are walking through the front door.
W (Wait/Process Time): How long each person stays inside before leaving with their latte.
For an intern, the "aha!" moment is realizing that you can’t change one without affecting the others. If your database queries suddenly take twice as long to finish (W), the number of active connections (L) will double instantly, even if the traffic (λ) stays exactly the same. This is usually why "slow" queries eventually look like "too many connections" errors.


backpressure is a state where a system is under a lot of stress due increase in load
idepotency is a function or route which return same result for same input

## Cost reality check

module costed merly 0.11$, the major cost would pile up from server and db 
