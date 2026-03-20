# pi-agent-state-self-regulation

Self-regulation extension package for `@mariozechner/pi-coding-agent`.

It evaluates runtime context pressure on each `context` hook, treats host memory as an advisory-only signal by default, injects a compact runtime state block into the prompt, and exposes explicit compaction and fresh-session controls through a tool.

This package is now the canonical implementation source for the plugin. The `coding-agent` package is only the host runtime boundary it targets, not the place where the plugin source lives.

Current baseline capabilities:

- per-call state assessment on the `context` hook
- prompt injection with context-first runtime state
- explicit `self_regulate_context` tool with `get_state`, `list_profiles`, `compact`, `set_thresholds`, and `new_session`
- built-in `host-default`, `light`, `standard`, and `aggressive` compaction profiles backed by the existing core `compact()` engine
- custom probes surfaced back through regulation state
- script probes can inject sanitized structured prompt fields from external JSON-producing commands
- generic assessment extenders can safely rewrite the computed assessment and inject additional structured prompt fields
- custom compaction profiles via callback-backed `mode: "custom"`
- `reset_session` remains a reserved design hook for future host support, but it is not exposed in the current tool surface
- package-level tests cover hook registration, tool actions, script probes, and custom compaction routing

## Packaging Status

This package already has the structure of a standalone plugin package:

- its own `package.json`
- npm `exports` for the root entry and `./extension`
- `pi.extensions` metadata for `pi install`
- a `prepublishOnly` build step for release-time packaging

Current release-readiness note:

- the standalone package itself is now the canonical source of truth
- `npm pack --dry-run` succeeds, so the package manifest and publishing shape are valid
- the current source checkout does not include `dist`, so a dry-run tarball produced without a release build contains only docs and metadata
- practical conclusion: it is structurally ready for standalone distribution, but actual publishable artifacts still depend on the build output being generated during the release flow

Current integration status:

- local source integration with `pi` passed
- script probe smoke passed
- standalone build and pack smoke passed
- installed-package load smoke passed
- external-host compatibility smoke is the current next step

Repository-checkout note:

- this repository does not commit `dist` artifacts for the standalone package
- if you want to load the package from a raw git checkout on another machine, run `npm --prefix packages/agent-state-self-regulation run build` there first, or use a packed tarball generated from a built checkout

## Development Progress

| Capability | Status | Notes |
| --- | --- | --- |
| Standalone package metadata | Completed | Own package manifest, exports, and `pi.extensions` are in place |
| Per-call state assessment | Completed | Evaluated on each `context` hook |
| Context-first prompt injection | Completed | Runtime state block is injected into prompt context |
| Explicit regulation tool | Completed | `get_state`, `list_profiles`, `compact`, `set_thresholds`, and `new_session` are implemented |
| Runtime threshold overrides | Completed | Context and advisory memory thresholds can be adjusted at runtime and persisted per session |
| Agent-callable fresh-session controls | Completed | `new_session` is exposed directly through the host's `/new` behavior |
| Dedicated `reset_session` semantics | Planned | Method shape is reserved, but no separate host-level reset logic is exposed yet |
| Built-in compaction profile layer | Completed | `host-default`, `light`, `standard`, and `aggressive` are implemented as profile presets and dispatch behavior |
| New compression algorithms beyond core `compact()` | Not started | Current built-ins still route into the existing core compaction engine rather than a new summarization algorithm |
| Custom probe surfacing | Completed | Latest custom probe states are exposed through regulation state |
| Script probe prompt injection prototype | Completed | JSON-based external command probes can inject sanitized top-level scalar fields into the runtime prompt block |
| Callback-backed custom profiles | Completed | `mode: "custom"` can return a full compaction result |
| Generic assessment extender layer | Completed | Extenders can rewrite the computed assessment and add structured prompt fields before rendering |
| Optional host fallback interception | Completed | Disabled by default, available through config |
| Local pack tarball with built `dist` | Partial | Release flow is wired, but current checkout does not ship built artifacts |
| Local source integration smoke | Completed | A-round passed against local `pi` with real model/tool execution |
| Installed package load smoke | Completed | D-round passed from an installed package path rather than the monorepo source tree |
| External-host compatibility smoke | In progress | Next target is OpenClaw or another compatible host |
| Package-level automated tests | Completed | Standalone tests cover hooks, tool actions, script probes, and custom compaction routing |
| Slash commands | Planned | Not part of the current baseline |
| Custom message renderer | Planned | Useful for better UX, not required for v1 |
| Timer or heartbeat scheduler | Not planned for v1 | Intentionally excluded from the current design |

## Install

As a pi package:

```bash
pi install npm:@mariozechner/pi-agent-state-self-regulation
```

As a programmatic dependency:

```bash
npm install @mariozechner/pi-agent-state-self-regulation @mariozechner/pi-coding-agent
```

Git-based pi package install also works:

```bash
pi install git:github.com/your-org/pi-agent-state-self-regulation
```

## Use

