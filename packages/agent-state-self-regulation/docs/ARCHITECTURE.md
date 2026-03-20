# Agent State Self-Regulation Architecture

## Status

This document is now the canonical long-form architecture document for the `@mariozechner/pi-agent-state-self-regulation` package.

Completed in the current baseline:

- the canonical implementation source now lives in `packages/agent-state-self-regulation`
- the package integrates through the public `@mariozechner/pi-coding-agent` extension API
- per-call evaluation is implemented through the `context` hook
- a generic `assessmentExtenders` pipeline is implemented
- script probes provide a constrained external-data ingestion path
- built-in tool actions cover `get_state`, `list_profiles`, `compact`, `set_thresholds`, and `new_session`
- standalone package tests cover hook registration, tool behavior, script probes, and custom compaction routing

Still intentionally not part of the current baseline:

- a dedicated in-place `reset_session` host API
- new built-in compression algorithms beyond the host `compact()` engine
- slash commands and custom message renderers
- timer or heartbeat scheduling

## Development Progress

| Area | Status | Notes |
| --- | --- | --- |
| Standalone package layout | Done | The standalone package is now the canonical source |
| Hook registration and prompt injection | Done | `context` is the primary evaluation hook |
| Threshold policy and runtime overrides | Done | Config defaults plus session-level `set_thresholds` |
| Built-in probes | Done | Context usage and advisory system memory |
| Script probe prototype | Done | JSON-only, sanitized, bounded prompt injection |
| Assessment extender pipeline | Done | Extenders can rewrite assessment and add prompt fields |
| Compaction profile routing | Done | `host-default`, `light`, `standard`, `aggressive`, plus custom profiles |
| Host fresh-session action | Done | `new_session` maps to host `/new` semantics |
| Dedicated in-place reset | Pending | Reserved only, not implemented |
| New compression algorithms | Pending | Current profiles still route through host `compact()` |
| Publish smoke and release hardening | Pending | Still needs pack and install verification as a released package |

## 1. Project Scope

### 1.1 In Scope

- evaluate context-window usage before each LLM call
- optionally evaluate system memory pressure as an advisory-only host signal
- allow future custom probes such as quota, provider health, or external monitors
- allow threshold policy to be adjusted by configuration and by explicit tool calls within a session
- convert probe outputs into a compact, structured state assessment
- inject that assessment into prompt context in a stable, low-noise format
- support constrained script probes that can inject sanitized structured fields into the prompt
- provide built-in compaction profiles
- expose explicit compaction and fresh-session actions that the agent or user can call
- preserve compatibility with applications built on top of `packages/coding-agent`

### 1.2 Out of Scope

- A2A messaging
- autonomous timers or heartbeat loops
- background task orchestration
- replacing the host's built-in fallback compaction behavior by default
- long-term memory retrieval or external memory storage in v1

### 1.3 Core Product Decision

The plugin is intentionally small. It should:

1. measure
2. assess
3. inform the model
4. offer explicit regulation actions

It should not:

1. run hidden autonomy loops
2. decide on its own that work must stop
3. replace the host session manager

## 2. Why This Design Is Smaller And Better

- It maps directly onto existing `coding-agent` extension hooks.
- It does not require changes in `packages/agent`.
- It keeps policy at the edge and leaves the host runtime intact.
- It can ship as a reusable open-source package instead of a project-specific architecture fork.

## 3. Compatibility And Packaging

### 3.1 Primary Compatibility Target

The plugin assumes a host that exposes the standard `coding-agent` extension contract:

- `context` for per-call message transformation
- `before_agent_start` for per-turn setup
- `session_before_compact` for custom compaction routing
- `ctx.getContextUsage()` for context-window estimates
- `ctx.compact()` for host compaction
- `ctx.requestNewSession()` for host-level `/new`-style fresh-session requests
- `pi.registerTool()` for agent-callable actions
- `pi.appendEntry()` for lightweight persistence

### 3.2 Compatibility With Other pi-mono-Based Agents

This package is reusable when the host:

1. loads standard `coding-agent` extensions
2. exposes the same extension lifecycle

The compatibility boundary is mainly about:

- state persistence
- tool registration
- compaction invocation
- prompt injection

### 3.3 Packaging Direction

The package is designed for:

- npm distribution as `@mariozechner/pi-agent-state-self-regulation`
- extension loading through the package manifest `pi.extensions`
- programmatic use via exported factory functions and types

The standalone package is the canonical source. It is structurally ready for independent distribution, but actual release confidence still depends on running package-level build, pack, and install validation in the release flow.

## 4. Hook Strategy

### 4.1 Primary Hook: `context`

`context` is the main per-call evaluation hook because:

- it runs before each LLM call
- it is the closest host lifecycle event to "evaluate at model-call start"
- it can inject a short state block directly into the outgoing message list

The `context` hook is responsible for:

- reading cached probe results
- refreshing cheap probes
- refreshing stale throttled probes when needed
- building the current `StateAssessment`
- running assessment extenders
- injecting a compact runtime-state message into prompt context

### 4.2 Secondary Hook: `before_agent_start`

`before_agent_start` is used for turn-level setup, not high-frequency state evaluation.

Typical responsibilities:

- check whether the feature is enabled
- append turn-level instructions about how the model may use the tool
- optionally seed regulation state if the session has no prior entries

### 4.3 Compaction Hook: `session_before_compact`

`session_before_compact` exists so the package can:

- provide custom compaction instructions
- provide a fully custom compaction result
- attach profile metadata to compaction details
- optionally intercept host fallback compaction when explicitly enabled

The important default is unchanged:

- host fallback compaction remains the source of truth
- the extension does not replace it by default
- `interceptHostCompactionByDefault` should remain opt-in

### 4.4 Hooks Explicitly Not Used In v1

The design intentionally does not rely on lower-level provider-request hooks as the primary policy surface because:

- they are lower-level than needed
- they are less portable across host integrations
- they are worse for prompt-layer reasoning than `context`

## 5. Functional Modules

### 5.1 Configuration Module

Responsibilities:

- parse extension options
- load defaults
- expose runtime configuration
- define threshold policy
- support runtime threshold overrides
- define probe TTL values

### 5.2 Probe Registry

Responsibilities:

- register built-in probes
- register custom probes
- cache probe results by TTL
- return a normalized `ResourceSnapshot`

Built-in baseline probes:

- context usage probe
- system memory probe, advisory only
- script probes

Future-compatible probe categories:

- provider quota probe
- provider health probe
- user-defined remote probe

### 5.3 Assessment Engine

Responsibilities:

- convert raw probe outputs into a single `StateAssessment`
- assign a level such as `normal`, `tight`, `critical`, or `unknown`
- generate compact reasons and suggested actions
- keep the assessment objective and low-drama

### 5.4 Assessment Extender Pipeline

Responsibilities:

- let downstream policy modules post-process the base assessment
- allow bounded prompt-field augmentation
- keep collection and policy separate

Recommended split:

- probes collect data
- assessment engine computes the base judgment
- extenders refine policy and add prompt fields

### 5.5 Prompt Renderer

Responsibilities:

- render a short, deterministic runtime-state block
- keep token cost low
- avoid giant diagnostic dumps
- optionally suppress injection when the state is healthy and unchanged
- merge base metrics, script-probe prompt fields, and extender prompt fields

### 5.6 Compaction Profile Registry

Responsibilities:

- define built-in compaction profiles
- resolve profile IDs
- dispatch to delegate, instruction-driven, or custom compaction logic

### 5.7 Tool Surface

Responsibilities:

- expose agent-callable actions
- keep the action schema stable
- allow explicit runtime policy adjustment

Current baseline actions:

- `get_state`
- `list_profiles`
- `compact`
- `set_thresholds`
- `new_session`

Reserved only:

- `reset_session`

### 5.8 Persistence And Observability

Responsibilities:

- store the latest stable assessment
- store assessment transitions
- store the last selected compaction profile
- avoid logging every probe sample into session history

## 6. Data Model

### 6.1 Core Types

The current implementation is organized around these primary types:

- `RegulationConfig`
  - global configuration such as enablement, thresholds, TTLs, host-compaction interception, and prompt behavior
- `ProbeResult<T>`
  - normalized probe output with timestamped data, optional level, reasons, and prompt fields
- `ContextUsageSample`
  - current context tokens, context window, and optional usage percentage
- `SystemMemorySample`
  - host memory totals and advisory percentages
- `ResourceSnapshot`
  - the full normalized input snapshot for one evaluation pass
