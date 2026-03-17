# 默认提示词系统插件设计

## 1. 文档目的

本文定义一个以 extension 形式实现的“默认提示词系统插件”，用于把未来自治能力所依赖的提示词层明确拆分为可管理、可持久化、可观察的几个部分。

该插件的目标不是替换 `coding-agent` 现有的 system prompt 构建能力，而是在其上提供一个更稳定的策略层。

---

## 2. 设计目标

该插件需要同时满足以下目标：

1. 把提示词系统拆成稳定层和动态层，避免所有内容混在一个 system prompt 字符串里。
2. 为未来 Heartbeat 自主循环提供统一的“工作目标”接口。
3. 支持长期记忆与短期记忆的分离。
4. 让“工作目标”对用户可见，方便及时纠偏和更新。
5. 尽量复用 `coding-agent` 已有能力，而不是优先修改 `pi-agent-core`。

---

## 3. 提示词层模型

默认提示词系统插件将提示词来源拆为五层：

### 3.1 Soul

用途：

- 定义稳定身份
- 定义长期价值偏好
- 定义不应轻易漂移的人格边界

典型内容：

- “我是怎样的一类 agent”
- “我优先追求什么类型的结果”
- “我在风格、质量和风险上的长期倾向”

特征：

- 低频变化
- 高稳定性
- 不直接等于具体任务目标

### 3.2 Agent

用途：

- 定义行为规范
- 定义工具使用规范
- 定义权限边界
- 定义运行时约束

典型内容：

- 编辑规则
- 测试和验证规则
- 何时终止、何时继续、何时请求确认
- 对隐藏消息、自治行为的约束

特征：

- 比 Soul 更偏执行规范
- 直接影响 agent 的操作方式

### 3.3 长期记忆

用途：

- 保存跨 session 的高价值知识
- 保存项目长期约束
- 保存对未来自治行为有帮助的稳定事实

典型内容：

- 架构约束
- 团队偏好
- 已确认的长期目标
- 历史决策摘要

特征：

- 不应默认全部注入每一轮
- 需要按需检索和提炼

### 3.4 短期记忆

用途：

- 表达当前 session 的工作上下文
- 提供最近几轮的重要决策、失败、局部结论

典型内容：

- 当前 session 中的上下文压缩结果
- 本轮之前的关键动作和未完成状态
- 与当前分支直接相关的近期信息

特征：

- 由 session 演化自然生成
- 需要和 compaction 协同

### 3.5 工作目标

用途：

- 提炼当前时段 agent 应该主动推进的目标
- 为未来自治循环提供可执行的“方向约束”
- 对用户透明展示，便于修正

这是本插件新增的核心层。

工作目标不是直接复制用户原话，而是从以下来源按权重提炼出的“当前最应该做什么”：

- 用户最新明确要求
- 当前 session 的短期上下文
- Agent 行为规范
- 长期记忆中与当前任务强相关的部分
- Soul 中对目标方向有影响的长期倾向

---

## 4. 两套优先级：提炼权重与冲突优先级

为避免“工作目标”系统失真，需要区分两套规则。

## 4.1 提炼权重

这是生成工作目标时的权重顺序：

1. 用户当前明确任务
2. 短期记忆
3. Agent 行为规范
4. 长期记忆
5. Soul

解释：

- 工作目标首先必须反映“当前要做什么”
- 因此用户当前要求和短期上下文权重最高
- Agent 规范影响“怎么做”
- 长期记忆用于补全约束和延续性
- Soul 只在方向性上提供稳定倾向，不应抢夺当前任务定义权

## 4.2 运行时冲突优先级

这是不同层发生冲突时的裁决顺序：

1. Agent 行为规范
2. 用户当前明确任务
3. 短期记忆
4. 长期记忆
5. Soul

解释：

- 工作目标可以受用户任务驱动
- 但不能违反显式行为规范
- Soul 不应该覆盖明确指令，只应提供风格和倾向

---

## 5. 插件边界与实现位置

本设计默认以 `coding-agent` extension 实现，不先改 `pi-agent-core`。

原因：

1. `coding-agent` 已具备 `before_agent_start`、`context`、`session_before_compact`、`sendMessage`、`appendEntry` 等关键接缝。
2. 工作目标属于策略层，不是通用 runtime 事实。
3. 提示词层的拼装方式高度产品相关，应该先在 extension 层收敛。

---

## 6. 推荐的数据落点