Programmatic registration:

```ts
import { createAgentStateSelfRegulationExtension } from "@mariozechner/pi-agent-state-self-regulation";

const extension = createAgentStateSelfRegulationExtension({
	config: {
		contextThresholds: {
			tightPercent: 70,
			criticalPercent: 85,
		},
	},
	scriptProbes: [
		{
			key: "workspace_health",
			command: "node",
			args: ["./scripts/workspace-health.mjs"],
			timeoutMs: 400,
		},
	],
	assessmentExtenders: [
		{
			id: "workspace_policy",
			extend({ assessment, snapshot }) {
				const workspaceProbe = snapshot.custom.workspace_health;
				if (!workspaceProbe || workspaceProbe.status === "normal") {
					return;
				}

				return {
					assessment: {
						...assessment,
						level: "critical",
						reasons: [...assessment.reasons, "Workspace policy escalated runtime cleanup urgency."],
						suggestedActions: ["compact_standard", "compact_aggressive"],
						selectedProfile: "standard",
					},
					promptData: {
						workspace_policy: workspaceProbe.status,
					},
				};
			},
		},
	],
});
```

Default pi-package entrypoint:

```ts
import agentStateSelfRegulationExtension from "@mariozechner/pi-agent-state-self-regulation/extension";

export default agentStateSelfRegulationExtension;
```

## Compatibility

This package targets hosts that load normal `@mariozechner/pi-coding-agent` extensions.

- `pi` and other hosts that preserve the same extension lifecycle can load it directly.
- Hosts built only on lower-level `pi-agent-core` primitives need a thin adapter for prompt injection, tool registration, and state persistence.
- The canonical source now lives in `packages/agent-state-self-regulation`, and the host-facing runtime contract comes from `@mariozechner/pi-coding-agent`.

## Docs

- Architecture and implementation notes: `packages/agent-state-self-regulation/docs/ARCHITECTURE.md`

---

# 中文版

`@mariozechner/pi-coding-agent` 的自调节扩展包。

它会在每次 `context` hook 上评估运行时上下文压力，默认将宿主机内存视为仅供参考的辅助信号，把紧凑的运行时状态块注入提示词，并通过工具暴露显式的压缩与新会话控制能力。

这个包现在已经是插件的唯一规范实现来源。`coding-agent` 只提供它所依赖的宿主 runtime 边界，不再承载这份插件源码本身。

当前基础能力包括：

- 在 `context` hook 上逐次进行状态评估
- 以上下文窗口为主信号的提示词状态注入
- 显式的 `self_regulate_context` 工具，支持 `get_state`、`list_profiles`、`compact`、`set_thresholds` 和 `new_session`
- 内置 `host-default`、`light`、`standard`、`aggressive` 四种压缩 profile，这些 profile 目前仍建立在现有核心 `compact()` 引擎之上
- 自定义 probe 的最新状态会回流到 regulation state 中
- 支持通过外部 JSON 脚本 probe 注入经过清洗的结构化 prompt 字段
- 已支持通用 assessment extender，可在渲染前改写 assessment 并补充结构化 prompt 字段
- 支持通过 callback 驱动的 `mode: "custom"` 自定义压缩 profile
- `reset_session` 目前保留为后续宿主支持的预留定义，但暂未暴露到当前 tool surface 中
- 已有包级自动化测试，覆盖 hook 注册、tool 行为、script probe 和自定义 compaction 路由

## 打包状态

这个包现在已经具备独立插件包的基本结构：

- 有自己的 `package.json`
- 配置了根入口和 `./extension` 的 npm `exports`
- 配置了供 `pi install` 使用的 `pi.extensions`
- 配置了发布前构建步骤 `prepublishOnly`

当前关于发布就绪度，需要明确一点：

- 这个独立包已经是当前插件的唯一真源
- `npm pack --dry-run` 可以成功执行，说明包清单和发布结构是成立的
- 当前源码工作区没有提交 `dist` 产物，所以在不经过发布构建的 dry-run 场景下，tarball 里只有文档和元数据
- 实际结论是：它已经具备“独立分发包”的结构条件，但真正可发布的制品仍依赖发布流程里先产出构建物

当前联调状态：

- 本地 `pi` 源码态联调已通过
- script probe smoke 已通过
- 独立包 build 和 pack smoke 已通过
- 安装后包加载 smoke 已通过
- 外部宿主兼容性 smoke 是当前下一步

仓库 checkout 使用说明：

- 当前仓库不会提交这个独立包的 `dist` 构建产物
- 如果你准备在另一台机器上直接从 git checkout 加载这个包，需要先在目标机执行 `npm --prefix packages/agent-state-self-regulation run build`，或者改用从已构建工作区生成的 tarball

## 功能开发进度

