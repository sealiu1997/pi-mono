# OpenClaw Agent State Self Regulation

OpenClaw-native adapter package for [`@sealiu1997/pi-agent-state-self-regulation`](https://github.com/sealiu1997/pi-mono/tree/main/packages/agent-state-self-regulation).

## Purpose

This package exists because OpenClaw does not currently load arbitrary `pi.extensions` packages into its embedded runner. The adapter exposes an OpenClaw-native plugin manifest and bridges the self-regulation feature set into OpenClaw's plugin system.

## Current Scope

- OpenClaw-native manifest and install surface
- Runtime seam integration for:
  - `runtime.agent.getContextUsage()`
  - `runtime.agent.requestCompaction()`
  - `runtime.agent.requestNewSession()`
- `before_prompt_build`, `before_compaction`, `after_compaction`, `before_reset`, and `session_start` hook wiring
- `self_regulate_context` tool surface with:
  - `get_state`
  - `list_profiles`
  - `compact`
  - `set_thresholds`
  - `new_session`
- Script probe and assessment-extender interfaces in the adapter API

## Current Limits

- `getContextUsage()` is best-effort host state, not an exact in-flight prompt accounting API
- `requestCompaction().profile` is currently host hint semantics, not hard compactor selection
- `requestNewSession()` is an MVP seam and should still be called conservatively

## Install

1. Build the package:

```bash
npm --prefix packages/openclaw-agent-state-self-regulation run build
```

2. Install it into OpenClaw from the built package directory:

```bash
openclaw plugins install -l /absolute/path/to/pi-mono/packages/openclaw-agent-state-self-regulation
```

## Programmatic API

The default export is an OpenClaw plugin entry. The package also exports `createOpenClawAgentStateSelfRegulationPlugin(...)` for advanced integrations that want to attach script probes or assessment extenders programmatically.

## Status

This package now targets the OpenClaw runtime seam directly. It can assess context pressure from `runtime.agent.getContextUsage()`, inject runtime state into the prompt, and expose callable `compact` / `new_session` tool actions to the agent through `self_regulate_context`.
