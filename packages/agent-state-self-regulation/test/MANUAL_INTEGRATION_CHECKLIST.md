# Agent State Self-Regulation Manual Integration Checklist

This checklist covers the validation work that is still needed after unit tests pass.

Current automated status:

- package unit tests pass
- package type check passes

Current manual integration status:

- A. Local source integration with `pi`: passed
- B. Script probe smoke: passed
- C. Standalone package build and pack smoke: passed
- D. Installed package load smoke: passed
- E. External host compatibility smoke: pending

This checklist focuses on:

- real host integration
- standalone package packaging smoke
- external host compatibility smoke

## Prerequisites

- A working Node.js toolchain in `PATH`
- A valid model provider configuration for `pi`
- The repository checkout at:
  - `/Users/liuhaiyang/code/agent_study/pi-mono`

Recommended shell setup:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
export REPO="/Users/liuhaiyang/code/agent_study/pi-mono"
export PKG="$REPO/packages/agent-state-self-regulation"
```

## A. Local Source Integration With pi

Goal:

- verify hook registration
- verify tool registration
- verify per-call assessment
- verify compaction routing
- verify `new_session`

Recommended startup command:

```bash
cd "$REPO"
./pi-test.sh --no-extensions -e "$PKG/src/extension.ts"
```

Checklist:

- [ ] Launch `pi` with only this extension explicitly loaded.
- [ ] Confirm startup output shows the extension is loaded.
- [ ] Send a prompt asking the model to call `self_regulate_context` with `get_state`.
- [ ] Verify the tool call succeeds and returns the current assessment.
- [ ] Ask the model to call `self_regulate_context` with `list_profiles`.
- [ ] Verify the returned profiles include `host-default`, `light`, `standard`, and `aggressive`.
- [ ] Ask the model to call `self_regulate_context` with `set_thresholds` and temporarily lower context thresholds.
- [ ] Verify a follow-up `get_state` reflects the updated thresholds.
- [ ] Ask the model to call `self_regulate_context` with `compact` using `light`.
- [ ] Verify the compaction request succeeds and no extension error is raised.
- [ ] Ask the model to call `self_regulate_context` with `new_session`.
- [ ] Verify the host starts a fresh session.

Suggested prompts:

```text
Use the self_regulate_context tool with action get_state and summarize the result.
```

```text
Use the self_regulate_context tool with action list_profiles.
```

```text
Use the self_regulate_context tool with action set_thresholds. Set context tight=1 and critical=2. Then call get_state again.
```

```text
Use the self_regulate_context tool with action compact and profile light.
```

```text
Use the self_regulate_context tool with action new_session.
```

Pass criteria:

- no extension load errors
- all tool actions above execute successfully
- threshold changes are reflected in later state reads
- compaction is routed without crashing
- `new_session` triggers host `/new` behavior

Observed notes:

- In the current print/non-interactive path, queue-based actions such as `compact` and `new_session` can emit `tool_execution_start` without a matching `tool_execution_end` in the same observed event stream.
- Treat this as an observability detail, not immediate failure. Validate those actions by host side effects:
  - `compact`: look for a real `compaction` entry in the session file or an increased compaction count.
  - `new_session`: verify the session file path changes and a fresh session file appears after the follow-up turn.

## B. Script Probe Smoke

Goal:

- verify external script ingestion works
- verify time-bounded and structured prompt-field flow

Suggested temporary script:

```bash
TMP_SCRIPT="$(mktemp)"
cat > "$TMP_SCRIPT" <<'EOF'
#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  status: "normal",
  reason: "manual smoke",
  promptData: {
    smoke_channel: "manual",
    smoke_counter: 1
  }
}))
EOF
chmod +x "$TMP_SCRIPT"
```

Recommended programmatic wiring sample:

```ts
import { createAgentStateSelfRegulationExtension } from "@mariozechner/pi-agent-state-self-regulation";

