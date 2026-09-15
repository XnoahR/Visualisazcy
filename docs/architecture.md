# What the model can say now

**Status:** built and tested. `node tests/resilience.test.mjs` (27 checks) and
`node tests/groups.test.mjs` (49 checks).

This started as a question — *is the broker there yet, and what is missing?* —
and turned into the largest single change to the model since capacity became
derived. What follows is what was researched, what was added, and what is still
not here.

---

## What the research changed

Three things came back from reading that I would not have designed on my own.

**Retry and circuit breaker are one pattern, not two.** The literature is blunt
about it: *"retry alone may exacerbate failures by increasing load; Circuit
Breaker can guard against retry storms."* Retrying a dependency that is already
drowning does not ride out the outage, it deepens it. That is not a footnote —
it is the most counter-intuitive thing about resilience, and it is exactly the
sort of claim a diagram that *runs* can prove. It became the flagship scene, and
you can watch the database take **82 requests per second while the client is
only sending 60**.

**A breaker has three states, not two.** Closed, open, and *half-open*: after
the reset window it lets exactly one probe through, and that single result
decides whether it closes or re-opens. Modelling it as a boolean would have made
recovery instant and wrong.

**Consumer lag is the metric.** For a broker, the number people actually put on
these diagrams is the gap between what has been written and what has been read.
That number was already sitting in the queue length — it had simply never been
displayed.

---

## The vocabulary: 17 object types → 25

| new type | badge | what it is for |
|---|---|---|
| **Message Broker** | `MSK` | a durable partitioned log; consumers read at their own pace and the gap is lag |
| **Write Primary** | `PRI` | the single writer. Every write funnels here, which is why it runs out first |
| **Stream Processor** | `STRM` | reads a log continuously and writes derived results |
| **Session Store** | `SESS` | who is logged in — small, and on the path of every single request |
| **Coordinator** | `ETCD` | leader election and config; slow on purpose, because it votes before it answers |
| **WAF / Firewall** | `WAF` | drops the obviously bad before it costs you anything |
| **Sidecar Proxy** | `MESH` | mTLS, retries and telemetry lifted out of your code |
| **Scheduler** | `CRON` | emits work on a timer instead of because someone asked |

`primary` and `session_store` were already listed in the palette and had never
existed — the palette filtered them out silently, which is why the
"One writes, many read" scene had no primary in it.

---

## Edges have properties

An edge used to be `{ from, to }`. Half of what a system diagram communicates is
in the arrows, and ours could say nothing: a queue write and an HTTP call looked
identical.

```js
edge('api', 'bus', { async: true, protocol: 'AMQP', latency: 8 })
```

**`async`** is the big one. It is the difference between *the gateway called the
cart service* and *the gateway dropped a job and walked away* — and those are not
the same diagram. An async hand-off **is** the completion: the caller is answered
at the hand-off and the work carries on behind it with a fresh trail. The p50
drops from 2600ms to 2ms and a separate **Jobs** counter tracks what finished
after the caller had already left.

Async wires are drawn **dashed and purple**. Wiring into a broker or a queue sets
`async` on its own, because that is what those things are.

**`latency`** is the network hop, and it counts in p50 **both ways** — a 60ms
wire costs 120ms round trip. This exposed a modelling error: latency was recorded
at the sink that answered, not at the caller that asked, so only outbound hops
ever counted. Declared network time is a modelled cost and counts; the time a dot
spends flying across the screen is a rendering choice and still does not.

**`protocol`** shows on hover. `label` pins a chip to the wire permanently.

---

## Failure, and what you do about it

**`failureRate`** — a share of calls this object fumbles.

**Degraded** — Alt-click in Play mode. Not dead: six times slower and a third of
calls failing. This is the outage that actually happens, and the one a diagram
never shows. Degraded is **amber**, overloaded is **red**, and they are different
problems — one is answering badly, the other has stopped accepting.

**`retry: { max, backoff }`** — exponential, with jitter, because synchronised
retries are their own outage.

**`breaker: { threshold, window, resetAfter, min }`** — state lives on the
**caller**, one per downstream, because the caller is the one that has to stop
calling. Open wires go red and dashed with an `OPEN` chip; `min` exists so a
single unlucky call cannot trip one.

Both show as small marks on the card — `↻3`, `⦸`, `35%` — so a policy that
changes behaviour is not invisible until it fires.

Validation warns when you configure retry without a breaker, quoting the
research: *retries alone deepen an outage rather than ride it out.*

---

## Reads and writes are different requests

A source declares `writeRatio: 0.3`; a node declares `accepts: 'read' | 'write'`.
Replicas accept reads, primaries accept writes, and routing honours it. Write
packets are drawn purple.

