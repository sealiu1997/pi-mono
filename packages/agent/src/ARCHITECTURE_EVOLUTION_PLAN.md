# pi-agent-core 架构演进与自主性重构方案 (Draft)

## 1. 演进愿景与核心痛点

当前的 `pi-agent-core` 是一个极其优秀的**“交互式 Copilot 引擎”**，其 `agent-loop` 提供了细粒度的流式渲染、并发工具调度以及被动式的人机打断（Steering）机制。

然而，在面对真正的 **Agent-to-Agent (A2A) 复杂协同** 和 **长时间无人值守的自主运行 (Autonomous Agent)** 需求时，暴露出了以下架构瓶颈：
1. **渠道单一化**：底层必须将各种消息降维折叠为 `user/assistant/toolResult`。模型难以区分“人类指令”与“其他 Agent 的同侪建议”。
2. **缺乏自主循环**：代理的运行严重依赖外部 Prompt 驱动（无输入即停机），没有内在的“心跳（Heartbeat）”或“目标驱动循环”。
3. **缺乏生理/心理状态反馈**：核心运行环境仅仅追踪上下文和执行中工具，对代理自身的资源消耗（如 Context Window 余量）、角色连贯性衰减等缺乏感知，进而无法由代理在框架内进行主动干预。

本改造方案旨在**不破坏现有核心运行流（向下兼容）**的前提下，为 agent 植入“状态基座”、“记忆与灵魂隔离”以及“基于心跳的小脑调度系统”。

---

## 2. 核心改造模块

### 2.1 引入内生的实体状态 (Stateful Entity)
我们需要将 Agent 从“无状态的函数求值器”升级为“拥有稳态指标的数字实体”。

**改造切入点：`packages/agent/src/types.ts`**
在底层的 `AgentState` 中引入 `EntityState` 定义：

```typescript
// 新增实体状态定义
export interface EntityState {
    energyLevel: "high" | "normal" | "fatigued" | "exhausted"; // 反映 Token 消耗/执行轮次
    attentionStatus: "focused" | "distracted"; // 反映上下文混乱度/失败重试率
    metrics: {
        contextWindowUsage: number; // 0.0 - 1.0
        consecutiveErrors: number;
    };
    customState?: Record<string, unknown>; // 业务侧扩展挂载点
}

export interface AgentState {
    // ... 现有字段
    entityState: EntityState; // 新增核心一等公民字段
}
```

**影响面**：纯增量字段，不影响旧的 Copilot 业务逻辑。它可以通过 `agent.subscribe` 将状态变化广播给外层的“小脑”进行监听与决策。

---

### 2.2 强化 A2A 的身份通道隔离 (Channels Abstracting)
大模型在 `convertToLlm` 阶段虽不得不将消息折叠为大模型 API 支持的 `user` 或 `tool`，但我们可以在上层规范一套“**注入元数据 (Metadata Injection)**”机制，保证 LLM 能准确分辨消息来源。

**改造切入点：约束 `System Prompt` 与 `transformContext` 阶段**
在进入 LLM 之前，利用 `transformContext` 钩子，统一自动包装上下文元数据：

```xml
<!-- 注入的格式标准范例 -->
<context_snapshot>
    <physical_state>状态：疲劳 (Token使用率 85%)</physical_state>
    <memory_reference>近期规范：#314 (需严谨执行合并)</memory_reference>
</context_snapshot>

<incoming_message source="Agent_Reviewer" session="A2A-101">
    这是另一个 Agent 传来的审查意见...
</incoming_message>
```
通过规范化这种前缀注入，彻底实现与常规“用户系统指令”的逻辑物理隔离。

---

### 2.3 记忆与灵魂的分离底座 (Soul & Memory Controllers)
大模型记忆不应随简单的 `agent.messages.push()` 无限膨胀。
*   **Soul (灵魂)**：固化的 `System Prompt`（我是一个前端专家，我的终极目标是保证组件复用性），永不修剪。
*   **Memory (工作记忆)**：需在上层封装一套外挂系统，允许监听核心暴露出的 `agent.state.entityState.metrics.contextWindowUsage`。当感知到上下文逼近阈值（如 >80%）时：
    1. 小脑系统介入拦截。
    2. 触发专门的 Summarization/RAG 工作流。
    3. 利用 `agent.replaceMessages()` 大幅截断旧数组，替换为被浓缩后的 Memory Snapshot 摘要消息。

---

### 2.4 基于小脑调度系统的主动心跳循环 (Heartbeat Driven Cerebellum)
这是最为关键的**自治引擎升级**。打破“必须由 User 说话才触发”的死板束缚，为 `agentLoop` 的最底层增加基于心跳的流转机制。

**改造切入点：`packages/agent/src/agent.ts` 或 `types.ts -> AgentLoopConfig`**
在循环的边界处埋设监听/请求钩子：

```typescript
// 设想中的 AgentLoopConfig 增强
export interface AgentLoopConfig {
    // ... 现有配置
    /** 
     * 心跳询问钩子 (小脑介入点)
     * 在当前 Agent 行动（Turn）静默后被内核调用，询问是否需要内部唤醒
     */
    onHeartbeatCheck?: (state: AgentState) => Promise<HeartbeatDecision>;
}

export type HeartbeatDecision = 
    | { type: "sleep", nextCheckMs: number } // 继续待机
    | { type: "wake", internalPrompt: string } // 被内部目标唤醒，自动给自己发一条隐式 prompting
    | { type: "maintenance", toolsToCall: string[] }; // 进入维护模式（如：强制压缩记忆）
```

当 `agent-loop` 发现本轮没有工具调用也没有外来消息时，它不再直接 `break` 结束 `agent_end`，而是通过 `onHeartbeatCheck` 询问挂载的“小脑系统”。
若小脑基于 `EntityState`（例如发现存在未完成的长期目标，且精力充沛）决定返回 `wake`，引擎将把 `internalPrompt` 作为一轮新的事件驱动，自我推进。

---

## 3. 下一步行动计划

1. **评审阶段（当前）**：审视本方案的核心切入点，确认它们对原有框架 `agent_end` 等事件流的影响是否安全可控。
2. **PoC 验证（Phase 1）**：在 `types.ts` 和 `agent.ts` 中完成 `EntityState` 的强类型植入与状态初始化。暴露给外层验证可修改性。
3. **小脑机制接入（Phase 2）**：尝试在 `agent-loop.ts` 的 `runLoop` 末尾增加退出条件的拦截器（Heartbeat 概念设计落地）。
4. **内存池联调（Phase 3）**：实现通过 `transformContext` 自动注入格式化状态快照与外接 Memory 钩子。
