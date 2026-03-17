# Heartbeat 自主循环插件设计

## 1. 文档目的

本文定义一个以 extension 形式实现的 Heartbeat 自主循环插件。

该插件的核心目标不是“让 agent 自动变聪明”，而是先让 agent 能够根据状态做自我管理，并为未来自主行动留出清晰接口。

你给出的关键约束是正确的：

> 上下文窗口用量是最核心权重。

因此 Heartbeat 插件的第一职责是 runtime self-management，第二职责才是 autonomous action readiness。

---

## 2. 设计目标

Heartbeat 插件需要完成四类事情：

1. 感知状态
2. 做安全判断
3. 触发维护动作
4. 为未来自治行为预留执行接口

第一阶段不追求：

- 自主拆解大任务
- 自主长期执行复杂工作流
- 自主 A2A 编排

---

## 3. 与其他系统的依赖关系

Heartbeat 插件不是孤立系统。

它依赖：

- 默认提示词系统插件提供 `working_goal`
- session / compaction 机制提供上下文状态
- extension runtime 提供调度入口

它暂不依赖：

- A2A 插件

因此推荐顺序是：

1. 默认提示词系统稳定
2. Heartbeat 插件稳定
3. A2A 再进入下一阶段

---

## 4. Heartbeat 的职责边界

## 4.1 Heartbeat 负责的事

- 监控 context budget
- 判断当前是否适合继续自主推进
- 判断是否需要 compaction
- 判断工作目标是否过期
- 判断是否应该刷新 memory snapshot
- 在安全前提下触发一个新的内部 turn

## 4.2 Heartbeat 不负责的事

- 重新定义长期人格
- 直接修改 Soul / Agent 规范
- 实现完整规划器
- 实现跨 agent 协作协议

---

## 5. 状态输入模型

Heartbeat 插件的判断依赖以下输入，按重要性排序：

1. context usage
2. agent 是否 idle
3. 是否有 pending steering / follow-up
4. 是否正在 retry / compaction / bash
5. 是否存在有效 `working_goal`
6. 距离上次 heartbeat 的冷却时间
7. 最近一次用户活动时间
8. 当前自治模式是否启用

其中最核心的是 context usage。

---

## 6. context usage 分级

推荐使用保守分级，而不是单一阈值。

## 6.1 状态未知

条件：

- `tokens === null`
- 或 `percent === null`

策略：

- 不触发新的自主行动
- 只允许观察
- 等待下一次真实 assistant usage 更新

## 6.2 低风险区

条件：

- context usage < 55%

策略：

- 可以刷新工作目标
- 可以注入 memory snapshot
- 可以为未来自治行动预热

## 6.3 关注区

条件：

- 55% <= usage < 70%

策略：

- 可以做轻量维护
- 避免注入大块新上下文
- 优先检查目标是否仍然有效

## 6.4 压力区

条件：

- 70% <= usage < 85%

策略：

- 不做主动扩展型自治行动
- 优先压缩、清理、目标收束
- 仅允许最小化维护消息

## 6.5 危险区

条件：

- usage >= 85%

策略：

- 不触发新的自治工作
- 优先 compaction 或停机等待
- 任何自动动作都应以降低风险为唯一目标

---

## 7. Heartbeat 的动作模型

Heartbeat 每次 tick 只能做以下几类动作之一：

1. `noop`
2. `refresh_working_goal`
3. `refresh_memory_snapshot`
4. `request_compaction`
5. `schedule_autonomous_turn`
6. `pause_autonomy`

这样做的目的是：

- 让调度行为可审计
- 限制自治复杂度
- 避免多个动作叠加导致状态爆炸

---

## 8. 推荐的插件存储结构

## 8.1 `autonomy_config`

```typescript
interface AutonomyConfig {
    version: 1;
    enabled: boolean;
    mode: "observe" | "maintain" | "assist" | "autonomous";
    cooldownMs: number;
    maxHeartbeatActionsPerHour: number;
    highWatermarkPercent: number;
    criticalWatermarkPercent: number;
}
```