This is what the README itself had been asking for: *"needed before a
primary/replica scene teaches anything beyond fan-out."*

---

## Lag

Shown on any object holding a real backlog (≥5), not only on a queue. In a broker
pipeline the messages pile up at whoever is too slow to read them, and pointing
at the broker while the worker is the one drowning would be a lie.

---

## Folding became part of the story

A timeline step takes `expand: ['cart']`, and the set it names is the set of open
groups. That is the ten-second single-page take folding was built for: three
service cards, one of them opens, it folds back — one frame, no cuts.

Steps also take `degraded: [...]`.

---

## Four new scenes

| scene | what it shows |
|---|---|
| **When retries make it worse** | the flagship. 5 steps: healthy → the database degrades → retries pile on (the database sees *more* load than the client sends) → the breaker trips and load collapses → one probe gets through and it closes |
| **Reads one way, writes the other** | 30% writes, all funnelling to one primary while reads spread across two replicas |
| **Fire and forget** | an async hand-off at a broker: the caller sees 2ms, and the lag builds behind it |
| **Inside one service** | `expand` in a story — three folded services, one opens, folds back |

---

## Three bugs this work uncovered

**`node()` silently discarded most options.** It allow-listed five fields and
dropped the rest, so a scene asking for `latency`, `concurrency`, `retry` or
`breaker` got the type default and was never told. Thirteen such options across
the built-in scenes were being thrown away, including in `queue` and `sandbox`,
which predate this work. This is why the first version of the retry-storm scene
had no breaker at all — it was configured and discarded.

**A refused request never reached the caller.** An overloaded node counted a
drop and the packet simply vanished; upstream, nothing happened. 324 refusals,
zero errors reported. In reality that is a 503, and — critically — it meant
**overload could never trip a circuit breaker**, which is the most important
interaction between those two mechanisms. Refusals now fail back. `dropped` still
counts what a node refused; `errors` counts what the caller was told.

**p50 was measured at the wrong end.** Recorded at the sink that answered rather
than the caller that asked, so a network hop only ever counted one way.

---

## Then: describe it and get it

The last piece of the original ask — *"integrated AI-nya juga perlu"* — landed
on top of all of the above. A sentence on the start screen becomes a board; ✦ Ask
in the toolbar revises the open one. The system prompt is built from the
registry at runtime, the answer is constrained to the scene schema, and
validation errors go back to the model verbatim for one correction. Everything
in this document is what that prompt has to describe, which is why it came last.

Adding it exposed one more validator gap: an edge from a sink or into a source
was never checked — the UI refuses it one drag at a time, but a file could carry
it, and a model would. The check found a dead wire in a scene written the day
before.

## Still not built

- **Partitions and consumer groups.** The broker is a durable buffer with lag,
  not a partitioned log with per-group offsets. Partition count is declared and
  not simulated.
- **Bulkheads.** Isolated resource pools per caller, so one slow dependency
  cannot eat every thread. It is the third pattern in the resilience literature
  and the only one not here.
- **Timeouts.** A slow call currently blocks forever rather than giving up at a
  deadline — and a timeout is what most retries are actually reacting to.
- **Wiring into a folded group**, group p50, and making room when a group opens
  (see [`groups.md`](groups.md)).
- **Reusable custom types.** Custom objects are per-instance overrides; there is
  no way to define one and reuse it from the palette.
- **Offline video render.** Export is still real-time MediaRecorder.
- **Idempotency and retry safety.** Retrying a write is not the same as retrying
  a read, and nothing here says so.

## Sources

- [Understanding Kafka Consumer Groups and Consumer Lag](https://dzone.com/articles/understanding-kafka-consumer-groups-and-consumer-l)
- [Kafka consumer lag — measure and reduce](https://www.redpanda.com/guides/kafka-performance-kafka-consumer-lag)
- [Kafka Architecture Deep Dive: Topics, Partitions, and Brokers](https://toolshelf.tech/blog/kafka-architecture-deep-dive-topics-partitions-brokers/)
- [Microservices Resilience Patterns](https://www.geeksforgeeks.org/system-design/microservices-resilience-patterns/)
- [Design patterns for resilient microservices](https://www.designgurus.io/answers/detail/what-are-design-patterns-for-resilient-microservices-circuit-breaker-bulkhead-retries)
- [Resilience4j: Circuit Breaker, Retry & Bulkhead](https://mobisoftinfotech.com/resources/blog/microservices/resilience4j-circuit-breaker-retry-bulkhead-spring-boot)
- [API Gateway vs Service Mesh vs Sidecar Proxy](https://designgurus.substack.com/p/api-gateway-vs-service-mesh-vs-sidecar)
