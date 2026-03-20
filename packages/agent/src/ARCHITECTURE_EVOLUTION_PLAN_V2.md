# pi-agent-core 架构演进与自主性扩展方案 V2

## 1. 文档目的

本文是对 `ARCHITECTURE_EVOLUTION_PLAN.md` 的第二版重构，目标不是推翻原始方向，而是结合当前代码现实，对以下问题做更精确的分层：

- 哪些能力已经存在，只是还没有被正式抽象出来
- 哪些能力适合先在 `coding-agent` extension 层做 PoC
- 哪些能力在 PoC 验证后，才值得沉淀到 `pi-agent-core`
- 哪些能力不应该进入 core，而应该保持为外部策略

本文的核心判断是：

1. `pi-agent-core` 目前确实缺少一套正式的状态遥测和自主性抽象。
2. 但 `coding-agent` 已经提供了比原始草案预期更强的 extension 接缝。
3. 因此，正确的演进顺序应是：
   `extension PoC -> 抽象稳定 -> core 下沉`
   而不是一开始就把较重的自治语义写入 `AgentState`。

---

## 2. 基于现状代码的校准结论

### 2.1 `pi-ai` 的职责边界

`packages/ai` 的核心职责是：

- 统一 provider 和 model 抽象
- 统一流式事件协议
- 处理跨 provider 的消息兼容和 replay 问题
- 在请求边界上传递 `sessionId`、`metadata`、`onPayload` 等请求级选项

它不是 session runtime，也不是 agent orchestration 层。因此：

- A2A 身份建模不应优先压进 `pi-ai`
- 心跳、自主循环、记忆策略也不应从 `pi-ai` 起步
- `pi-ai` 更适合作为“请求协议底座”

### 2.2 `pi-agent-core` 的真实定位

`packages/agent` 当前并不是单纯的“prompt -> response”薄封装。它已经具备：

- `AgentMessage` 的可扩展消息类型机制
- `transformContext` 和 `convertToLlm` 两段式上下文处理
- steering / follow-up 两类队列
- `beforeToolCall` / `afterToolCall` 钩子
- 细粒度事件流

但它仍然缺少以下正式抽象：

- 一等公民的 runtime telemetry
- 可选的结论层 runtime state slot
- 状态变化事件
- turn 级别的结构化 metadata
- 通用的自主调度契约

因此，`pi-agent-core` 更准确的定位是：

> 一个可扩展的 agent execution runtime，而不是完整的 autonomous agent platform。

### 2.3 `coding-agent` 比原草案假设的更强

`packages/coding-agent` 已经具备非常关键的外围能力：

- 通过 `transformContext` 接入 extension `context` 钩子
- 通过 `onPayload` 接入 `before_provider_request`
- 通过 `before_agent_start` 改写 turn 级 system prompt 和注入隐式消息
- 通过 `pi.sendMessage` / `pi.sendUserMessage` 主动触发或排队消息
- 通过 `pi.appendEntry` 持久化结构化状态
- 通过 `getContextUsage()` 获取上下文占用估算
- 通过 `session_before_compact` / `session_compact` 自定义 compaction
- 通过 `CustomEntry` / `CustomMessageEntry` 区分“持久状态”和“进入 LLM 上下文的消息”
- 通过 `flagValues` 和 `api.events` 做扩展间协同

这意味着：

- A2A envelope 可以先在 extension 层建立
- heartbeat 可以先在 extension 层建立
- 记忆管理可以先在 extension 层建立
- 原始草案中的很多目标，并不需要先修改 `agent-loop`

---

## 3. V2 设计原则

### 3.1 先策略外置，再能力下沉

任何带有产品偏好的策略能力，都优先放在 extension 层验证，例如：

- 心跳频率
- 自主唤醒条件
- A2A 消息格式
- 记忆检索策略
- 是否允许后台推进

只有被多个上层复用、且不带强策略偏好的能力，才进入 `pi-agent-core`。

### 3.2 core 优先承载客观事实，可选承载最小结论槽位

原草案中的以下字段语义过重：