- `StateAssessment`
  - merged state level, reasons, suggested actions, metrics, and recommended profile
- `RegulationStateRecord`
  - persisted session-level state record
- `AssessmentExtenderContext`
  - the input passed to each registered assessment extender
- `AssessmentExtenderResult`
  - the optional assessment override and prompt fields returned by an extender
- `CompactionProfileDefinition`
  - one compaction profile entry, either delegate, instruction-driven, or fully custom
- `SelfRegulationToolInput`
  - structured tool input schema

### 6.2 Data Nesting

At runtime, the nesting is:

1. probes produce `ProbeResult<T>`
2. probe registry combines them into `ResourceSnapshot`
3. assessment engine converts the snapshot into `StateAssessment`
4. assessment extenders may replace or enrich that assessment
5. state store persists a `RegulationStateRecord`
6. prompt renderer converts the final assessment plus prompt fields into the injected state block

### 6.3 Important Data Rules

- `contextUsage.percent` may be `null` after compaction and must not be treated as a hard truth
- `systemMemory` reflects local host state, not provider state
- system memory is advisory by default and must not outweigh context-window pressure
- `custom` and script-probe data must remain optional and must not block the extension
- script-probe prompt data must remain small, scalar-only, and sanitized before prompt injection
- only stable changes and transitions should be persisted by default

## 7. Object Design

### 7.1 `AgentStateSelfRegulationExtension`

Responsibilities:

- wire hooks
- initialize registries
- register tools
- hold the active configuration
- coordinate evaluation, prompt injection, compaction requests, and session-control requests

### 7.2 `ProbeRegistry`

Responsibilities:

- manage built-in and custom probes
- honor TTL
- assemble `ResourceSnapshot`

### 7.3 `AssessmentEngine`

Responsibilities:

- map raw signals to one regulation level
- generate reasons and suggested actions
- keep the context-first merge rule stable

### 7.4 `PromptRenderer`

Responsibilities:

- render a compact injection block
- keep the format deterministic
- merge prompt fields from base metrics, script probes, and extenders

### 7.5 `CompactionProfileRegistry`

Responsibilities:

- store built-in profiles
- resolve requested profiles
- coordinate delegate or custom compaction

### 7.6 `RegulationStateStore`

Responsibilities:

- read and write `RegulationStateRecord`
- suppress noisy writes
- persist stable changes only

### 7.7 `SelfRegulationTool`

Responsibilities:

- expose the current assessment to the model
- let the model choose a compaction profile when the user or system policy allows it
- let the model request a host fresh session through `new_session`

## 8. Built-In Assessment Policy

### 8.1 Context Usage Thresholds

Default policy:

- `normal`: below 70%
- `tight`: 70% to below 85%
- `critical`: 85% and above
- `unknown`: percentage unavailable

Adjustment paths:

- at extension construction time through `config.contextThresholds`
- at runtime through the `self_regulate_context` tool action `set_thresholds`

### 8.2 System Memory Thresholds

Default policy:

- `normal`: below 75%
- `tight`: 75% to below 90%
- `critical`: 90% and above

Important interpretation:

- system memory is advisory only
- it may add warnings and suggested actions
- it should not become the primary compaction trigger unless the policy is explicitly changed later

### 8.3 Final Merge Rule

The baseline merge rule is context-first:

- context `tight` plus memory `normal` gives overall `tight`
- context `normal` plus memory `critical` gives overall `normal` with advisory warning
- context `unknown` plus memory `critical` gives overall `unknown` with advisory warning

Conservative design reasons:

- context usage may be temporarily unavailable after compaction
- host memory behavior differs significantly across operating systems
- the plugin should remain conservative instead of treating host memory as a universal compaction truth

## 9. Script Probe Model

Script probes exist as a safe external-data ingestion path.

Current baseline rules:

- scripts must return JSON
- only sanitized scalar prompt fields may enter prompt injection
- prompt field names are normalized
- text values are truncated
- output size is bounded
- execution is time-bounded
- script failure must not break the whole extension

This enables controlled prompt enrichment from user-provided scripts without allowing arbitrary raw command output to flow directly into prompts.

## 10. Built-In Compaction Profiles

### 10.1 `host-default`

- mode: `delegate`
- behavior: call host compaction without overriding the strategy

### 10.2 `light`