## 8.2 `heartbeat_state`

```typescript
interface HeartbeatState {
    version: 1;
    lastTickAt?: number;
    lastActionAt?: number;
    lastActionType?: string;
    consecutiveNoopCount: number;
    pausedReason?: string;
}
```

## 8.3 `heartbeat_notice`

如果需要用户可见反馈，可发出：

```typescript
customType: "heartbeat_notice"
display: true
```

但初期不建议每次 tick 都展示，以免打扰。

---

## 9. 插件生命周期

## 9.1 `session_start`

在 session 启动时：

1. 读取自治配置
2. 恢复 heartbeat 状态
3. 启动 timer 或事件驱动调度器

## 9.2 `session_shutdown`

在 session 结束时：

1. 清理 timer
2. 持久化 heartbeat 状态
3. 避免残留后台任务

## 9.3 定时 tick

每个 tick 执行：

1. 采集状态
2. 计算风险等级
3. 判断是否允许动作
4. 最多执行一个动作
5. 更新 `heartbeat_state`

---

## 10. 推荐的执行接口

Heartbeat 插件推荐优先使用以下 extension 能力：

- `ctx.isIdle()`
- `ctx.hasPendingMessages()`
- `ctx.getContextUsage()`
- `ctx.compact()`
- `pi.sendMessage(..., { triggerTurn: true })`

其中，推荐优先用隐藏 custom message 启动内部 turn：

```typescript
{
    customType: "heartbeat_trigger",
    display: false,
    content: "..."
}
```

而不是默认用普通 user message。

理由：

- 更容易和真实用户输入区分
- 更利于后续调试和导出
- 更利于 compaction 总结自治行为

---

## 11. 自治行动预留接口

Heartbeat 插件第一阶段不直接执行复杂自治任务，但要为其预留接口。

推荐预留一个统一的 action contract：

```typescript
interface AutonomousActionRequest {
    type: "maintain_context" | "refresh_goal" | "consult_memory" | "propose_next_step";
    reason: string;
    workingGoalSummary?: string;
}
```

Heartbeat 的职责是决定“是否值得发出一个 action request”。
真正的自治行动逻辑应由后续插件或策略模块消费。

---

## 12. 与 compaction 的协同

Heartbeat 插件必须把 compaction 视为一等事件。

推荐规则：

1. 一旦进入高风险区，优先 compaction
2. compaction 期间禁止新的自治 turn
3. compaction 后直到 context usage 再次可观测前，只允许观察模式
4. compaction 完成后应重新检查 `working_goal` 是否失真

---

## 13. 用户可见性策略

Heartbeat 的运行本身不必完全可见，但其关键动作应该可解释。

推荐可见策略：

- 普通 tick 不展示
- 目标刷新可通过 `working_goal` 消息体现
- 风险暂停时可以发一条 `heartbeat_notice`
- 触发 compaction 时沿用现有 compaction UI

用户需要知道：

- agent 为什么没有继续自主推进
- agent 为什么决定先压缩上下文
- 当前自治模式是否处于暂停状态

---

## 14. MVP 范围

第一阶段只做：

1. 基于 context usage 的保守分级
2. 安全 tick 调度
3. `noop` / `refresh_working_goal` / `request_compaction` 三类动作
4. 与默认提示词系统插件联动

先不做：

- 多步规划
- 自动执行真实工程任务
- 自动跨 session 追踪
- A2A 驱动心跳

---

## 15. 成功标准

Heartbeat 插件设计成功时，应满足：

1. agent 能根据 context budget 做自我保护
2. `working_goal` 可被自动刷新，但不会频繁抖动
3. 自治循环不会和用户输入、retry、compaction 冲突
4. 后续若要接入自主执行逻辑，只需扩展 action consumer，而无需推翻 Heartbeat 本体