- `energyLevel`
- `attentionStatus`

这些更像“策略层对状态的解释结果”，而不是 core 应维护的事实。

core 更适合暴露客观指标，例如：

- context token estimate
- context window size
- pending tool calls（继续复用现有 `pendingToolCalls`）
- last assistant stop reason
- consecutive error count
- last successful turn timestamp

策略层可以再把这些映射为：

- fatigued
- distracted
- needs compaction
- eligible for heartbeat

如果多个上层在 PoC 后都需要共享“结论层状态”，可以再补一个最小 `runtimeState` slot，但它只提供极薄的基线：

- `health: "operational" | "degraded" | "fault"`
- `details?: Record<string, unknown>`

也就是说：

- telemetry = 原始事实
- runtimeState = extension / host 写入的综合判断
- fatigue / stamina / attention 仍然不应该变成 core 的硬编码枚举

### 3.3 把 A2A 问题拆成两个层次

A2A 不是一个单点能力，而是两个问题：

1. 运行时如何传递“另一位 agent 的消息”
2. LLM 边界如何让模型理解“这不是普通用户消息”

第一个问题可以用自定义消息和 session persistence 解决。
第二个问题可以用 serializer / context injection 解决。

因此不需要一开始就追求“底层新增 agent-peer role”。

### 3.4 把“记忆”拆成三层

- `Soul`: 稳定身份和长期行为边界，主要是 system prompt
- `Working Memory`: 当前任务相关的上下文快照、检查点、A2A 摘要
- `Long-term Memory`: 不直接进入当前上下文的持久知识、索引、检索结果

这三层不应混在一个 `messages.push()` 通道里。

---

## 4. 推荐的分层演进方案

## 4.1 Layer A: `pi-ai` 保持请求协议底座

`pi-ai` 继续负责：

- provider abstraction
- message compatibility
- request metadata
- session affinity

建议只做轻量增强，不引入自治语义：

- 保持 `metadata?: Record<string, unknown>`
- 在 provider 侧继续按需提取 metadata
- 不新增 A2A 或 heartbeat 专属概念

理由：

- 这些能力高度依赖产品运行时
- 一旦写进 `pi-ai`，会把通用请求库变成特定 agent 平台

## 4.2 Layer B: `pi-agent-core` 增加“客观遥测”而不是“主观实体人格”

V2 推荐在 `pi-agent-core` 中新增的不是 `EntityState`，而是更中性的 `AgentTelemetry`。

建议形态：

```typescript
export interface AgentTelemetry {
    contextTokens?: number | null;
    contextWindow?: number | null;
    consecutiveErrors: number;
    lastStopReason?: "stop" | "length" | "toolUse" | "error" | "aborted";
    lastTurnStartedAt?: number;
    lastTurnEndedAt?: number;
}

export interface AgentRuntimeState {
    health: "operational" | "degraded" | "fault";
    details?: Record<string, unknown>;
}

export interface AgentState {
    systemPrompt: string;
    model: Model<any>;
    thinkingLevel: ThinkingLevel;
    tools: AgentTool<any>[];
    messages: AgentMessage[];
    isStreaming: boolean;
    streamMessage: AgentMessage | null;
    pendingToolCalls: Set<string>; // existing source of truth
    telemetry: AgentTelemetry;
    runtimeState?: AgentRuntimeState;
    error?: string;
}
```

同时建议新增一个独立事件，而不是强迫上层从消息事件推导：

```typescript
type AgentEvent =
    | ...
    | { type: "state_change"; state: AgentState; changed: string[] };
```

注意：

- `contextTokens` 必须允许 `null` 或 `undefined`
- `contextWindowUsage` 不应直接作为 core 真值字段
- 百分比是策略层可派生值，不一定是底层状态
- `pendingToolCalls.size` 继续作为 pending count 的事实来源
- `runtimeState` 若存在，也应视为 extension / host 的结论层写入，不是 core 内置策略

## 4.3 Layer C: 在 `coding-agent` 中标准化上下文注入和持久状态

