# pi-agent-core 自治基础设施设计

## 1. 文档目的

本文定义未来值得沉淀到 `pi-agent-core` 的数据结构和最小设计边界。

它服务于三个上层系统：

- 默认提示词系统插件
- Heartbeat 自主循环插件
- 未来 A2A 插件

但原则是：

> 只把“客观、通用、无强策略偏好”的能力沉淀到 core。

---

## 2. 为什么要单独写这份文档

`coding-agent` extension 层已经足够做第一阶段 PoC，但随着提示词系统、Heartbeat、自主消息体系稳定下来，会反复遇到以下问题：

- 上层不得不自己推导 runtime facts
- 不同插件重复推导相同状态
- 状态推导口径不统一
- 上层很难判断哪些能力是稳定可依赖的

因此需要在 `pi-agent-core` 层给出一个清晰的沉淀边界。

---

## 3. 总体原则

## 3.1 不把策略写进 core

不建议直接进入 core 的内容：

- fatigue
- attention
- heartbeat scheduling policy
- A2A 业务协议
- 记忆检索策略
- 工作目标生成策略

这些都属于解释层或策略层。

## 3.2 只沉淀客观 telemetry

建议沉淀的是：

- 当前是否 streaming
- 当前待处理工具调用数
- 最近 turn 的开始和结束时间
- 最近 stop reason
- 连续错误计数
- 上下文 token 估算和窗口大小

## 3.3 向后兼容优先

任何新增设计都应：

- 不破坏现有 `Agent` 用法
- 不强制上层实现 scheduler
- 不引入新的必填消息角色

---

## 4. 建议沉淀的数据结构

## 4.1 `AgentTelemetry`

推荐新增：

```typescript
export interface AgentTelemetry {
    contextTokens?: number | null;
    contextWindow?: number | null;
    pendingToolCallCount: number;
    consecutiveErrors: number;
    lastStopReason?: "stop" | "length" | "toolUse" | "error" | "aborted";
    lastTurnStartedAt?: number;
    lastTurnEndedAt?: number;
}
```

设计理由：

- 这些值可被多个插件共享
- 都是客观 runtime facts
- 不携带产品偏好

注意：

- `contextTokens` 必须允许 `null`
- `contextWindow` 允许缺失
- 不建议把百分比作为真值字段固化到 core

## 4.2 `AgentState.telemetry`

推荐在 `AgentState` 中加入：

```typescript
telemetry: AgentTelemetry;
```

而不是直接引入 `EntityState` 这类偏解释性的结构。

## 4.3 `AgentStateChangeEvent`

推荐新增事件：

```typescript
type AgentEvent =
    | ...
    | {
        type: "state_change";
        state: AgentState;
        changed: Array<string>;
      };
```

目的：

- 避免上层只能从消息事件间接推导状态
- 让 extension 或宿主能够监听事实状态变化

---

## 5. 建议沉淀的辅助抽象

## 5.1 `RequestMetadata`

提示词系统、Heartbeat 和未来 A2A 都可能需要在 turn 级请求上附加来源信息。

因此建议 future-proof 一个最小抽象：

```typescript
export interface RequestMetadata {
    source?: "user" | "extension" | "heartbeat" | "a2a";
    labels?: string[];
    attributes?: Record<string, unknown>;
}
```

注意：

- 这不是新的消息 role
- 它只描述请求来源和附加属性
- 最终如何传给 provider，可由上层映射到 `pi-ai` 的 `metadata`

## 5.2 `ContextEstimate`

如果未来要把上下文估算能力进一步下沉，建议不要直接把 compaction 逻辑耦合进 core。

更合适的做法是给一个中性结构：

```typescript
export interface ContextEstimate {
    tokens: number | null;
    contextWindow: number | null;
    source: "provider_usage" | "heuristic" | "unknown";
}
```

这样：

- `coding-agent` 可继续使用更复杂的 session-aware 估算
- 其他宿主也能提供自己的估算实现

---

## 6. 明确不建议沉淀的内容

## 6.1 不建议新增 `agent-peer` role

原因：

- provider 边界仍要折叠到现有角色
- 改造面过大
- extension 已可用 custom message 表达

## 6.2 不建议内置 timer / heartbeat scheduler

原因：

- 生命周期管理复杂
- interactive、print、rpc 模式需求不一致
- 当前项目哲学是 extension-first

## 6.3 不建议内置工作目标规划器

原因：

- 工作目标属于高策略偏好能力
- 不同产品对目标抽取方式差异极大

---

## 7. 与上层三个插件的映射关系

## 7.1 对默认提示词系统插件

core 只需要提供：

- telemetry
- 可选 request metadata

不需要知道：

- Soul 是什么
- 工作目标怎么提取
- 长短期记忆如何融合

## 7.2 对 Heartbeat 插件

Heartbeat 最直接受益于：

- `pendingToolCallCount`
- `consecutiveErrors`
- `lastStopReason`
- `contextTokens`
- `contextWindow`

这正是最适合进入 core 的部分。

## 7.3 对 A2A 插件

A2A 对 core 的要求最小。

它更多依赖：

- custom message 扩展能力
- request metadata 透传能力

而不需要 core 理解协议本身。

---

## 8. 建议实施顺序

## Phase 0: extension PoC 先行

在 `coding-agent` extension 层先验证：

- 默认提示词系统插件
- Heartbeat 插件
- A2A 设计边界

## Phase 1: core 引入 telemetry

只做：

- `AgentTelemetry`
- `AgentState.telemetry`
- `state_change`

## Phase 2: 评估 request metadata

当上层多个插件都需要显式标记来源时，再沉淀：

- `RequestMetadata`
- 与 `pi-ai` request metadata 的映射路径

## Phase 3: 评估是否需要更通用的上下文估算抽象

如果多个宿主都需要复用 context estimation，再考虑下沉 `ContextEstimate`。

---

## 9. 风险说明

### 9.1 最大风险：把 `coding-agent` 的策略性经验误写成 `agent-core` 的普遍真理

例如：

- 直接把 fatigue 写入 core
- 直接把工作目标写入 core
- 直接把 heartbeat timer 写入 core

这样会导致 `pi-agent-core` 失去通用性。

### 9.2 第二风险：让 telemetry 看起来比实际更精确

上下文估算并不总是稳定、强一致、即时可得。

因此 core 必须显式表达：

- unknown
- null
- heuristic

而不能假装任何时候都拿得到精确值。

---

## 10. 最终建议

`pi-agent-core` 在自治方向上的正确演进方式不是“直接变成 autonomous framework”，而是先变成一个更好的 runtime substrate。

也就是说，core 要做的是：

- 提供更好的事实状态
- 提供更好的状态事件
- 提供更好的元数据承载

而不是：

- 直接提供自治策略
- 直接定义 agent 人格
- 直接内置调度系统

一句话总结：

> `pi-agent-core` 应沉淀的是“自治所需的客观基础设施”，而不是“自治本身”。