- mode: `instructions`
- goal: preserve the current task and active constraints while compressing peripheral history

### 10.3 `standard`

- mode: `instructions`
- goal: summarize prior discussion into a concise task-preserving checkpoint

### 10.4 `aggressive`

- mode: `instructions`
- goal: minimize context aggressively while preserving only essential task state

### 10.5 Important Compaction Rule

- `light`, `standard`, and `aggressive` are currently instruction presets layered on top of the existing host `compact()` implementation
- the package does not yet ship a brand-new built-in compression algorithm separate from the host compaction engine
- `interceptHostCompactionByDefault` should remain `false` by default
- proactive compaction through the tool is supported, but it is explicit and opt-in

## 11. Agent-Callable Interface

The tool name is:

- `self_regulate_context`

Current actions:

- `get_state`
- `list_profiles`
- `compact`
- `set_thresholds`
- `new_session`

Current behavior summary:

- `get_state` returns the latest assessment, recommended actions, thresholds, and current custom probe states
- `list_profiles` returns built-in and custom profiles
- `compact` executes the selected profile, defaulting to `host-default`
- `set_thresholds` updates current-session context and advisory memory thresholds with validation and persistence
- `new_session` requests the host's built-in `/new` behavior for a fresh session

Reserved but not exposed:

- `reset_session`

`reset_session` remains a reserved method definition for future host support. It is intentionally not mounted on the current tool surface because the host does not yet expose a dedicated in-place reset API distinct from `/new`.

## 12. Persistence Rules

The baseline persistence policy is intentionally quiet:

- do not persist every probe sample
- do not append a new state message on every healthy call
- persist only meaningful state transitions and regulation-side effects

Expected persisted entry categories:

- `agent_state_regulation/config`
- `agent_state_regulation/state`
- `agent_state_regulation/transition`
- `agent_state_regulation/compaction`

## 13. Remaining Work

The plugin is already usable inside the monorepo baseline, but a release-quality package still needs a final hardening pass.

P0 release blockers:

- run package-level build, pack, and install smoke validation as part of release preparation
- verify the released package shape from a clean environment, not only from the monorepo workspace
- keep the standalone package documentation aligned with implementation changes

P1 near-term improvements:

- add richer schema hooks around script probes and extender prompt fields
- add clearer public examples for custom probes, script probes, extenders, and custom compaction profiles
- add a dedicated package release checklist

P2 future enhancements:

- dedicated host-level `reset_session`
- new built-in compression algorithms
- optional slash commands
- optional custom message renderers
- optional TUI state-transition summaries

## 14. Task Checklist

| Task | Status | Notes |
| --- | --- | --- |
| Move canonical source into standalone package | Done | `packages/agent-state-self-regulation` is the only plugin source |
| Remove duplicated implementation from `coding-agent` | Done | The old source tree has been retired |
| Add generic assessment extender layer | Done | Extenders can rewrite assessment and contribute prompt fields |
| Keep script probes safe | Done | Timeout, output size, JSON parsing, and prompt-field sanitization are in place |
| Add standalone tests | Done | Hook registration, tools, script probes, and custom compaction routing are covered |
| Add dedicated `reset_session` host support | Pending | Reserved only, not implemented |
| Add new compression algorithms | Pending | Current profiles still route through host `compact()` |
| Complete release smoke for external distribution | Pending | Needs clean-environment pack and install verification |

---

# 中文版

## 当前状态

这份文档现在是 `@mariozechner/pi-agent-state-self-regulation` 的规范长文档架构说明。

当前基线已完成：

- 真正的规范实现已经迁移到 `packages/agent-state-self-regulation`
- 插件通过公开的 `@mariozechner/pi-coding-agent` extension API 集成
- 逐次模型调用评估已通过 `context` hook 落地
- 通用 `assessmentExtenders` 管线已实现
- script probe 已作为受限的外部数据接入路径实现
- 内置 tool 已覆盖 `get_state`、`list_profiles`、`compact`、`set_thresholds`、`new_session`
- 独立包专项测试已经覆盖 hook 注册、tool、script probe 和自定义 compaction 路由

当前仍明确不纳入基线：

- 真正独立的原地 `reset_session` 宿主 API
- 超出宿主 `compact()` 引擎的新内置压缩算法
- slash commands 和自定义消息渲染器
- timer 或 heartbeat 调度器