const extension = createAgentStateSelfRegulationExtension({
  scriptProbes: [
    {
      id: "manual-smoke",
      command: [process.env.TMP_SCRIPT!],
      timeoutMs: 500,
    },
  ],
});
```

Checklist:

- [ ] Load the extension with one simple script probe.
- [ ] Verify `get_state` still succeeds.
- [ ] Verify the script probe does not break normal prompt flow.
- [ ] Verify the script can return structured prompt fields.
- [ ] Verify script output stays bounded and does not cause crashes.
- [ ] Verify a failing or timing-out script probe does not break the extension.

Pass criteria:

- successful script-probe execution does not break the session
- failing script-probe execution degrades safely
- no raw unbounded command output is injected

## C. Standalone Package Build And Pack Smoke

Goal:

- verify independent package build output
- verify package tarball shape
- verify installed package path can be loaded by the host

Build and pack:

```bash
cd "$PKG"
npm run clean
npm run build
npm pack
```

Checklist:

- [ ] `dist/index.js` and `dist/extension.js` are produced.
- [ ] `npm pack` succeeds.
- [ ] The tarball contains `dist`, `docs`, `README.md`, and `CHANGELOG.md`.
- [ ] The packed package still exposes `./extension`.

Optional tarball inspection:

```bash
tar -tzf "$PKG"/mariozechner-pi-agent-state-self-regulation-*.tgz
```

Pass criteria:

- build completes without errors
- tarball shape matches `package.json` `files` and `exports`

## D. Installed Package Load Smoke

Goal:

- verify the built package works when loaded from an installed package path
- avoid relying only on the monorepo source tree

One simple approach:

```bash
TMP_DIR="$(mktemp -d)"
cd "$TMP_DIR"
npm init -y
npm install "$PKG"/mariozechner-pi-agent-state-self-regulation-*.tgz @mariozechner/pi-coding-agent
cd "$REPO"
./pi-test.sh --no-extensions -e "$TMP_DIR/node_modules/@mariozechner/pi-agent-state-self-regulation"
```

Checklist:

- [ ] The installed package path loads without manual source rewrites.
- [ ] The host discovers the package through its manifest or package root.
- [ ] `get_state` works from the installed package.
- [ ] `compact` works from the installed package.
- [ ] `new_session` works from the installed package.

Pass criteria:

- installed-package loading behaves the same as source loading
- no missing `dist` or `exports` issues appear

Observed notes:

- This round passed from an installed package path under `node_modules/@mariozechner/pi-agent-state-self-regulation`.
- `get_state` was verified directly in print mode.
- `compact` and `new_session` were verified with host side effects:
  - installed-package `compact` produced a real `type:"compaction"` session entry.
  - installed-package `new_session` switched to a new session file and persisted the follow-up turn there.
- For repository-checkout testing on another machine, remember that the repo does not commit `dist`. Build the package first or use a packed tarball.

## E. External Host Compatibility Smoke

Goal:

- verify compatibility with a host outside the current monorepo test loop
- separate packaging correctness from lifecycle compatibility

Recommended target:

- an external host that claims compatibility with standard `@mariozechner/pi-coding-agent` extensions

Checklist:

- [ ] Install the published or packed package in the external host.
- [ ] Confirm the host loads the extension without patching the package.
- [ ] Confirm `self_regulate_context` is registered.
- [ ] Confirm at least one `get_state` call succeeds.
- [ ] Confirm `compact` does not fail because of lifecycle mismatch.
- [ ] Confirm `new_session` behaves as expected or fails clearly if unsupported by that host.

Pass criteria:

- no lifecycle mismatch blocks basic operation
- any incompatibility is specific and actionable

## F. Release Readiness Summary

Release-ready baseline:

- [x] Local source integration passes
- [x] Script probe smoke passes
- [x] Standalone build and pack smoke passes
- [x] Installed package load smoke passes
- [ ] At least one external host compatibility smoke passes

If all items above pass, the package is no longer only "unit-test green"; it is also integration-validated and packaging-validated.

---

# 中文版

# Agent 状态自调节插件实际联调检查清单

这份清单覆盖的是单元测试通过之后，仍然需要完成的真实验证工作。

当前自动化状态：

- 包级单元测试通过
- 包级类型检查通过

当前手工联调状态：

- A. 本地源码态接入 `pi`：已通过
- B. Script probe smoke：已通过
- C. 独立包 build 与 pack smoke：已通过
- D. 安装后包加载 smoke：已通过
- E. 外部宿主兼容性 smoke：待执行

这份清单重点覆盖：

- 宿主真实接入
- 独立包打包 smoke
- 外部宿主兼容性 smoke

## 前置条件

- `PATH` 中有可用的 Node.js 工具链
- `pi` 已配置可用的模型 provider
- 仓库路径为：
  - `/Users/liuhaiyang/code/agent_study/pi-mono`

推荐 shell 环境：

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
export REPO="/Users/liuhaiyang/code/agent_study/pi-mono"
export PKG="$REPO/packages/agent-state-self-regulation"
```