`coding-agent` 已经具备非常适合做“策略层中枢”的基础设施。

V2 建议正式区分两种 extension 数据：

### 1. 持久但不进上下文

使用 `CustomEntry`

适合：

- 心跳调度状态
- A2A session registry
- 记忆索引版本号
- 自治策略配置

### 2. 持久且进入上下文

使用 `CustomMessageEntry`

适合：

- agent 对 agent 摘要消息
- 当前轮需要注入的 memory snapshot
- 后台调度器生成的隐式上下文提示

这一层的关键工作不是“再造消息系统”，而是补一套推荐规范：

- customType 命名规范
- display / hidden 的使用规范
- serializer 规范
- compaction 兼容规范
- `pi.appendEntry` 与 `pi.sendMessage` 的职责边界

MVP 补充约束：

- `working_goal` 的刷新优先 piggyback 在正常 turn 上完成
- 不单独为“目标提炼”引入一条专用 LLM 请求
- 长期记忆 MVP 优先复用已有 context files / skills / 持久化 custom entries

## 4.4 Layer D: 新增自治扩展层，而不是立刻修改 core loop

推荐把 heartbeat、自主调度、A2A orchestration 做成独立 extension 或 package，例如：

- `@mariozechner/pi-autonomy`
- 或项目内 PoC extension

这一层负责：

- 定时器或事件驱动的唤醒
- idle 检查
- pending queue 检查
- 预算检查
- 低频运行时探针（如模型连通性、系统资源）并产出结论层状态
- 生成隐式驱动消息
- 决定什么时候读取外部记忆

这层不应默认内置进 `coding-agent`，因为当前项目哲学就是：

- no built-in sub-agents
- no built-in plan mode
- complex workflows via extensions

这与自主运行完全一致。

---

## 5. A2A 方案重写建议

## 5.1 不建议优先引入新的底层 role

原草案的核心关切是对的：模型需要知道“这条消息来自另一位 agent，而不是用户”。

但 V2 不建议立刻把这个问题实现成新的底层消息角色，原因有三点：

1. LLM provider 侧最终仍会折叠为已有角色
2. 新 role 会扩大 `convertToLlm`、compaction、session serialization 的改造面
3. 目前 extension 层已经足够表达这类语义

## 5.2 推荐做法：A2A Envelope + Serializer

建议引入标准化的 A2A custom message 结构：

```typescript
interface A2AMessageDetails {
    sourceAgentId: string;
    sourceSessionId?: string;
    messageType: "proposal" | "review" | "handoff" | "status";
    priority?: "low" | "normal" | "high";
    createdAt: number;
}
```

运行时消息形态：

```typescript
{
    role: "custom",
    customType: "a2a",
    content: "...",
    display: true,
    details: { ... }
}
```

进入 LLM 之前，由 extension `context` 钩子统一序列化为稳定格式，例如：

```xml
<a2a_message source_agent="reviewer" type="review" priority="high">
...
</a2a_message>
```

这比直接引入新 role 更稳，因为：

- session 层已有持久化能力
- TUI 已支持 custom message 渲染
- compaction 也已覆盖 custom message 路径

## 5.3 A2A 的最小可行能力

建议第一阶段只做：

- 单向 message handoff
- review / proposal / status 三种类型
- 可持久化
- 可被 compaction 摘要
- 可通过 context serializer 注入

先不做：

- 多 agent 共识协议
- broker
- 分布式 mailbox
- 强一致的 agent identity network

---

## 6. “Soul 与 Memory 分离” 的 V2 版本

## 6.1 Soul 继续依附 system prompt，但要显式区分来源

当前 `coding-agent` 的 system prompt 已经由多个来源组合而成：

- base prompt
- context files
- skills
- append system prompt
- `before_agent_start` 动态改写

V2 建议在概念上明确分为：

- `Core Identity`: 稳定人格和行为边界
- `Project Constraints`: 项目规范和仓库规则
- `Turn-time Augmentation`: 当前轮临时注入的策略提示

这三者都可以留在现有系统 prompt 构建路径上，不需要额外开新通道。