## 功能开发进度

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 独立包源码布局 | 已完成 | 独立包已经成为规范真源 |
| Hook 注册与 prompt 注入 | 已完成 | `context` 是主要逐次评估 hook |
| 阈值策略与运行时覆写 | 已完成 | 支持默认配置和 session 级 `set_thresholds` |
| 内置 probes | 已完成 | 包含上下文用量和辅助型系统内存 |
| Script probe 原型 | 已完成 | 仅接受 JSON，注入前会清洗和裁剪 |
| Assessment extender 管线 | 已完成 | Extender 可改写 assessment 并补充 prompt 字段 |
| Compaction profile 路由 | 已完成 | 已支持 `host-default`、`light`、`standard`、`aggressive` 和自定义 profile |
| 宿主 fresh-session 动作 | 已完成 | `new_session` 映射到宿主 `/new` 语义 |
| 真正的原地 reset | 待完成 | 仅预留定义，尚未实现 |
| 新的压缩算法 | 待完成 | 当前 profiles 仍复用宿主 `compact()` |
| 发布链路与 release hardening | 待完成 | 还需要补独立包发布形态的 pack/install 验证 |

## 1. 项目范围

### 1.1 范围内

- 在每次 LLM 调用前评估上下文窗口使用情况
- 可选地评估系统内存压力，但仅作为辅助型宿主信号
- 为后续 quota、provider health、外部监控等自定义 probe 预留扩展点
- 支持通过配置和显式 tool 调用调整阈值策略
- 将 probe 输出收敛成一个紧凑的结构化状态评估
- 以稳定、低噪声的格式把评估结果注入 prompt context
- 支持受限的 script probe，把清洗后的结构化字段注入 prompt
- 提供内置 compaction profiles
- 暴露可由 agent 或用户调用的显式 compaction 与新会话动作
- 保持与基于 `packages/coding-agent` 构建的宿主兼容

### 1.2 范围外

- A2A 消息
- 自动计时器或 heartbeat 循环
- 后台任务编排
- 默认替换宿主内置 fallback compaction 行为
- v1 中的长期记忆检索或外部记忆存储

### 1.3 核心产品判断

这个插件要刻意保持“小而清晰”。它应该：

1. 测量
2. 评估
3. 告知模型
4. 提供显式调节动作

它不应该：

1. 运行隐藏自治循环
2. 自行决定工作必须停止
3. 替代宿主 session manager

## 2. 为什么这个设计更小也更好

- 它可以直接映射到已有的 `coding-agent` extension hooks。
- 它不需要修改 `packages/agent`。
- 它把策略留在边缘层，不破坏宿主 runtime。
- 它可以作为可复用的开源包发布，而不是只服务当前项目的一条架构分支。

## 3. 兼容性与分发

### 3.1 主要兼容目标

这个插件假设宿主暴露标准的 `coding-agent` extension contract：

- `context`，用于逐次调用前的消息变换
- `before_agent_start`，用于每个 turn 的初始化
- `session_before_compact`，用于自定义 compaction 路由
- `ctx.getContextUsage()`，用于估算上下文窗口用量
- `ctx.compact()`，用于调用宿主 compaction
- `ctx.requestNewSession()`，用于请求宿主级 `/new`
- `pi.registerTool()`，用于注册 agent 可调用动作
- `pi.appendEntry()`，用于轻量状态持久化

### 3.2 与其他基于 pi-mono 的 agent 的兼容性

只要宿主：

1. 能加载标准 `coding-agent` extensions
2. 暴露相同的 extension 生命周期

这个包就有较高复用性。

真正的兼容边界主要在：

- 状态持久化
- tool 注册
- compaction 调用
- prompt 注入

### 3.3 分发方向

这个包面向以下两种使用方式：

- 作为 `@mariozechner/pi-agent-state-self-regulation` 通过 npm 分发
- 通过 `pi.extensions` 作为可安装 extension 被发现和加载
- 通过包根导出的 factory 和 types 进行编程式集成

独立包现在已经是规范真源。从结构上看它已经适合独立分发，但要达到真正稳妥的对外发布状态，仍需要在 release 流程里补独立包的 build、pack、install 验证。

## 4. Hook 策略

### 4.1 主 Hook：`context`

