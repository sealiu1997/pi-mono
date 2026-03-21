# OpenClaw Adapter Development Plan

## Goal

Build an OpenClaw-native adapter for `@sealiu1997/pi-agent-state-self-regulation` that can be installed through `openclaw plugins install`, participate in OpenClaw's plugin lifecycle, and eventually reach feature parity where the host runtime makes that possible.

## Confirmed Host Facts

### Available today

- `package.json.openclaw.extensions` is the required manifest field for installation
- `openclaw.plugin.json` is read for plugin metadata and config schema
- OpenClaw plugins can register:
  - lifecycle hooks
  - tools
  - context engines
- The following hooks are relevant to this adapter:
  - `before_prompt_build`
  - `before_compaction`
  - `after_compaction`
  - `before_reset`
  - `session_start`

### Available through the runtime seam

- `runtime.agent.getContextUsage()`
- `runtime.agent.requestCompaction()`
- `runtime.agent.requestNewSession()`

### Still intentionally not exposed

- No public seam to append extra pi `ExtensionFactory[]` into the embedded pi runner
- No direct plugin ownership over transcript mutation or session-manager internals

## Adapter Strategy

### Package split

- Keep `@sealiu1997/pi-agent-state-self-regulation` as the pi-native package
- Add `@sealiu1997/openclaw-agent-state-self-regulation` as an OpenClaw-native adapter

### Adapter responsibilities

- Provide OpenClaw-compatible manifest files
- Map OpenClaw plugin config into adapter config
- Register OpenClaw hooks and tool surface
- Detect host capabilities at runtime
- Capability-gate actions the host does not expose

## Functional Plan

### Milestone 0: Skeleton

Status: complete in this package.

- Package manifest
- OpenClaw plugin metadata
- Runtime capability detection
- Hook registration scaffold
- `self_regulate_context` tool scaffold
- Development documentation

### Milestone 1: OpenClaw-native runtime state flow

Status: implemented.

- Use `before_prompt_build` as the prompt injection seam
- Maintain adapter-owned per-session state
- Read true host context usage through `runtime.agent.getContextUsage()`
- Store last observed compaction/reset metadata
- Support script probes inside the adapter
- Support assessment extenders inside the adapter
- Expose working `get_state`, `compact`, and `new_session` tool actions

### Milestone 2: Shared core extraction

Status: pending.

- Extract host-agnostic pieces out of the pi-native package or into a shared module:
  - script probe runner
  - assessment engine
  - prompt renderer
  - threshold validation
  - extender pipeline
- Reuse the same core logic from both adapters

### Milestone 3: Runtime hardening

Status: in progress.

- Add adapter-side throttling and request-state tracking
- Improve handoff summary quality for `new_session`
- Align profile semantics with future host compaction behavior

## Runtime Notes

The adapter now uses the host-owned runtime seam directly:

- `runtime.agent.getContextUsage(...)`
- `runtime.agent.requestCompaction(...)`
- `runtime.agent.requestNewSession(...)`

This remains preferable to an embedded-runner seam such as `extraExtensionFactories`, because the host-owned runtime API keeps the integration boundary narrower and more stable.

## Testing Plan

### Unit tests

- Config normalization
- Capability detection
- Context-usage driven assessment
- Script probe timeout / overflow / invalid JSON handling
- Extender merge behavior
- Tool request mapping
- Handoff summary generation

### Live checks

- Install via `openclaw plugins install`
- Confirm plugin is listed and enabled
- Confirm `before_prompt_build` runs
- Confirm `self_regulate_context.get_state` returns runtime usage state
- Confirm `compact` triggers `runtime.agent.requestCompaction(...)`
- Confirm `new_session` triggers `runtime.agent.requestNewSession(...)`

## Acceptance Criteria

- The package installs as an OpenClaw-native plugin
- Hook registration succeeds without patching OpenClaw
- The adapter can observe prompt/compaction/reset lifecycle events
- The adapter can request host compaction and fresh-session transitions
- The adapter exposes a stable tool surface to the agent