## 6.2 Working Memory 应优先利用 CustomMessageEntry

Working Memory 适合表达为：

- 最近压缩得到的上下文检查点
- 当前自治任务的局部目标
- A2A 摘要
- 外部检索返回的短期记忆摘录

推荐做法：

- 以 `custom_message` 形式持久化
- 通过 `context` hook 控制是否注入本轮
- 避免把所有记忆永久塞入 `agent.state.messages`

## 6.3 Long-term Memory 不建议直接进入 core

长期记忆更适合留在 extension / external storage：

- sqlite
- jsonl sidecar
- vector db
- graph store

core 只需要允许外部策略在合适时机把检索结果注入为 custom message。

MVP 落地建议：

- 先复用现有 context files、skills、session custom entries
- 等 Prompt System / Heartbeat 的基本路径稳定后，再接外部记忆存储

---

## 7. Heartbeat 自主循环的 V2 方案

## 7.1 核心判断

heartbeat 是策略，不是底层循环原语。

第一阶段不建议修改 `agent-loop`。
第一阶段建议使用 extension 中的后台调度器。

## 7.2 推荐调度条件

只有满足以下条件时，heartbeat 才允许触发新 turn：

- agent 当前 idle
- 没有 pending steering / follow-up
- 没有正在进行的 compaction / retry / bash
- 当前 context budget 没有接近危险阈值
- 距离上一次 heartbeat 已超过 cooldown
- 当前 session 明确标记为 autonomous-enabled

次级信号可以参考 `runtimeState` 或外部探针结果，但必须满足两个前提：

- 这些探针不是每个 tick 都执行
- 它们只能作为 context budget 之后的保守附加条件

## 7.3 推荐触发方式

推荐优先使用：

- `pi.sendMessage(..., { triggerTurn: true })` 发送隐式 custom message
- 或 `pi.sendUserMessage()` 发送内部 user message

但应优先约定内部专用 custom message，例如：

```typescript
customType: "heartbeat"
display: false
```

这样更容易区分：

- 普通用户输入
- 其他 agent 消息
- 系统内部驱动消息

## 7.4 不建议第一阶段做的事情

- 在 `agent-loop` 中新增定时轮询
- 在 `Agent` 内部直接持有 timer
- 让 core 默认具备“无人值守自动跑”行为

理由：

- 这会把生命周期管理、资源清理、模式差异全部压进 core
- interactive / print / rpc 三种模式对后台调度的要求并不一致

---

## 8. V2 建议新增的通用能力

以下能力在 PoC 后值得沉淀：

### 8.1 `pi-agent-core`

- `telemetry` 字段
- 可选 `runtimeState` slot
- `state_change` 事件
- 可选的 `turnMetadata` 或 `requestMetadata` 注入点
- 更清晰的 custom message serializer contracts

### 8.2 `coding-agent`

- 官方推荐的 customType 约定
- 官方推荐的 hidden system message 约定
- 更清晰的 extension state persistence guide
- 更清晰的 extension 编排约定（`flagValues` / `api.events`）
- 可选的 autonomy extension example

### 8.3 不建议沉淀到 core 的内容

- fatigue / attention 这类解释性状态
- 心跳周期和调度策略
- A2A 协议细节
- memory retrieval policy
- background autonomy 默认启用行为

---

## 9. 分阶段实施计划

## Phase 0: 先做 extension PoC

目标：证明不改 core 也能实现目标的 70% 能力。

工作项：

1. 编写 PoC extension，注入 `context` hook
2. 定义 `a2a` / `heartbeat` / `memory_snapshot` 三种 customType
3. 在 extension 层定义 `runtime_state` / `working_goal_state` 等结构化状态
4. 使用 `pi.appendEntry` 持久化 autonomy state
5. 使用 `CustomMessageEntry` 注入 memory 和 A2A 消息
6. 基于 `isIdle()`、`hasPendingMessages()`、`getContextUsage()` 做安全 heartbeat
7. 通过正常 turn piggyback 工作目标刷新，而不是额外起一条专用 LLM 请求
8. 通过 `session_before_compact` 验证记忆与 compaction 的协同
9. 用 `flagValues` / `api.events` 验证 Prompt System 与 Heartbeat 的编排