`context` 是主评估 hook，因为：

- 它会在每次 LLM 调用前运行
- 它最接近“模型调用开始时评估”的需求
- 它可以直接把一个紧凑状态块注入即将发出的消息列表

`context` hook 负责：

- 读取缓存的 probe 结果
- 刷新便宜的 probe
- 在需要时刷新带 TTL 的 probe
- 构建当前 `StateAssessment`
- 执行 assessment extenders
- 向 prompt context 注入小型 runtime-state message

### 4.2 次级 Hook：`before_agent_start`

`before_agent_start` 用于 turn 级初始化，而不是高频状态评估。

典型职责：

- 检查功能是否启用
- 附加 turn 级说明，让模型知道如何使用 tool
- 在 session 没有任何 regulation state 时可选 seed 一条状态信息

### 4.3 Compaction Hook：`session_before_compact`

`session_before_compact` 的作用是让插件可以：

- 提供自定义 compaction 指令
- 直接返回完整的 custom compaction result
- 在 compaction details 上附加 profile 元数据
- 在用户显式开启时接管宿主 fallback compaction

当前最重要的默认规则不变：

- 宿主 fallback compaction 仍然是事实上的主流程
- 插件默认不会替代它
- `interceptHostCompactionByDefault` 应保持为 opt-in

### 4.4 v1 明确不使用的 Hook

当前设计不把更底层的 provider-request hooks 当作主策略层，因为：

- 它们比需求更底
- 跨宿主的可移植性更差
- 对 prompt 层推理来说不如 `context` 自然

## 5. 功能模块

### 5.1 配置模块

职责：

- 解析扩展配置
- 加载默认值
- 暴露运行时配置
- 定义阈值策略
- 支持运行时阈值覆写
- 定义 probe TTL

### 5.2 Probe Registry

职责：

- 注册内置 probes
- 注册自定义 probes
- 基于 TTL 缓存 probe 结果
- 返回标准化后的 `ResourceSnapshot`

当前基线内置 probes：

- context usage probe
- system memory probe，默认仅辅助参考
- script probes

未来兼容的 probe 类型：

- provider quota probe
- provider health probe
- 用户自定义远程 probe

### 5.3 Assessment Engine

职责：

- 将原始 probe 输出收敛为一个 `StateAssessment`
- 生成 `normal`、`tight`、`critical`、`unknown` 等等级
- 生成简洁原因和建议动作
- 保持评估结果客观、克制

### 5.4 Assessment Extender 管线

职责：

- 让下游策略模块在基础 assessment 之后再做二次加工
- 允许在受控边界内补充 prompt 字段
- 保持“数据采集”和“策略决策”分层

推荐分工：

- probes 负责采集数据
- assessment engine 负责基础判断
- extenders 负责策略微调和 prompt 字段补充

### 5.5 Prompt Renderer

职责：

- 渲染短小、确定性的 runtime-state block
- 控制 token 成本
- 避免大段诊断输出
- 在状态健康且未变化时可选抑制注入
- 合并基础 metrics、script probe prompt 字段和 extender prompt 字段

### 5.6 Compaction Profile Registry

职责：

- 定义内置 compaction profiles
- 解析 profile ID
- 分发到 delegate、instruction-driven 或 custom compaction 逻辑

### 5.7 Tool Surface

职责：

- 暴露 agent 可调用动作
- 保持 action schema 稳定
- 允许显式的运行时策略调整

当前基线动作：

- `get_state`
- `list_profiles`
- `compact`
- `set_thresholds`
- `new_session`

仅预留：

- `reset_session`

### 5.8 持久化与可观测性

职责：

- 存储最新稳定 assessment
- 存储 assessment 跃迁
- 存储最近一次使用的 compaction profile
- 避免把每次 probe 采样都写进 session history

## 6. 数据模型

### 6.1 核心类型

当前实现围绕这些主类型组织：

- `RegulationConfig`
  - 全局配置，如启用开关、阈值、TTL、宿主 compaction 接管策略和 prompt 行为
- `ProbeResult<T>`
  - 统一后的 probe 输出，包含时间戳、数据、可选 level、reasons 和 prompt 字段
- `ContextUsageSample`
  - 当前 context tokens、context window 和可选的使用百分比
- `SystemMemorySample`
  - 宿主内存总量与辅助百分比
