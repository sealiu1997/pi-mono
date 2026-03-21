# OpenClaw Runtime Seam Proposal For Agent State Self Regulation

This document records the rationale and target shape of the OpenClaw runtime seam that the adapter now consumes. The seam has been implemented in the local OpenClaw runtime patch described by the integration notes you shared.

## Goal

Add a small, explicit set of public OpenClaw plugin runtime seams so `@sealiu1997/openclaw-agent-state-self-regulation` can become a fully functional OpenClaw-native plugin without relying on private runner patching.

This proposal is intentionally narrow. It does not try to expose the entire embedded pi extension system. It only exposes the minimum host-owned capabilities needed for:

- context-pressure observation
- explicit compaction requests
- explicit fresh-session requests

## Original Problem

The current OpenClaw plugin runtime is sufficient for observation-oriented integrations:

- `before_prompt_build`
- `before_compaction`
- `after_compaction`
- `before_reset`
- `registerTool`

At the time of the proposal, OpenClaw did not expose the three capabilities required for real session self-regulation:

1. `getContextUsage()`
2. `requestCompaction(...)`
3. `requestNewSession(...)`

As a result, the current adapter can only do:

- prompt injection
- script probes
- assessment extenders
- capability-aware state reporting

It cannot safely or cleanly do:

- true context-window based pressure evaluation
- agent-triggered compaction
- agent-triggered fresh-session switching

## Recommendation

Add three explicit host-owned runtime seams to the OpenClaw plugin runtime:

- `agent.getContextUsage(...)`
- `agent.requestCompaction(...)`
- `agent.requestNewSession(...)`

These should be first-class OpenClaw plugin runtime APIs, not internal patches and not a generic `extraExtensionFactories` escape hatch.

## Why This Is Better Than Private Patching

Private patching would couple the adapter to OpenClaw's current internal runner layout, call ordering, and private implementation details. That is fragile across upgrades and can fail silently at runtime.

Public seams do not eliminate upgrade work, but they convert it into explicit contract maintenance:

- fewer touchpoints
- clearer breakage surface
- easier testing
- easier downstream reuse

## Why Not `extraExtensionFactories` First

`extraExtensionFactories` is a larger and heavier seam than the self-regulation plugin actually needs.

Problems with using that as the first solution:

- It couples OpenClaw more tightly to pi's extension model.
- It creates two extension systems in one host: OpenClaw-native plugins and pi-native extension factories.
- It exposes a broad runner injection surface where a small host capability surface would be enough.
- It increases long-term compatibility burden because OpenClaw would need to track more pi lifecycle behavior directly.

`extraExtensionFactories` can still be considered later as a separate architectural decision if OpenClaw wants broad pi-extension interoperability. It should not be the first seam added for this feature.

## Proposed Runtime API

### 1. `getContextUsage()`

Purpose: expose the host's current best-effort session context usage so plugins can reason about context pressure before a model call.

Proposed shape:

```ts
type RuntimeContextUsage = {
  tokens: number | null;
  contextWindow: number | null;
  percent: number | null;
  source: "usage" | "estimate" | "unknown";
  sampledAt: number;
};

type GetContextUsageOptions = {
  sessionKey?: string;
  sessionId?: string;
};

getContextUsage(options?: GetContextUsageOptions): Promise<RuntimeContextUsage>;
```

Behavior:

- Return `null` metrics when the host cannot currently determine them.
- Never throw only because usage is unavailable.
- Use the active session by default when no selector is passed.
- This should be callable from plugin hook handlers and tool factories.

### 2. `requestCompaction(...)`

Purpose: let a plugin request host-managed compaction using an explicit profile or custom instructions.

Proposed shape:

```ts
type RuntimeCompactionRequest = {
  sessionKey?: string;
  sessionId?: string;
  profile?: "host-default" | "light" | "standard" | "aggressive";
  customInstructions?: string;
  reason?: string;
  replaceInstructions?: boolean;
  onComplete?: () => void;
  onError?: (error: unknown) => void;
};

requestCompaction(request?: RuntimeCompactionRequest): void;
```

Behavior:

- Queue the request against the active session when no session selector is passed.
- Preserve host ownership over actual compaction scheduling and execution.
- Allow the host to translate `profile` into its own compaction behavior.
- If both `profile` and `customInstructions` are provided, host-defined precedence should be documented explicitly.

### 3. `requestNewSession(...)`

Purpose: let a plugin request host-managed fresh-session creation, equivalent to a controlled `/new`-style transition.

Proposed shape:

```ts
type RuntimeNewSessionRequest = {
  sessionKey?: string;
  sessionId?: string;
  reason?: string;
  handoffSummary?: string;
  onComplete?: () => void;
  onError?: (error: unknown) => void;
};

requestNewSession(request?: RuntimeNewSessionRequest): void;
```

Behavior:

- Queue a host-owned session transition instead of forcing a plugin to mutate session state directly.
- Preserve existing OpenClaw semantics for how a fresh session is created and activated.
- The API should be explicit that this is not an in-place reset.

## Recommended Placement In OpenClaw

These seams should live on the OpenClaw plugin runtime's `agent` surface, alongside other host-owned agent/session runtime helpers.

Based on the inspected OpenClaw layout, the likely implementation path is:

- extend runtime types:
  - `src/plugins/runtime/types-core.ts`
  - `src/plugins/runtime/runtime-agent.ts`
- thread the implementation through the embedded agent runner/session layer:
  - `src/agents/pi-embedded-runner/run/params.ts`
  - `src/agents/pi-embedded-runner/run/attempt.ts`
  - `src/agents/pi-embedded-runner/compact.ts`
  - `src/agents/pi-embedded.ts`

Exact file details may drift by branch, but the architecture should stay the same:

- runtime type declaration
- runtime factory wiring
- embedded runner/session bridge

## Minimal Implementation Strategy

### Phase 1: Add Type-Safe Public Seams

- Add runtime type declarations for the three methods.
- Export them through the plugin runtime API.
- Wire them to the current active embedded agent session.

### Phase 2: Back Them With Host Behavior

- `getContextUsage()`
  - reuse the host's existing best-effort usage data if available
  - otherwise return unknown fields instead of throwing

- `requestCompaction(...)`
  - queue a compaction request against the active session
  - preserve host ownership of the actual execution lifecycle

- `requestNewSession(...)`
  - queue a fresh-session transition
  - preserve host ownership of activation and state switching

### Phase 3: Verify Plugin Consumption

Validation target:

- `@sealiu1997/openclaw-agent-state-self-regulation`

Required checks:

- plugin install succeeds
- plugin loads and registers
- `before_prompt_build` still works
- `self_regulate_context.get_state` can read actual context usage
- `self_regulate_context.compact` can trigger host compaction
- `self_regulate_context.new_session` can trigger host fresh-session behavior

## Compatibility And Upgrade Notes

Yes, adding public seams is still an OpenClaw core change. Future upgrades can still require maintenance if these APIs change.

However, this is still the preferred approach because it creates a stable contract boundary. Compared with private patching:

- failures are more likely to surface as explicit compile-time or contract-level changes
- fewer implementation details leak into plugins
- the adapter no longer depends on private runner structure

This is a normal and healthy maintenance model for a host/plugin architecture.

## Non-Goals

This proposal does not require:

- exposing arbitrary pi `ExtensionFactory[]`
- exposing all internal session manager methods
- exposing internal reset services directly
- making plugins responsible for low-level transcript mutation

## Acceptance Criteria

This proposal is complete when all of the following are true:

- OpenClaw plugin runtime exposes `getContextUsage()`
- OpenClaw plugin runtime exposes `requestCompaction(...)`
- OpenClaw plugin runtime exposes `requestNewSession(...)`
- the seams are documented and typed
- the self-regulation adapter can consume them without private imports or runner patching

## Short Summary For Implementation Handoff

Please add three public OpenClaw plugin runtime seams on the host-owned `agent` runtime surface:

- `getContextUsage()`
- `requestCompaction(...)`
- `requestNewSession(...)`

Do not solve this by injecting generic pi `ExtensionFactory[]` first. The self-regulation adapter only needs these three explicit capabilities, and a narrow seam will be easier to maintain than broad embedded-runner injection.