交付标准：

- 不改 `pi-agent-core`
- 不改 `agent-loop`
- 可以稳定触发隐藏消息驱动的新 turn
- 可以区分 A2A 与 user message

## Phase 1: 下沉客观 telemetry 到 `pi-agent-core`

目标：把 extension 反复需要推导的底层事实变成正式状态。

工作项：

1. 新增 `AgentTelemetry`
2. 在 turn lifecycle 中更新 telemetry
3. 暴露 `state_change` 事件
4. 评估是否需要同步补充最小 `runtimeState` slot
5. 保持完全向后兼容

交付标准：

- 上层不需要再手工拼装基础 runtime facts
- 不引入产品偏好的自治语义

## Phase 2: 标准化 A2A message convention

目标：让多个上层实现可以共享同一套约定。

工作项：

1. 文档化 `customType: "a2a"` 协议
2. 提供 serializer helper
3. 提供 compaction-friendly summarization guidance
4. 提供可选的 renderer example

交付标准：

- A2A 能力成为官方推荐实践
- 仍不要求 core 新增 peer role

## Phase 3: 评估是否需要 core 级 scheduler hook

只有在以下情况下，才考虑进入 core：

- 多个上层都需要统一的 heartbeat contract
- extension 实现因为生命周期问题过于脆弱
- mode 差异已经被抽象清楚

即便进入 core，也建议只提供最小接口，例如：

- `requestTurn(reason, payload)`
- `runtimeCapabilities`
- `schedulerAdapter`

而不是直接内置后台轮询器。

---

## 10. 风险与约束

### 10.1 最大风险：过早把策略写死进 core

如果现在就把以下内容写进 `AgentState`：

- fatigue
- attention
- heartbeat
- A2A role

那么未来很容易出现：

- core 语义膨胀
- provider 层和 runtime 层边界混乱
- 不同产品形态难以复用

### 10.2 第二风险：让 hidden message 成为不可控黑箱

如果大量自治逻辑都通过隐式消息注入，但缺少规范，就会出现：

- session 难调试
- compaction 难归纳
- 用户难理解为什么 agent 自己在推进

因此必须同步规定：

- hidden message 命名
- 持久化规则
- 是否显示
- 是否进导出
- compaction 时如何总结

### 10.3 第三风险：把 context usage 当作精确真值

当前系统中，compaction 后 context usage 可能暂时未知。
因此任何基于 budget 的自治决策，都必须接受：

- `tokens` 可能为 `null`
- `percent` 可能为 `null`

调度器不能把它当作永远可用的强一致指标。

### 10.4 第四风险：高频探针和 heartbeat 噪声反过来压垮 session

如果把模型连通性检查、系统资源检查、heartbeat notice 记录全部做成高频动作，就会出现：

- 不必要的 I/O 或网络探测开销
- session 文件膨胀
- 隐式消息和 notice 过多，削弱可调试性

因此应同时约束：

- 外部探针分频执行
- heartbeat 每 tick 最多一个动作
- 历史 heartbeat entries 在 compaction 时清理或归纳

---

## 11. V2 的最终建议

V2 推荐的总路线如下：

1. 不先改 `agent-loop`
2. 不先把主观“实体状态”写进 `AgentState`
3. 先在 `coding-agent` extension 层完成 A2A、heartbeat、memory PoC
4. 再把验证过的客观 telemetry 下沉到 `pi-agent-core`
5. 最后才评估是否需要更正式的 scheduler hook
6. 用户提出的“运行时状态 / 记忆注入 / 对话抽象”三条路线，分别由 `telemetry + runtimeState`、Prompt System、A2A custom message 渐进承接

一句话总结：

> 原方案的方向是正确的，但 V2 更强调“把自治能力视为上层策略，把遥测能力视为底层事实”，并遵循 `extension-first, core-second` 的演进顺序。
