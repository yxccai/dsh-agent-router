# Implementation and limits

The Host plugin contributes two DSH tools and one client-visible native session projection. The client contributes a native right-sidebar tab, chat controls and plugin configuration forms. Provider credentials, permissions, the agent loop, persistence and transport remain owned by DSH.

## Chat controls and configuration

The compact toggle and model-picker arrow occupy the native `conversation.input.left` list slot inside the composer toolbar. Main/worker selectors appear in a portaled `MenuSurface`, positioned by DSH's `useAnchoredPosition` and dismissed by outside pointer or Escape. The toolbar control retains its intrinsic width; it has no size containment. Child-agent and removed-session views do not show the controls. The plugin registers `plugins.bundle.config` and `plugins.row.config` so its configuration is reachable from the normal Plugins detail page.

Both surfaces use the shared `configForms` service for the `dsh-agent-router` profile entry. An accepted atomic, revision-fenced mutation saves model definitions, the remembered pair and current chat binding together. Rejected/conflicting writes preserve the actual Host state and display an in-place error. No plugin-local browser storage, custom HTTP endpoint or app binary patch is used.

An absent chat binding means off. Newly created and forked chats have no binding even when preferences exist. Explicitly enabled chats keep their binding across reopening/restart. Disabling removes only that chat's binding, retaining the last pair. Changing choices affects subsequent root requests and new delegations; a running delegation holds its snapshot. The native conversation model can retain its last actual route after disabling.

The model catalog comes from `remote.session.modelCatalog`; explicitly configured routes remain available when the catalog is incomplete. Credentials stay in DSH's provider configuration. Selected new routes have unknown prices until edited. Without custom roles, a virtual `worker` role supplies the selected worker and optional main-model fallback. With custom roles, the worker selection overrides initial routes while preserving individual verifier, fallback and tool restrictions.

## Execution

`team_roles` reports whether the calling chat opted in and returns its validated roles/routes when enabled. `team_delegate` refuses disabled chats before creating a child. Enabled delegations use `ctx.subagents.start` with explicit routes and the native tool filter.

Disabled Agent scopes carry a native tool restriction hiding both router tools from discovery, model schemas and execution. The plugin refreshes these restrictions on native Agent creation and live configuration changes, and releases them on Agent/plugin disposal. The execution body also checks the binding before admission.

The default `spawn` backend creates a fresh conversation. The worker receives the task, acceptance criteria, relevant context and, for retries, the preceding review feedback. At most `qualityRetries + 1` primary attempts and one optional fallback attempt run. Successful completion without a verifier returns `accepted: null`. The main model evaluates that result.

An optional verifier is a separate, tool-free child of the main Agent. DSH's native structured-output tool supplies the authoritative verdict. A missing, invalid or negative verdict fails the attempt. Reviews do not recursively review themselves. Native creation, permission and disposal errors propagate immediately.

All children are awaited and disposed in `finally`. Admission counts the whole delegation, including reviews; there is no queue. Excess parallel delegations return an explicit capacity error. The tool's caller cancellation signal flows into every child, so stopping the main task stops its owned workers.

For enabled root chats, the native `agent/request` waterfall substitutes the selected main model before request-header persistence and transport preparation. The finalized `llm/stream` envelope is observed without mutation. Child routes remain the explicit worker/verifier/fallback choices; the main route is never applied indiscriminately to descendants.

## Truthful graph

The `agentRouter` projection folds only native DSH events: request headers, turn/step boundaries, subagent descriptors, assistant messages and failed attempts. It never writes new session event types or rewrites logged requests. Model/provider labels come from actual request headers.

The client traverses native `subagentCatalog` projections to discover real identities and parent/child edges, including native agents outside this plugin. It reads unopened descendants through `refreshProjections`, without starting or resuming them. Native control frames then update the cached projections. The selected conversation is the graph root; unrelated conversations are outside its graph.

A retry or verifier is a real new Agent and therefore gets a new box. A model request inside the same Agent stays in that box's details. If all reviewers and workers were started by the main Agent, their edges correctly point from the main Agent; they are not redrawn as worker-to-reviewer calls.

Fork-inherited events are excluded from the child's costs to avoid charging the same work twice. Historical graphs can be reconstructed from native logs when DSH retains those sessions. Missing or inaccessible child records produce an incomplete-record notice.

## Cost and optional estimate guard

Estimated costs use the actual DSH usage buckets and user-entered prices. Unknown usage or positive buckets with unknown prices are counted as unknown. Failed attempts with reported usage also count. A settings-derived projection version invalidates cached estimates after price changes.

This release re-prices historical events using current settings. It does not persist a historical tariff snapshot, obtain invoices, compare matched baseline tasks automatically or invent a savings percentage.

The optional guard applies only to opted-in chats and their descendants. It reserves a conservative text-input estimate based on serialized UTF-8 bytes plus the configured maximum output. Reservation is synchronous and includes parallel requests. Workers cannot consume the final-review reserve; the main Agent can. Completed requests reconcile to reported usage. Missing usage keeps the reservation held.

This estimate is not an exact tokenizer or a hard provider billing limit. Provider formatting, non-token charges and vendor-side retries may differ. All four price fields must be explicitly known when the guard is enabled. Image requests and unpriced models are rejected before the guarded stream dispatch. Calls without a session identity, such as some title generation or auxiliary calls, are outside its coverage.

Reservations belong to the current Host plugin instance. Historical conversations with calls or subagents cannot acquire a new guard account after restart; start a new conversation, or disable the guard to continue. This prevents a restarted plugin from treating earlier usage as zero. Set currency consistently and keep price/budget units unchanged during a guarded conversation.

## Compatibility and packaging

Version 0.2.0 targets DSH 0.2.0-rc.2. It uses published packages, a normal `dsh.bundle.patch` insert and a `./client` lazy CommonJS factory registered with DSH's ModuleLoader. The Host is ESM. Both built halves are shipped for GitHub and tarball installation.

The desktop client uses native IPC-compatible session objects; no custom HTTP endpoint, separate browser window or app binary patch is needed. The graph follows the existing theme tokens and locale service.

Keyless tests run native DSH infrastructure with a scripted LLM boundary. Component screenshots and browser tests verify the shipped graph component. Paid providers and installation into a user's live profile require additional real-environment validation; the release does not claim those have been exercised.