## A. 本地源码态接入 pi

目标：

- 验证 hook 注册
- 验证 tool 注册
- 验证逐次评估
- 验证 compaction 路由
- 验证 `new_session`

推荐启动命令：

```bash
cd "$REPO"
./pi-test.sh --no-extensions -e "$PKG/src/extension.ts"
```

检查项：

- [ ] 只显式加载这个 extension 启动 `pi`
- [ ] 确认启动输出里能看到 extension 已加载
- [ ] 给模型一条指令，让它调用 `self_regulate_context` 的 `get_state`
- [ ] 验证 tool 调用成功，并返回当前 assessment
- [ ] 让模型调用 `self_regulate_context` 的 `list_profiles`
- [ ] 验证返回中包含 `host-default`、`light`、`standard`、`aggressive`
- [ ] 让模型调用 `self_regulate_context` 的 `set_thresholds`，临时调低 context 阈值
- [ ] 验证后续 `get_state` 能反映新的阈值
- [ ] 让模型调用 `self_regulate_context` 的 `compact`，profile 选 `light`
- [ ] 验证 compaction 请求成功，且没有 extension 报错
- [ ] 让模型调用 `self_regulate_context` 的 `new_session`
- [ ] 验证宿主成功开启 fresh session

建议提示词：

```text
Use the self_regulate_context tool with action get_state and summarize the result.
```

```text
Use the self_regulate_context tool with action list_profiles.
```

```text
Use the self_regulate_context tool with action set_thresholds. Set context tight=1 and critical=2. Then call get_state again.
```

```text
Use the self_regulate_context tool with action compact and profile light.
```

```text
Use the self_regulate_context tool with action new_session.
```

通过标准：

- 没有 extension 加载错误
- 上述 tool action 都能成功执行
- 阈值修改能在后续状态读取中体现
- compaction 路由能执行且不会崩溃
- `new_session` 能触发宿主 `/new` 语义

已观测到的注意事项：

- 在当前 print/非交互链路里，`compact` 和 `new_session` 这类队列型动作可能会出现 `tool_execution_start`，但在同一条事件流里没有稳定观测到对应的 `tool_execution_end`。
- 这更像观测层细节，不应直接判定为失败。建议用宿主 side effect 来验收：
  - `compact`：检查 session 文件里是否出现真实 `compaction` entry，或者 compaction 计数是否增加。
  - `new_session`：检查 session file path 是否切换，并在后续 turn 后落出新的 session 文件。

## B. Script Probe Smoke

目标：

- 验证外部脚本接入链路可用
- 验证受限、定时、结构化的 prompt 字段流动

建议的临时脚本：

```bash
TMP_SCRIPT="$(mktemp)"
cat > "$TMP_SCRIPT" <<'EOF'
#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  status: "normal",
  reason: "manual smoke",
  promptData: {
    smoke_channel: "manual",
    smoke_counter: 1
  }
}))
EOF
chmod +x "$TMP_SCRIPT"
```

建议的程序化接线示例：

```ts
import { createAgentStateSelfRegulationExtension } from "@mariozechner/pi-agent-state-self-regulation";

const extension = createAgentStateSelfRegulationExtension({
  scriptProbes: [
    {
      id: "manual-smoke",
      command: [process.env.TMP_SCRIPT!],
      timeoutMs: 500,
    },
  ],
});
```

检查项：

- [ ] 加载一个简单的 script probe
- [ ] 验证 `get_state` 仍可正常执行
- [ ] 验证 script probe 不会破坏正常 prompt 流程
- [ ] 验证脚本可以返回结构化 prompt 字段
- [ ] 验证脚本输出保持有界，不会导致崩溃
- [ ] 验证脚本失败或超时时，不会把整个 extension 弄挂

