# Implementation and limits

The Host plugin contributes two DSH tools and one client-visible native session projection. The client contributes one native right-sidebar tab. Provider credentials, native permissions, the agent loop, persistence and session transport remain owned by DSH.

## Execution

`team_roles` returns a validated snapshot of user-defined roles/model routes. `team_delegate` starts a bounded task through `ctx.subagents.start`, using explicit model/provider options and the existing native tool filter.

The default `spawn` backend creates a fresh conversation. The worker receives the task, acceptance criteria, relevant context and, for retries, the preceding review feedback. At most `qualityRetries + 1` primary attempts and one optional fallback attempt run. Successful completion without a verifier returns `accepted: null`. The main model evaluates that result.

An optional verifier is a separate, tool-free child of the main Agent. DSH's native structured-output tool supplies the authoritative verdict. A missing, invalid or negative verdict fails the attempt. Reviews do not recursively review themselves. Native creation, permission and disposal errors propagate immediately.

All children are awaited and disposed in `finally`. Admission counts the whole delegation, including reviews; there is no queue. Excess parallel delegations return an explicit capacity error. The tool's caller cancellation signal flows into every child, so stopping the main task stops its owned workers.

Model and role changes affect new delegations. The main model continues to use the model selected in the existing DSH conversation; this plugin does not supply a separate automatic planner model.

## Truthful graph

The `agentRouter` projection folds only native DSH events: request headers, turn/step boundaries, subagent descriptors, assistant messages and failed attempts. It never writes new session event types or rewrites logged requests. Model/provider labels come from actual request headers.

The client traverses native `subagentCatalog` projections to discover real identities and parent/child edges, including native agents outside this plugin. It reads unopened descendants through `refreshProjections`, without starting or resuming them. Native control frames then update the cached projections. The selected conversation is the graph root; unrelated conversations are outside its graph.

A retry or verifier is a real new Agent and therefore gets a new box. A model request inside the same Agent stays in that box's details. If all reviewers and workers were started by the main Agent, their edges correctly point from the main Agent; they are not redrawn as worker-to-reviewer calls.

Fork-inherited events are excluded from the child's costs to avoid charging the same work twice. Historical graphs can be reconstructed from native logs when DSH retains those sessions. Missing or inaccessible child records produce an incomplete-record notice.

## Cost and optional estimate guard

Estimated costs use the actual DSH usage buckets and user-entered prices. Unknown usage or positive buckets with unknown prices are counted as unknown. Failed attempts with reported usage also count. A settings-derived projection version invalidates cached estimates after price changes.

This release re-prices historical events using current settings. It does not persist a historical tariff snapshot, obtain invoices, compare matched baseline tasks automatically or invent a savings percentage.

The optional guard reserves a conservative text-input estimate based on serialized UTF-8 bytes plus the configured maximum output. Reservation is synchronous and includes parallel requests. Workers cannot consume the configured final-review reserve; the main Agent can. Completed requests reconcile reservations to reported usage. Missing usage keeps the reservation held.

This estimate is not an exact tokenizer or a hard provider billing limit. Provider formatting, non-token charges and vendor-side retries may differ. All four price fields must be explicitly known when the guard is enabled. Image requests and unpriced models are rejected before the guarded stream dispatch. Calls without a session identity, such as some title generation or auxiliary calls, are outside its coverage.

Reservations belong to the current Host plugin instance. Historical conversations with calls or subagents cannot acquire a new guard account after restart; start a new conversation, or disable the guard to continue. This prevents a restarted plugin from treating earlier usage as zero. Set currency consistently and keep price/budget units unchanged during a guarded conversation.

## Compatibility and packaging

Version 0.1.0 targets DSH 0.2.0-rc.2. It uses published packages, a normal `dsh.bundle.patch` insert and a `./client` lazy CommonJS factory registered with DSH's ModuleLoader. The Host is ESM. Both built halves are shipped for GitHub and tarball installation.

The desktop client uses native IPC-compatible session objects; no custom HTTP endpoint, separate browser window or app binary patch is needed. The graph follows the existing theme tokens and locale service.

Keyless tests run native DSH infrastructure with a scripted LLM boundary. Component screenshots and browser tests verify the shipped graph component. Paid providers and installation into a user's live profile require additional real-environment validation; the release does not claim those have been exercised.
