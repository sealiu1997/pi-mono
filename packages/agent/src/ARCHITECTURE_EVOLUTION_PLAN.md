# pi-agent-core 架构演进与自主性重构方案 (Draft)

## 1. 演进愿景与核心痛点

当前的 `pi-agent-core` 是一个极其优秀的**“交互式 Copilot 引擎”**，其 `agent-loop` 提供了细粒度的流式渲染、并发工具调度以及被动式的人机打断（Steering）机制。同时，它的上层应用形态 `coding-agent` (Terminal / RPC) 通过 `AgentSession` 和 `ExtensionRunner` 提供了强大的外围工程支持（如会话持久化、树状历史分支管理以及基于强制摘要的 Auto-Compaction）。

然而，在面对真正的 **Agent-to-Agent (A2A) 复杂协同** 和 **长时间无人值守的自主运行 (Autonomous Agent)** 需求时，暴露出了以下架构瓶颈：
1. **渠道单一化**：底层必须将各种消息降维折叠为 `user/assistant/toolResult`。模型难以区分“人类指令”与“其他 Agent 的同侪建议”。在查阅 `coding-agent` 源码后，确认目前没有任何原生 A2A 通信隧道的概念。
2. **缺乏自主循环**：代理的运行严重依赖外部 Prompt 驱动（无输入即停机），没有内在的“心跳（Heartbeat）”或“目标驱动循环”。`coding-agent` 同样也是纯事件驱动的（敲击回车才触发），没有任何定时轮询或自主复苏机制。
3. **缺乏生理/心理状态反馈**：核心运行环境仅仅追踪上下文和执行中工具，对代理自身的资源消耗（如 Context Window 余量）、角色连贯性衰减等缺乏感知，进而无法由代理在框架内进行主动干预。`coding-agent` 遇到上下文爆窗也只是被动地阻断并摘要旧记录。

本改造方案旨在**不破坏现有核心运行流（向下兼容）**的前提下，为 agent 植入“状态基座”，并充分利用 `coding-agent` 优秀的 **Extension (中间件热插拔)** 机制，以外围生态的方式实现“记忆与灵魂隔离”以及“基于心跳的小脑调度系统”。

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

**影响面**：纯增量字段，不影响旧的 Copilot 业务逻辑。它可以通过 `agent.subscribe` 将状态变化（或新增的 `state_changed` 事件）广播给外层的“小脑”（例如一个专门的 Extension）进行监听与决策。

---

### 2.2 强化 A2A 的身份通道隔离 (Channels Abstracting) 与元数据注入
大模型在 `convertToLlm` 阶段虽不得不将消息折叠为大模型 API 支持的 `user` 或 `tool`，但我们可以极低成本地在包装层解决。

**改造切入点：利用 `coding-agent` 的 Extension 钩子 (`on("context")`) 或强化底层的 `transformContext`**

无需在底层硬编码复杂的解析逻辑，通过编写一个极轻量级的 Extension 中间件，拦截发往 LLM 前的 `messages` 数组，统一自动包装上下文元数据：

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
通过规范化这种前缀注入（拦截并修改 `ContextEvent`），彻底实现与其他 Agent 通信与常规“用户系统指令”的逻辑物理隔离。

---

### 2.3 记忆与灵魂的分离底座 (Soul & Memory Controllers)
大模型记忆不应随简单的 `agent.messages.push()` 无限膨胀，也不应仅仅依赖 `coding-agent` 简单粗暴的 Auto-Compaction 阻断机制。

*   **Soul (灵魂)**：固化的 `System Prompt`（我是一个前端专家，我的终极目标是保证组件复用性），永不修剪。
*   **Memory (工作/长期记忆)**：利用上层 Extension 监听底层暴露出的 `agent.state.entityState.metrics.contextWindowUsage`。当感知到上下文状态变化时，由外围插件主动决策是否触发专属的 Summarization 或 Memory RAG 检索，然后组装更新上下的 Context，实现比底层被动挤牙膏更优雅的记忆管理。

---

### 2.4 基于扩展系统的主动心跳循环 (Heartbeat Driven Cerebellum)
这是最为关键的**自治引擎升级**。打破“必须由 User 说话才触发”的死板束缚。相比于硬改底层的 `agent-loop`（虽然之前构思了 `onHeartbeatCheck` 钩子），更优雅的方式是利用现有的环境。

**改造切入点：`coding-agent` 生态下的驻留 Extension (Background Automation / AutonomousSession)**

在不砸烂现有 `AgentSession` 控制台入口的基础上：
1. 编写或外挂一个驻留的 Extension 插件。
2. 该插件内部包含自动轮询（例如 `setInterval` 或基于其他事件触发）的时钟。
3. 结合底层的 `EntityState` 暴露，自主判断是否要发送内部驱动消息。
4. 调用 `ExtensionContext` 提供的 `ctx.sendUserMessage()` 或 `ctx.sendMessage({ triggerTurn: true })`，向底层引擎发送不可见的隐式内部 Prompt，强行唤醒因缺乏用户回车而陷入等待的 `agent-loop`。

这种架构设计把“自治规划”与“底层指令执行”做到了完美的解耦。

---

## 3. 下一步行动计划

1. **底层状态扩容（Phase 1）**：在 `packages/agent/src/types.ts` 和 `agent.ts` 中完成 `EntityState` 的强类型植入与状态初始化。通过 `AgentEvent` 暴露给上层。
2. **事件钩子适配（Phase 2）**：确认 `coding-agent` 层的 `ExtensionRunner` 能够无损捕获我们新增的底层状态变化。
3. **心跳中间件 PoC（Phase 3）**：基于 `coding-agent` 的 Plugin/Extension 机制，编写一个探索性质的 Heartbeat 插件，尝试不依赖人类键盘敲击，由后台挂起的时钟结合状态变量自主唤醒引擎（发送隐式指令或唤起目标审查）。
4. **元数据网关联调（Phase 4）**：利用 `ContextEvent` 钩子进行 A2A 元数据和记忆快照动态注入的测试。
