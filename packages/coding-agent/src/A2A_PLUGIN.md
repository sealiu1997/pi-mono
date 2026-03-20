# A2A 插件设计

## 1. 文档目的

本文定义未来的 A2A 插件边界，但明确它不是当前优先实施目标。

当前优先级顺序为：

1. 默认提示词系统插件
2. Heartbeat 自主循环插件
3. A2A 插件

原因很简单：

- 没有稳定的工作目标层，A2A 消息难以落位
- 没有稳定的 Heartbeat 和 context 管理，A2A 容易放大上下文噪声

补充判断：

- A2A 是“对话抽象化”的一个具体落点
- 它证明 turn 的触发源不一定是人类，也可以是其他 agent 或系统组件

---

## 2. 当前定位

A2A 插件在第一阶段仅作为设计文档存在，不建议立即开发。

它的职责是：

- 把其他 agent 的消息规范化表示为 `coding-agent` 可消费的内部消息
- 让这些消息能够持久化、可视化、可被 compaction 和 serializer 正确处理
- 为未来与 Google A2A 规范和 SDK 的接入预留适配边界

---

## 3. 设计目标

1. 能明确区分“用户消息”和“其他 agent 消息”
2. 能记录来源、线程、优先级和意图
3. 能在不修改 `pi-ai` 消息模型的前提下稳定注入上下文
4. 能为后续 Google A2A 规范适配留下接口

---

## 4. 非目标

第一阶段不做：

- 多 agent 调度中心
- 分布式 broker
- 强一致 mailbox
- 复杂权限系统
- 强依赖某家协议实现

---

## 5. 推荐的总体形态

A2A 插件推荐采用“三段式”结构：

1. inbound adapter
2. session persistence
3. context serializer

## 5.1 inbound adapter

负责把外部来源规范化为内部结构，不关心最终如何送入 LLM。

可接入来源：

- 本地扩展
- 未来外部 SDK
- 未来 Google A2A adapter

## 5.2 session persistence

负责保存：

- A2A 线程元数据
- A2A 消息内容
- 与工作目标的关联

## 5.3 context serializer

负责把 `a2a` 消息在 LLM 边界转换为清晰、紧凑、可控的上下文表示。

---

## 6. 推荐的数据结构

## 6.1 `a2a_message_state`

```typescript
interface A2AMessageState {
    version: 1;
    messageId: string;
    threadId?: string;
    sourceAgentId: string;
    sourceSessionId?: string;
    messageType: "proposal" | "review" | "handoff" | "status";
    priority: "low" | "normal" | "high";
    createdAt: number;
}
```

说明：

- `authority` 暂不进入 MVP 结构，因为当前没有明确消费方
- 如果后续真的需要“必须处理”的语义，再在 Phase 2+ 引入

## 6.2 `a2a` custom message

```typescript
{
    role: "custom",
    customType: "a2a",
    display: true,
    content: "...",
    details: { ...A2AMessageState }
}
```

推荐原因：

- 已兼容 `CustomMessageEntry`
- 已兼容 TUI 自定义渲染
- 已兼容 compaction 路径

---

## 7. 与 Google A2A 规范 / SDK 的关系

当前阶段不应把 Google 的规范直接写死进本地消息结构。

推荐做法是保留一个适配层：

- 外部协议字段先进入 adapter
- adapter 归一化为本地 `A2AMessageState`
- 本地 runtime 和 compaction 只依赖归一化后的结构

这样做的好处：

1. 当前文档不依赖外部规范细节稳定
2. 后续接入 Google SDK 时不必重写本地 session 结构
3. 未来如果同时接入其他 A2A 协议，也不会污染 core 设计

---

## 8. 与默认提示词系统和 Heartbeat 的依赖

## 8.1 对默认提示词系统的依赖

A2A 消息进入上下文前，应和工作目标绑定。

推荐策略：

- 如果一条 A2A 消息与当前 `working_goal` 强相关，则进入本轮上下文
- 如果弱相关，则只保留在 session 中，等待后续需要时再注入

## 8.2 对 Heartbeat 的依赖

Heartbeat 可以在未来消费 A2A 状态，例如：

- 发现高优先级 handoff
- 发现 review 待处理
- 发现 status 更新与当前目标冲突

但在 Heartbeat 和工作目标系统没稳定之前，不应让 A2A 反向驱动自治循环。

MVP 约束：

- A2A 先作为输入信号，不作为 heartbeat 的直接驱动器
- 先解决“能表示、能持久化、能序列化”，再考虑“能调度”

---

## 9. 上下文注入策略

推荐只在 `context` hook 中做临时注入，而不是默认把所有 A2A 消息长期塞进上下文。

推荐序列化格式：

```xml
<a2a_message source_agent="reviewer" type="review" authority="advisory" priority="high">
...
</a2a_message>
```

关键要求：

- 文本要紧凑
- 必须保留来源和优先级
- 必须能被 compaction 总结

---

## 10. 用户可见性

A2A 消息在第一阶段应默认可见。

原因：

1. 用户需要知道当前上下文里哪些内容来自其他 agent
2. A2A 是高风险信息源，隐藏会降低可解释性
3. 便于后续做目标纠偏

未来若需要隐藏某些系统型 handoff，再增加专门的 hidden 类型，不建议一开始就默认隐藏。

---

## 11. 分阶段建议

## Phase 0: 只保留设计，不实现

完成内容：

- 文档
- 归一化数据结构
- adapter boundary 设计

## Phase 1: 只做本地 read-only A2A 注入

范围：

- 支持本地 extension 产生 `a2a` 消息
- 支持 session 保存
- 支持 context serializer
- 只覆盖 `proposal` / `review` / `status` / `handoff` 这四类基础消息
- 不做外部协议接入

## Phase 2: 接入外部协议适配器

范围：

- 增加 Google A2A 规范 / SDK adapter
- 归一化进入本地结构
- 支持 inbound handoff

## Phase 3: 评估 outbound 和双向协作

范围：

- outbound adapter
- 可选的状态回传
- 与 Heartbeat 和工作目标联动

---

## 12. 成功标准

A2A 插件在未来真正进入实施时，应满足：

1. 不引入新的 core message role
2. 能明确标识来源、优先级以及后续可能追加的策略元数据
3. 不把外部协议细节扩散到整个 runtime
4. 能和工作目标、compaction、Heartbeat 自然协同