- `ResourceSnapshot`
  - 一次评估周期的完整标准化输入快照
- `StateAssessment`
  - 合并后的状态等级、原因、建议动作、metrics 和推荐 profile
- `RegulationStateRecord`
  - 持久化后的 session 级状态记录
- `AssessmentExtenderContext`
  - 传给每个 assessment extender 的输入
- `AssessmentExtenderResult`
  - extender 返回的 assessment 覆写和 prompt 字段
- `CompactionProfileDefinition`
  - 一个 compaction profile，可能是 delegate、instructions 或 fully custom
- `SelfRegulationToolInput`
  - 结构化 tool 输入 schema

### 6.2 数据嵌套关系

运行时的数据嵌套顺序是：

1. probes 先产生 `ProbeResult<T>`
2. probe registry 把它们合成 `ResourceSnapshot`
3. assessment engine 把 snapshot 收敛成 `StateAssessment`
4. assessment extenders 可以对 assessment 做替换或补充
5. state store 把稳定结果持久化成 `RegulationStateRecord`
6. prompt renderer 把最终 assessment 和 prompt fields 变成注入块

### 6.3 重要数据规则

- `contextUsage.percent` 在 compaction 后可能是 `null`，不能当作绝对真值
- `systemMemory` 反映的是宿主本地状态，不是 provider 状态
- system memory 默认只是辅助信号，不能压过 context-window pressure
- `custom` 和 script probe 数据都必须是可选的，不能阻塞整个扩展
- script probe 的 promptData 必须保持小、结构化、标量化，并在注入前完成清洗
- 默认只持久化稳定变化和状态跃迁

## 7. 对象设计

### 7.1 `AgentStateSelfRegulationExtension`

职责：

- 串接 hooks
- 初始化 registries
- 注册 tools
- 保存当前配置
- 协调评估、prompt 注入、compaction 请求和 session-control 请求

### 7.2 `ProbeRegistry`

职责：

- 管理内置和自定义 probes
- 遵守 TTL
- 组装 `ResourceSnapshot`

### 7.3 `AssessmentEngine`

职责：

- 将原始信号映射到一个 regulation level
- 生成 reasons 和 suggested actions
- 保持 context-first 的合并规则稳定

### 7.4 `PromptRenderer`

职责：

- 渲染紧凑的注入块
- 保持格式确定
- 合并基础 metrics、script probe prompt 字段和 extender prompt 字段

### 7.5 `CompactionProfileRegistry`

职责：

- 存储内置 profiles
- 解析请求的 profile
- 协调 delegate 或 custom compaction

### 7.6 `RegulationStateStore`

职责：

- 读取和写入 `RegulationStateRecord`
- 抑制噪声写入
- 只持久化稳定变化

### 7.7 `SelfRegulationTool`

职责：

- 向模型暴露当前 assessment
- 在用户或系统策略允许时，让模型选择 compaction profile
- 让模型通过 `new_session` 请求宿主 fresh session

## 8. 内置评估策略

### 8.1 Context Usage 阈值

默认策略：

- `normal`：低于 70%
- `tight`：70% 到 85% 以下
- `critical`：85% 及以上
- `unknown`：百分比不可用

调整路径：

- 在扩展构造时通过 `config.contextThresholds`
- 在运行时通过 `self_regulate_context` 的 `set_thresholds`

### 8.2 System Memory 阈值

默认策略：

- `normal`：低于 75%
- `tight`：75% 到 90% 以下
- `critical`：90% 及以上

解释规则：

- system memory 只是辅助参考
- 它可以补充 warning 和 suggested actions
- 除非后续显式改策略，否则它不应成为主要 compaction 触发器

### 8.3 最终合并规则

当前基线规则是 context-first：

- context `tight` 加 memory `normal`，整体为 `tight`
- context `normal` 加 memory `critical`，整体仍是 `normal`，但附带 advisory warning
- context `unknown` 加 memory `critical`，整体为 `unknown`，并附带 advisory warning

保持保守的原因：

- compaction 后 context usage 往往暂时不可用
- 不同操作系统的 host memory 行为差异很大
- 这个插件应保持保守，而不是把 host memory 当成通用 compaction 真理

## 9. Script Probe 模型

Script probe 是受限的外部数据接入路径。

当前基线规则：