| 能力项 | 状态 | 说明 |
| --- | --- | --- |
| 独立包元数据 | 已完成 | 已具备独立包清单、导出配置和 `pi.extensions` |
| 按次状态评估 | 已完成 | 每次 `context` hook 都会执行评估 |
| 上下文优先的提示词注入 | 已完成 | 会向 prompt 注入运行时状态块 |
| 显式 regulation 工具 | 已完成 | 已实现 `get_state`、`list_profiles`、`compact`、`set_thresholds`、`new_session` |
| 运行时阈值调整 | 已完成 | 支持在当前会话内动态调整上下文和辅助内存阈值，并持久化到 session entries |
| Agent 可调用的新会话接口 | 已完成 | 已暴露 `new_session`，底层走宿主 `/new` 行为 |
| 独立 `reset_session` 语义 | 规划中 | 方法定义保留，但当前没有独立宿主逻辑，也未挂到 tool 上 |
| 内置 compaction profile 层 | 已完成 | 已支持 `host-default`、`light`、`standard`、`aggressive`，但它们本质上是 profile 预设和分发行为 |
| 超出核心 `compact()` 的新压缩算法 | 未开始 | 当前内置 profile 仍然走现有核心 compaction 引擎，而不是一套新的摘要算法 |
| 自定义 probe 状态回流 | 已完成 | 自定义 probe 的最新状态可通过 regulation state 查看 |
| 脚本 probe prompt 注入原型 | 已完成 | 支持 JSON 外部命令 probe，把经过清洗的顶层标量字段注入运行时 prompt |
| callback 自定义 profile | 已完成 | `mode: "custom"` 可返回完整 compaction result |
| 通用 assessment extender 层 | 已完成 | 已支持在渲染前改写 assessment，并补充结构化 prompt 字段 |
| 可选宿主 fallback 接管 | 已完成 | 默认关闭，可通过配置启用 |
| 本地 pack 直接产出带 `dist` 的 tarball | 部分完成 | 发布流程已接通，但当前源码工作区不包含构建产物 |
| 本地源码态联调 smoke | 已完成 | A 轮已在本地 `pi` + 真实模型下通过 |
| 安装后包加载 smoke | 已完成 | D 轮已从安装包路径而不是 monorepo 源码路径通过 |
| 外部宿主兼容性 smoke | 进行中 | 下一步目标是 OpenClaw 或其他兼容宿主 |
| 包级自动化测试 | 已完成 | 独立包自身已覆盖 hooks、tool、script probe 和自定义 compaction 路由 |
| Slash Commands | 规划中 | 不属于当前基础版范围 |
| 自定义消息渲染器 | 规划中 | 可提升体验，但不是 v1 必需项 |
| Timer / Heartbeat 调度器 | 不纳入 v1 | 这是当前设计中刻意排除的内容 |

## 安装

作为 pi package 安装：

```bash
pi install npm:@mariozechner/pi-agent-state-self-regulation
```

作为普通编程依赖安装：

```bash
npm install @mariozechner/pi-agent-state-self-regulation @mariozechner/pi-coding-agent
```

也支持基于 Git 的 pi package 安装：

```bash
pi install git:github.com/your-org/pi-agent-state-self-regulation
```

## 使用

代码方式注册：

```ts
import { createAgentStateSelfRegulationExtension } from "@mariozechner/pi-agent-state-self-regulation";

const extension = createAgentStateSelfRegulationExtension({
	config: {
		contextThresholds: {
			tightPercent: 70,
			criticalPercent: 85,
		},
	},
	scriptProbes: [
		{
			key: "workspace_health",
			command: "node",
			args: ["./scripts/workspace-health.mjs"],
			timeoutMs: 400,
		},
	],
	assessmentExtenders: [
		{
			id: "workspace_policy",
			extend({ assessment, snapshot }) {
				const workspaceProbe = snapshot.custom.workspace_health;
				if (!workspaceProbe || workspaceProbe.status === "normal") {
					return;
				}

				return {
					assessment: {
						...assessment,
						level: "critical",
						reasons: [...assessment.reasons, "Workspace policy escalated runtime cleanup urgency."],
						suggestedActions: ["compact_standard", "compact_aggressive"],
						selectedProfile: "standard",
					},
					promptData: {
						workspace_policy: workspaceProbe.status,
					},
				};
			},
		},
	],
});
```

默认的 pi-package 入口：

```ts
import agentStateSelfRegulationExtension from "@mariozechner/pi-agent-state-self-regulation/extension";

export default agentStateSelfRegulationExtension;
```

## 兼容性

这个包面向能够加载标准 `@mariozechner/pi-coding-agent` extension 的宿主。

- `pi` 以及其他保留相同 extension 生命周期的宿主，可以直接加载它。
- 如果宿主只建立在更底层的 `pi-agent-core` 原语上，就需要一个很薄的适配层，来处理 prompt 注入、tool 注册和状态持久化。
- 现在的规范实现已经迁到 `packages/agent-state-self-regulation`，而 `@mariozechner/pi-coding-agent` 负责提供宿主运行时契约。

## 文档

- 架构与实现说明：`packages/agent-state-self-regulation/docs/ARCHITECTURE.md`
