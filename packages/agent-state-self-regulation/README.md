# pi-agent-state-self-regulation

面向 `pi-mono` / `@mariozechner/pi-coding-agent` 生态的运行时自调节插件。

该插件在每次模型调用前评估当前会话的上下文压力，并将评估结果注入提示词，同时向 agent 暴露显式的上下文调节能力，例如 `compact` 和 `new_session`。

源码仓库：

- <https://github.com/sealiu1997/pi-mono/tree/main/packages/agent-state-self-regulation>

## 功能概览

- 在 `context` hook 上按次评估上下文窗口使用情况
- 默认将系统内存仅视为辅助参考信号，不作为核心决策依据
- 向提示词注入结构化运行时状态
- 暴露 `self_regulate_context` 工具，支持：
  - `get_state`
  - `list_profiles`
  - `compact`
  - `set_thresholds`
  - `new_session`
- 内置 `host-default`、`light`、`standard`、`aggressive` 四种 compaction profile
- 支持自定义 probes、脚本 probes、assessment extenders 和自定义 compaction profiles

## 适用范围

该插件面向能够兼容 `@mariozechner/pi-coding-agent` 扩展生命周期的宿主。

基础要求：

- Node.js `>= 20.6.0`
- `@mariozechner/pi-coding-agent ^0.58.4` 作为 peer dependency

宿主至少需要具备以下能力：

- 可加载标准 extension
- 支持 `context` hook
- 支持工具注册
- 支持会话 compaction 接口
- 支持 fresh session / new session 接口，或提供等价适配层

如果宿主只复用了更底层的 `pi-agent-core`，则通常需要一个薄适配层来接入：

- prompt 注入
- tool 注册
- regulation state 持久化
- compaction / new session 调用

## 安装

### 重要说明

- 这个 fork 当前没有发布到 npm registry
- 仓库不提交该包的 `dist` 产物
- `pi install git:github.com/sealiu1997/pi-mono` 不是正确安装方式  
  原因是 `pi` 的 git 安装以仓库根目录为包根，而本插件位于 monorepo 子目录 `packages/agent-state-self-regulation`

### 方式一：作为 pi 扩展包，从本地已构建目录安装

先构建插件：

```bash
git clone https://github.com/sealiu1997/pi-mono.git
cd pi-mono
npm install
npm --prefix packages/agent-state-self-regulation run build
```

再安装子包目录：

```bash
pi install /absolute/path/to/pi-mono/packages/agent-state-self-regulation
```

项目本地安装：

```bash
pi install -l /absolute/path/to/pi-mono/packages/agent-state-self-regulation
```

### 方式二：打成 tarball，供其他 agent / 宿主以 npm 依赖方式接入

在 fork 仓库中构建并打包：

```bash
git clone https://github.com/sealiu1997/pi-mono.git
cd pi-mono
npm install
npm --prefix packages/agent-state-self-regulation run build
cd packages/agent-state-self-regulation
npm pack
```

在目标项目中安装生成的 tarball：

```bash
npm install /absolute/path/to/sealiu1997-pi-agent-state-self-regulation-0.58.4.tgz @mariozechner/pi-coding-agent
```

对于基于 `pi-mono` 内核的其他 agent，推荐优先使用这种方式。

## 接入方式

### 1. 作为默认 pi package 入口加载

```ts
import agentStateSelfRegulationExtension from "@sealiu1997/pi-agent-state-self-regulation/extension";

export default agentStateSelfRegulationExtension;
```

### 2. 以编程方式注册

```ts
import { createAgentStateSelfRegulationExtension } from "@sealiu1997/pi-agent-state-self-regulation";

const extension = createAgentStateSelfRegulationExtension({
	config: {
		contextThresholds: {
			tightPercent: 70,
			criticalPercent: 85,
		},
	},
});
```

### 3. 常见自定义点

- `config.contextThresholds`  
  调整 `normal / tight / critical` 的上下文阈值
- `customProbes`  
  注册宿主内的自定义 probe，并把状态回流到 regulation state
- `scriptProbes`  
  从外部命令采集 JSON 数据，并注入经过清洗的结构化 prompt 字段
- `assessmentExtenders`  
  在默认 assessment 基础上追加或改写评估结果
- `compactionProfiles`  
  注册额外的 compaction profile

## 高级扩展

### `scriptProbes`

`scriptProbes` 适合接入外部脚本、宿主探针或自定义健康检查。

最小配置示例：

```ts
import { createAgentStateSelfRegulationExtension } from "@sealiu1997/pi-agent-state-self-regulation";

const extension = createAgentStateSelfRegulationExtension({
	scriptProbes: [
		{
			key: "workspace_health",
			command: "node",
			args: ["./scripts/workspace-health.mjs"],
			timeoutMs: 400,
		},
	],
});
```

脚本需要输出一个 JSON 对象，推荐格式如下：

```json
{
  "status": "tight",
  "reason": "workspace is in read-only mode",
  "data": {
    "queueDepth": 3
  },
  "promptData": {
    "workspace_mode": "read_only",
    "queue_depth": 3
  }
}
```

说明：

- `status` 可选，允许值为 `normal`、`tight`、`critical`、`unknown`，默认是 `normal`
- `data` 会保留在 regulation state 中，供 `get_state` 等工具读取
- `promptData` 会被清洗后注入 prompt，但只保留顶层标量值：`string`、`number`、`boolean`、`null`
- probe 进程以 `shell: false` 启动
- 默认超时为 `500ms`
- 默认最大输出为 `4096 bytes`
- 默认最多注入 `6` 个 prompt 字段，单个字段最大长度 `160` 个字符

### `assessmentExtenders`

`assessmentExtenders` 用于在默认评估结果上做二次修正，例如结合业务规则或外部探针信号提升风险等级。

最小示例：

```ts
import { createAgentStateSelfRegulationExtension } from "@sealiu1997/pi-agent-state-self-regulation";

const extension = createAgentStateSelfRegulationExtension({
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

说明：

- extender 可以改写 `assessment`
- extender 也可以追加结构化 `promptData`
- 如果 extender 抛错，插件会保守降级，不会直接中断整个请求

## 工具接口

插件向 agent 暴露工具 `self_regulate_context`。

| Action | 说明 |
| --- | --- |
| `get_state` | 读取当前 regulation state |
| `list_profiles` | 查看可用 compaction profiles |
| `compact` | 请求执行一次 compaction |
| `set_thresholds` | 在当前 session 内调整阈值 |
| `new_session` | 请求创建 fresh session |

## 当前实现边界

- `reset_session` 仍是预留定义，当前未暴露到 tool surface
- 内置 `light` / `standard` / `aggressive` 并不是新的压缩算法  
  它们只是不同的 profile 预设，底层仍调用宿主现有的核心 `compact()` 引擎
- 当前版本不包含 heartbeat / timer 调度器
- 外部宿主是否可直接兼容，取决于其是否保留了 `pi-coding-agent` 兼容的 extension lifecycle

## 验证状态

当前已完成的验证：

- 本地 `pi` 源码态联调
- script probe smoke
- standalone build / pack smoke
- installed-package load smoke

外部宿主兼容性仍需在具体宿主中单独验证，例如 OpenClaw。

## 相关文档

- 架构说明：[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