通过标准：

- script probe 成功执行时不会破坏 session
- script probe 失败时能安全降级
- 不会把未限制的原始命令输出直接注入 prompt

## C. 独立包 Build 与 Pack Smoke

目标：

- 验证独立包构建产物
- 验证 tarball 结构
- 验证宿主后续能够加载安装后的包路径

构建与打包：

```bash
cd "$PKG"
npm run clean
npm run build
npm pack
```

检查项：

- [ ] 成功生成 `dist/index.js` 和 `dist/extension.js`
- [ ] `npm pack` 成功
- [ ] tarball 中包含 `dist`、`docs`、`README.md`、`CHANGELOG.md`
- [ ] 打包后的包仍暴露 `./extension`

可选的 tarball 检查：

```bash
tar -tzf "$PKG"/mariozechner-pi-agent-state-self-regulation-*.tgz
```

通过标准：

- build 无报错完成
- tarball 结构符合 `package.json` 中的 `files` 和 `exports`

## D. 安装后包加载 Smoke

目标：

- 验证构建后的包在安装路径下可以正常被宿主加载
- 避免只依赖 monorepo 源码路径完成验证

一种简单做法：

```bash
TMP_DIR="$(mktemp -d)"
cd "$TMP_DIR"
npm init -y
npm install "$PKG"/mariozechner-pi-agent-state-self-regulation-*.tgz @mariozechner/pi-coding-agent
cd "$REPO"
./pi-test.sh --no-extensions -e "$TMP_DIR/node_modules/@mariozechner/pi-agent-state-self-regulation"
```

检查项：

- [ ] 安装后的包路径能直接加载，不需要手工改源码
- [ ] 宿主能通过包 manifest 或包根发现这个 extension
- [ ] 从安装包路径加载时，`get_state` 可用
- [ ] 从安装包路径加载时，`compact` 可用
- [ ] 从安装包路径加载时，`new_session` 可用

通过标准：

- 安装包路径的行为与源码路径基本一致
- 不会出现 `dist` 缺失或 `exports` 配置错误

已观测到的注意事项：

- 这一轮已经从 `node_modules/@mariozechner/pi-agent-state-self-regulation` 的安装包路径通过。
- `get_state` 已直接在 print 模式下验证通过。
- `compact` 和 `new_session` 通过宿主 side effect 验证：
  - 安装包路径下的 `compact` 已生成真实 `type:"compaction"` 的 session entry。
  - 安装包路径下的 `new_session` 已切到新的 session 文件，并把后续 turn 持久化到了新文件中。
- 如果你准备在另一台机器上直接从仓库 checkout 做外部宿主测试，需要先构建这个包的 `dist`，或者改用已打好的 tarball。

## E. 外部宿主兼容性 Smoke

目标：

- 验证在 monorepo 外部宿主中的兼容性
- 把“打包正确”与“宿主生命周期兼容”分开验证

推荐目标：

- 一个声称兼容标准 `@mariozechner/pi-coding-agent` extension 的外部宿主

检查项：

- [ ] 在外部宿主中安装已发布或已打包的包
- [ ] 确认宿主无需 patch 包本身即可加载该 extension
- [ ] 确认 `self_regulate_context` 已注册
- [ ] 确认至少有一次 `get_state` 调用成功
- [ ] 确认 `compact` 不会因为 lifecycle 不兼容而失败
- [ ] 确认 `new_session` 行为符合预期，或在宿主不支持时能明确失败

通过标准：

- 没有生命周期不兼容阻塞基础功能
- 若有兼容性问题，能够得到具体、可执行的定位结论

## F. 发布就绪总结

达到发布就绪的基线：

- [x] 本地源码态联调通过
- [x] Script probe smoke 通过
- [x] 独立包 build 和 pack smoke 通过
- [x] 安装后包加载 smoke 通过
- [ ] 至少一个外部宿主兼容性 smoke 通过

如果以上都通过，这个包就不再只是“单元测试全绿”，而是同时完成了集成验证和打包验证。
