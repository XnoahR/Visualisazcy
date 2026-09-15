# Visualisazcy — brief

**System diagrams that run.** Draw an architecture, press Play, and traffic
flows through it as packets. Objects have capacity; queues fill; a database
that is overloaded turns red and the requests behind it start failing. Kill a
server and watch the rest cope. Then export ten seconds of it as a video.

Vanilla JavaScript and canvas 2D. No dependencies, no build step. One HTML file
for the shell, ~8,400 lines in all. Private repo: `github.com/XnoahR/Visualisazcy`.

## Why it exists

Architecture diagrams are pictures of claims. *This scales. That is the
bottleneck. A queue would absorb the spike.* None of it can be checked by
looking. Visualisazcy makes the diagram the model: the same boxes and arrows,
but with numbers underneath that behave — so "the retries make it worse" is not
an opinion, it is a database taking 82 requests per second while the client is
sending 60, on screen.

The reference is the short-form system-design video: one frame, ten seconds,
a single idea made visible. The tool exists to produce those without an
animation suite.

## The model, in four lines

- **Capacity is derived.** An object has a latency and a concurrency;
  throughput follows from Little's Law and cannot be typed in.
- **Requests queue.** Arrivals wait for a free slot, then are served, then are
  answered. Overloaded means the queue is full.
- **Failure has a vocabulary.** A share of calls can fail; a node can be
  degraded (slow and flaky) rather than dead; callers can retry with backoff,
  or trip a circuit breaker, or hand work off asynchronously and stop waiting.
- **Reads and writes are different.** A primary takes writes, replicas take
  reads, and routing honours it.

## What you can do

| | |
|---|---|
| **Build** | 25 object types on a palette — clients, gateways, load balancers, caches, queues, brokers, workers, databases, replicas, a WAF, a sidecar, a scheduler, a blank custom one. Drag, wire, edit every number in an inspector. |
| **Fold** | Select a service's internals and press Ctrl+G: one named card. Groups nest, so a region holds services. Folding changes no number — the members keep running. |
| **Break** | Play, then click to kill or Alt-click to degrade. Watch queues, breakers and lag respond. |
| **Tell** | Timeline scenes: full state per step, one take, no cuts. Callouts and stats animate in. |
| **Describe** | Type *"a ticketing site for a ticket war with a waiting-room queue"* and get a board. Any provider — Anthropic, OpenAI, OpenRouter, Groq, Gemini, a local Ollama, your own gateway — configured in a settings dashboard. Keys stay in the browser. |
| **Export** | Frame-exact WebM at 16:9, 1:1 or 9:16 from the same scene; one script converts to MP4. |

## Status

Working and tested. Three headless suites (135 checks) cover the simulation's
promises — folding identity, retry and breaker behaviour, the generation loop
for both API protocols — and run before any pixels are drawn. Browser suites
drive the real UI with real pointer events. Fifteen built-in scenes, six of
them stories, all verified at three aspect ratios.

Built from scratch starting 28 August 2026, in layers: the engine and scenes;
groups and custom objects; the failure and resilience model; AI generation with
a provider dashboard. Each layer found bugs in the one before it by writing the
test first; the notable ones are recorded in the code's own comments and in
`docs/`.

## Not yet

Partitions and consumer groups on the broker; bulkheads and timeouts (the two
resilience patterns still missing); offline video render (export is real-time);
reusable custom types; portrait layouts from the model.

## Read next

- `README.md` — every decision, explained
- `docs/architecture.md` — the resilience model and what the research changed
- `docs/groups.md` — why groups are not sections
- `AGENTS.md` — rules for anyone (or anything) editing the code