## 6.1 使用 `CustomEntry` 保存结构化状态

适合保存：

- `prompt_profile`
- `long_memory_index`
- `working_goal_state`
- `prompt_system_config`

这些内容默认不直接进入 LLM 上下文。

## 6.2 使用 `CustomMessageEntry` 保存需要进入上下文或对用户可见的内容

适合保存：

- `working_goal`
- `memory_snapshot`
- `prompt_notice`

其中：

- `working_goal` 应默认 `display: true`
- `memory_snapshot` 可按策略决定是否显示

---

## 7. 推荐的结构化数据

## 7.1 `working_goal_state`

建议持久化结构：

```typescript
interface WorkingGoalState {
    version: 1;
    summary: string;
    derivedFrom: {
        latestUserIntent?: string;
        shortTermContext?: string[];
        longTermMemoryRefs?: string[];
        agentRulesRefs?: string[];
        soulRefs?: string[];
    };
    status: "active" | "stale" | "blocked" | "completed";
    updatedAt: number;
}
```

## 7.2 `working_goal` message

建议以 `custom_message` 展示：

```typescript
{
    customType: "working_goal",
    display: true,
    content: [
        { type: "text", text: "当前工作目标: ..." }
    ]
}
```

它应对用户可见，并在以下时机更新：

- 新用户任务进入时
- compaction 结束后
- Heartbeat 判断目标已过期时
- 用户显式纠偏时

---

## 8. 插件生命周期

## 8.1 `session_start`

插件在 session 启动时执行：

1. 读取 prompt system 配置
2. 读取长期记忆索引
3. 恢复最近的 `working_goal_state`
4. 判断是否需要立即发布用户可见的工作目标消息

## 8.2 `before_agent_start`

这是本插件的核心钩子。

插件在这一阶段完成：

1. 读取 Soul / Agent / Memory / Working Goal 当前状态
2. 组装 turn 级 system prompt 增强段
3. 必要时注入隐藏 custom message

推荐输出结构：

- system prompt 只放稳定约束和当前目标摘要
- 较长的 memory snapshot 放到 custom message 或 `context` 注入

## 8.3 `context`

插件在 `context` 阶段可进行临时上下文注入：

- 插入短期记忆摘要
- 插入按需检索到的长期记忆片段
- 插入工作目标摘要

这里的注入应尽量是瞬时的，不一定持久化。

## 8.4 `session_before_compact`

插件在 compaction 前应：

1. 判断哪些提示词层需要被保留为结构化状态
2. 避免把工作目标完全淹没在普通摘要里
3. 在 compaction 后重建 `working_goal_state`

---

## 9. 工作目标的可见性设计

工作目标必须用户可见。

推荐原因：

1. 自治行为如果没有外显目标，用户很难理解 agent 在做什么。
2. 用户可通过对工作目标的修正，低成本纠偏自治循环。
3. 工作目标可以作为“当前自治权限范围”的解释层。

推荐交互形式：

- 每次工作目标发生实质变化时，新增一条 `working_goal` custom message
- 后续可追加 `/goal` 命令或 UI 卡片，但初期不依赖新 UI

---

## 10. 与 Heartbeat 插件的关系

Heartbeat 插件不应该自己直接推导复杂目标。

推荐职责划分：

- 默认提示词系统插件负责生成和维护 `working_goal`
- Heartbeat 插件负责根据状态决定“是否应该推进、暂停、压缩、等待或请求目标刷新”

这样可以避免：

- Heartbeat 变成第二套规划系统
- 目标定义和调度判断彼此耦合

---

## 11. MVP 范围

第一阶段只做：

1. Soul / Agent / Long Memory / Short Memory / Working Goal 五层概念落地
2. `working_goal_state` 结构化持久化
3. 用户可见的 `working_goal` custom message
4. `before_agent_start` 动态组装默认提示词增强段
5. `session_before_compact` 保证工作目标在 compaction 后能重建

先不做：

- 独立 UI 面板
- 工作目标多版本对比
- 自动从外部数据库检索长期记忆
- 多目标并行调度

---

## 12. 成功标准

如果该插件设计成功，应满足：

1. 用户能够清楚看到 agent 当前自认为在做什么。
2. Heartbeat 系统可以直接消费 `working_goal`，无需再次推导。
3. compaction 不会导致工作目标彻底丢失。
4. 长期记忆与短期上下文不会全部挤进单一 prompt 字符串。