- 脚本必须返回 JSON
- 只有经过清洗的标量 prompt 字段可以进入 prompt 注入
- prompt 字段名会被标准化
- 文本值会被截断
- 输出大小有限制
- 执行时间有限制
- 脚本失败不能导致整个扩展失败

这让用户自定义脚本可以安全地给 prompt 增加结构化上下文，而不会把任意原始命令输出直接灌进模型输入。

## 10. 内置 Compaction Profiles

### 10.1 `host-default`

- mode：`delegate`
- 行为：直接调用宿主 compaction，不覆写策略

### 10.2 `light`

- mode：`instructions`
- 目标：保留当前任务和活跃约束，只压缩外围历史

### 10.3 `standard`

- mode：`instructions`
- 目标：把先前讨论压缩成一个保留任务语义的简洁 checkpoint

### 10.4 `aggressive`

- mode：`instructions`
- 目标：尽可能激进地压缩上下文，但保留最关键的任务状态

### 10.5 重要 Compaction 规则

- `light`、`standard`、`aggressive` 当前只是叠加在宿主 `compact()` 之上的指令预设
- 这个包目前还没有提供独立于宿主 compaction 引擎的新内置压缩算法
- `interceptHostCompactionByDefault` 默认应保持为 `false`
- 通过 tool 的主动 compaction 是支持的，但必须是显式选择

## 11. Agent 可调用接口

工具名：

- `self_regulate_context`

当前动作：

- `get_state`
- `list_profiles`
- `compact`
- `set_thresholds`
- `new_session`

当前行为摘要：

- `get_state` 返回最新 assessment、推荐动作、当前阈值和 custom probe states
- `list_profiles` 返回内置和自定义 profiles
- `compact` 执行选定 profile，默认 `host-default`
- `set_thresholds` 会在校验后更新当前 session 的 context 和 advisory memory 阈值并持久化
- `new_session` 请求宿主内置 `/new` 行为，开始新的 session

预留但不暴露：

- `reset_session`

`reset_session` 目前只是一个预留定义。由于宿主现在还没有提供与 `/new` 不同的独立原地 reset API，所以它不会被挂载到当前 tool surface 上。

## 12. 持久化规则

当前基线的持久化策略刻意保持克制：

- 不持久化每一次 probe sample
- 不在每一次健康调用时都追加新的状态消息
- 只持久化有意义的状态跃迁和调节侧效果

预期写入的 entry 类别：

- `agent_state_regulation/config`
- `agent_state_regulation/state`
- `agent_state_regulation/transition`
- `agent_state_regulation/compaction`

## 13. 剩余工作

这个插件在 monorepo 内已经可用，但要作为对外发布的高质量包，还需要最后一轮 hardening。

P0 发布阻塞项：

- 在 release 前跑通包级 build、pack、install 的 smoke 验证
- 从干净环境验证发布包形态，而不只是 monorepo 内联调
- 持续保持独立包文档和实现同步

P1 近期增强项：

- 给 script probes 和 extender prompt 字段增加更丰富的 schema hooks
- 增加更清晰的 custom probes、script probes、extenders 和 custom compaction profiles 示例
- 增加独立包 release checklist

P2 后续增强项：

- 真正的宿主级 `reset_session`
- 新的内置压缩算法
- 可选 slash commands
- 可选 custom message renderers
- 可选的 TUI 状态跃迁摘要

## 14. 任务清单

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| 把真源迁到独立包 | 已完成 | `packages/agent-state-self-regulation` 已是唯一插件源码 |
| 移除 `coding-agent` 中的重复实现 | 已完成 | 旧源码树已经退出 |
| 增加通用 assessment extender 层 | 已完成 | Extender 已可改写 assessment 并补充 prompt 字段 |
| 保持 script probe 安全边界 | 已完成 | 已具备超时、输出大小、JSON 解析和 prompt 字段清洗 |
| 增加独立包专项测试 | 已完成 | 已覆盖 hook 注册、tool、script probe 和自定义 compaction 路由 |
| 增加独立 `reset_session` 宿主支持 | 待完成 | 仅保留预留定义，尚未实现 |
| 增加新压缩算法 | 待完成 | 当前 profiles 仍走宿主 `compact()` |
| 补齐外部分发的 release smoke | 待完成 | 还需干净环境下的 pack/install 验证 |
