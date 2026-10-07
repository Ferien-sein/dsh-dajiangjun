# Task 10 报告：端到端（隔离 profile，含失败注入）+ 上 desktop

## 状态：BLOCKED（端到端无人值守未跑通；Step 5 未执行）

## What I implemented

- `README.md`（新建）：一句话是什么、怎么装（`dsh plugin --profile <p> add <path>`）、`Config` 字段表（含"出厂全关"）、工具签名与 dryRun 语义、红线 R-1、以及"兼容 DeepSeek Harness / 构建于 DeepSeek Harness 之上，不代表官方背书"声明。
- `lib/types/index.d.ts`（新建）：按 brief 逐字写死。
- `docs/superpowers/specs/...design.md` §10（修改）：A1/A2/A4/A5/A6/A8/A9 标"未验证"，新增 §10.1 端到端实测小节。

## 端到端：跑到哪一步、原始输出

**结论：headless 路线不可用，真链未能无人值守跑通。** 以下是实测链路与原始输出。

1. **安装进隔离 headless profile（成功）**
   ```
   $ dsh plugin --profile headless add '<repo>'
   dependencies:
   + dsh-dajiangjun link:<repo>
   Already up to date
   Done in 601ms using pnpm v11.7.0
   ```
   `--dump-config` 确认配置树出现插件行：
   ```
   # == dsh-dajiangjun
   - id: dajiangjun
     name: dsh-dajiangjun
   ```

2. **headless 默认模型路由缺凭证（首次卡点，已定位）**
   ```
   $ dsh headless "Reply with exactly the single word PONG and nothing else."
   dsh: MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official";
        store DEEPSEEK_API_KEY ... or export DEEPSEEK_API_KEY in the launching environment
   ```
   原因：headless 的 `agent-default-model` 走 `deepseek-official`（API-key 路由），本机无 `DEEPSEEK_API_KEY`、凭证服务里也没有该路由的 key。

3. **用 `--patch` 把模型路由切到 `deepseek-account`（本机已登录的账户，与 desktop 同款）后，headless 能跑 LLM**
   ```
   $ dsh headless --patch _scratch/headless-model-override.yml "Reply with exactly the single word PONG and nothing else."
   PONG
   dsh: warning: 1 entry did not activate
   dajiangjun (dsh-dajiangjun): pending (waiting for service: sessionController)
   ```

4. **真正的卡点：插件不激活**
   即使模型可驱动，`dajiangjun` 仍 `pending (waiting for service: sessionController)`。核查配置树：
   - headless 树里**没有** `@deepseek-ai/dsh-api-session-controller`（`sessionController` 服务）；
   - 对照 `steward-dev`（web app profile）**有** `@deepseek-ai/dsh-api-session-controller`；
   - 该包元数据 `dsh.client.platform: "web"`、`dsh.client.external: ["@deepseek-ai/dsh-api-gateway/client"]`、`dsh.client.inject: ["@deepseek-ai/dsh-api-gateway", "@deepseek-ai/dsh-client-file-upload"]`，且描述为 "Session Remote commands, cold reads, and live control transport"——即 **web 客户端，经 HTTP gateway 走**；
   - headless 的 runner 文档自述 "without Host, HTTP, or browser plugins"，是 one-shot agent 驱动器，驱动单会话到 quiescence 后退出，**没有常驻 HTTP host、也没有让新会话自开工的 agent-loop**。

   → 插件顶层 `inject` 硬依赖 `sessionController`，故 `apply` 从未执行，`steward_relay` 工具**从未注册**。真链（建会话 / 投递 / 新会话自开工）在 headless 下**架构上不可达**。

**四条 Expected 达成情况（全部"未验证"）**：
- 预览返回 `kind: 'preview'` 且无新会话 —— **未验证**（工具未注册，无法调用）
- 真执行返回 `kind: 'dispatched'` —— **未验证**
- 出现标题 `【续】<主线名>` 的新会话 —— **未验证**
- 该新会话自己开始跑（running + assistant 产出）—— **未验证**（v1 的存在理由，仍缺实跑证据）
- `~/.dsh/steward/audit/<当月>.jsonl` 多一行 `result: 'dispatched'` —— **未验证**

## 三条失败注入各自的结论

全部**未验证**。根因一致：headless 里 `steward_relay` 工具从未注册，任何注入都无从触发；而注册工具唯一需要的非交互路线就是 headless。未用改代码/打桩/构造返回值伪造任何一条。

| # | 注入 | 结论 |
|---|---|---|
| 1 | 投递前杀进程 | **未验证**——需先能跑到 create() 之后、prompt() 之前，但工具根本未注册 |
| 2 | `docPath` 指向不存在的文件（brief 必做） | **未验证**——走 rejection 分支、零副作用，理论上最容易，但同样需要工具先注册，headless 注册不了 |
| 3 | 只读档位会话里调用 | **未验证**——需能指定沙箱档位起会话，headless 无此能力 |

## headless 路线是否可用

**不可用。** 卡点不是凭证（已通过 `--patch` 切 `deepseek-account` 绕开），而是**架构性**：headless profile 不提供 `sessionController` 服务（`@deepseek-ai/dsh-api-session-controller`，web 客户端，需常驻 HTTP host），而本插件顶层 `inject` 硬依赖它 → 插件 `pending` 不激活 → 工具不注册。且即便强塞该服务，headless 也没有让"新会话自开工"的 agent-loop（A4 的存在理由）。这需要 web/desktop 宿主，即人肉 GUI，超出"无人值守"范围。

## Step 5 是否执行

**未执行。** 按 Task 10 额外门：Step 2 未跑通，不把未经验证的插件装进使用者正在用的 desktop 宿主。**未对 `~/.dsh/profiles/desktop/cordis.patch.yml` 做任何改动、也未做备份**（无此需要）。

> 副作用说明（都在隔离/临时区，未碰 desktop）：`dsh plugin --profile headless add` 初始化了 `~/.dsh/profiles/headless/` 并写入 `dsh-dajiangjun` 依赖；`_scratch/headless-model-override.yml`（gitignored）为临时模型补丁。另 `dsh headless` 两次冒烟各消耗了一次 DeepSeek 账户请求。

## spec §10 更新了哪几行

- A1/A2/A4/A5/A6 的"验证方式"列：追加"**未验证**（见 §10.1）"。
- A8/A9：追加"；**端到端未验证**（见 §10.1）"（保留 Task 9 的源码级验证结论）。
- 新增 §10.1 "端到端实测（Task 10，2026-10-06）"：记录 headless 卡点、三条注入全未验证、Step 5 未执行。

## What I tested and results

全套 53 测试仍绿（`& $node --test`，未用目录形式）：
```
ℹ tests 53
ℹ pass 53
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1013.5939
```

## Confirmation that no code file was modified

确认。`git status` 仅：
- `M docs/superpowers/specs/2026-10-06-dajiangjun-session-relay-design.md`
- `?? README.md`
- `?? lib/types/`（新 `.d.ts`）

`lib/*.js` 与 `test/*.js` **零改动**。提交 `4dea3af` 只含 README、类型声明、spec 三个文件。

## Self-review findings

- README 六项必含全齐；类型声明与 brief 逐字一致。
- 每条"通过"均有原始输出（53 测试、plugin add、PONG、activation warning、两 profile 配置树对照）。
- 无一处"推断能行"代替"看到行"；未跑成的一律标"未验证"。
- 未动代码文件；Step 5 未执行。

## Issues / concerns

1. **这是 v1 的架构性缺口，不是本任务能就地修的**：端到端验收依赖 `sessionController` + 让新会话自开工的 agent-loop，二者只在 web/desktop 宿主存在。若控制方希望"无人值守可复现端到端"，需要另起方案（例如：给 headless 补一个真实 session controller 与常驻 runner，或改用桌面宿主的 HTTP API + 令牌驱动隔离 web profile），这是需要裁定的事，我不擅自搭桩。
2. `dsh plugin --profile headless add` 与两次 `dsh headless` 冒烟各消耗了一次账户额度（微量），如实登记。
3. 插件 `inject` 硬依赖 `sessionController` 导致它在 headless 连"预览/rejection"分支都注册不出来——若将来想让 headless 至少能测 rejection 分支，需把 `sessionController` 变成可选依赖（属代码改动，留待控制方裁定）。

---

# Fix Report（Ruling 30 / 31 追加）

## Ruling 30：README 补「依赖与适用范围」+ 笔记耐久化

- `README.md` 新增「依赖与适用范围」节：点名硬依赖 `ctx.sessionController`、**不适用于 headless**、装进 headless 的**静默失效**形态（`pending (waiting for service: sessionController)`，工具不出现、不报错）、本机实测证据（headless 无 `@deepseek-ai/dsh-api-session-controller`，steward-dev 有）。
- `docs/notes/dsh-api-notes.md` 新增 §10（headless 卡点）+ §11（web 宿主 HTTP 驱动方法 + `resolveAgent` 返回形状踩坑）。

## Ruling 31：web（steward-dev）路线实测结果

**结论：web 路线可无人值守驱动，但真链在投递前一步因一处代码 bug 中断（BLOCKED，待控制方裁定修复）。**

**鉴权不是卡点**：steward-dev 启动输出打印一次性令牌 `dsh web: http://127.0.0.1:19399/?token=…`；`GET /?token=…`（303）发签名 cookie，后续 `POST /api/session/*` 带 cookie 即 200。对照桌面（401 + Edge web-login 取不到令牌）不同，隔离 profile 的令牌就在启动输出里。

**驱动方法**（已实测，全部 HTTP 200）：Typert RPC `POST /api/session/{create,prompt,list,page}`，请求体 `{"type":"client-request","rpcId","method":"session/<m>","payload":{"args":{…}}}`。`create`→`{sessionId}`，`prompt`→`{accepted:true}`，`list`→`items[]`（含 running/title/turnOutline）。

**真链实测（四条 Expected）**：
| Expected | 结果 |
|---|---|
| 预览返回 `kind:'preview'` 且无新会话 | ✅ 审计行 `result:"preview"`（`dryRun:true`），无新会话 |
| 真执行返回 `kind:'dispatched'` | ❌ 审计行 `result:"failed"` |
| 出现 `【续】<主线名>` 新会话 | ❌ 新会话已建但未及命名 |
| 新会话自己开工（running + assistant 产出） | ❌ 未投递，从未开工 |

审计原文（`~/.dsh/steward/audit/2026-10.jsonl`）：
```
{"result":"preview","dryRun":true,"mainline":"relay-e2e-test","sourceSessionId":"session-52dd0d93…","relayId":"relay-…"}
{"result":"failed","dryRun":false,"mainline":"relay-e2e-test","sourceSessionId":"session-52dd0d93…","relayId":"relay-…","newSessionId":"session-e6f24939…","error":"Cannot read properties of undefined (reading 'header')"}
```

**根因（代码 bug #1，阻断级）**：`lib/index.js` `dispatchRelay` 权限回读断言用 `ctx.sessionController.resolveAgent(sid).session`，但 `resolveAgent()` 返回 `{ agent }` 或 `{ error }` 包装（`dsh-api-session-controller` 源码 `ApiSessionAgentController.resolveAgent`→`resolve`→`liveAgent` 返回 `{ agent }`），`.session` 恒 `undefined` → `sessionProjections.stateOf(undefined,'sandboxMode')` 抛 `reading 'header'`。正确应为 `(await resolveAgent(sid)).agent.session` 并处理 `{ error }`。**属前序任务（Task 8 dispatchRelay）的代码 bug，本任务不改代码，留待控制方裁定。**

## 失败注入

- **#2（`docPath` 不存在）✅ 已复现**：工具返回 `读不到交接档：…`（`gate:'doc'` 分支），**零新会话**。tool/result 事件（seq 20）与审计文件均确认无 `dispatched`。**但发现代码 bug #2（轻微）**：`readFileSync` catch 直接 `return`，**未 `appendAudit`**——与 §5「每道闸留一行审计」不符（对比：档存在但结构不合格那条路径有写审计行）。
- #1（投递前杀进程）、#3（只读源会话）**未验证**：被 resolveAgent bug 挡在投递前，无法复现。

## 测试与代码改动确认

- 全套 53 测试仍绿（`pass 53 / fail 0`）。
- **`lib/*.js` 与 `test/*.js` 零改动**。仅改 README、notes、spec 三份文档，提交 `0544196`。隔离 profile 配置（`~/.dsh/profiles/steward-dev/cordis.patch.yml` 开 `enabled:true` + 切账户模型、package.json 加依赖）属隔离环境，未碰 desktop。

## Step 5

**仍未执行**：真链投递失败（未跑通），按额外门不装 desktop。

## 需要控制方裁定的两处代码问题

1. **阻断级**：`dispatchRelay` 用 `resolveAgent().session`（应为 `.agent.session` + 处理 `{ error }`）。
2. **轻微**：`runRelay` 的 `readFileSync` catch 分支不写审计行（doc 闸缺审计）。

---

# Fix Report 2（Ruling 32/33 授权改代码 + 端到端跑通 + Step 5）

## 改代码（4 处 API 形状 bug，全部 RED→GREEN）

| # | bug | 根因 | 端到端症状 | 回归测试 |
|---|---|---|---|---|
| 1 | `resolveAgent(sid).session` | 返回 `{ agent }`/`{ error }` 包装 | `reading 'header'` | 「权限投影读不到」 |
| 2 | doc 闸 catch 不落审计 | 直接 return | #2 注入零审计行 | 「失败注入 #2…留审计行」 |
| 3 | `sessionTitle.rename(newId, …)` | 第一参应是 session 对象 | `session "undefined" is not live` | fakeCtx rename 校验 |
| 4 | `prompt(req)` 少传 signal | @Remote 方法需显式 signal | `reading 'throwIfAborted'` | fakeCtx prompt 校验 |

**RED 证据**（先改测试不改实现，均红）：#1 `actual:'dispatched' expected:'partial'`；#3 现有「投递必须用 queue」因 rename 抛错失败；#4 同样因 prompt 抛错失败。修实现后全套绿。

## 端到端最终结果：四条 Expected 全过（原始输出）

审计 `~/.dsh/steward/audit/2026-10.jsonl`（mainline `relay-e2e-test4`）：
```
{"result":"preview","dryRun":true,"mainline":"relay-e2e-test4","sourceSessionId":"session-d30614ef…"}
{"result":"dispatched","dryRun":false,"mainline":"relay-e2e-test4","sourceSessionId":"session-d30614ef…","newSessionId":"session-eaf8fa95-<redacted>"}
```
- ① 预览返回 preview、无新会话 ✅
- ② 真执行返回 dispatched ✅
- ③ `session/list` 出现 `title:"【续】relay-e2e-test4"` 的新会话 `session-eaf8fa95…` ✅
- ④ 新会话**自己开工**：`running:true`，`session/page` 抓到持续 `assistant/message` 序列（读档 → 核审计 → 核代码 → 核配置，seq 16→186 仍在跑） ✅

**#1/#3 失败注入未验证**（#1 需精确掐 create↔prompt、#3 需指定只读档位起会话，本机无法无人值守复现）。#2 已复现且修复后落审计行。

## Step 5 已执行（四条 Expected 全过后）

- 备份：`~/.dsh/profiles/desktop/cordis.patch.yml.bak-dajiangjun`（62 行原样）。
- `dsh plugin --profile desktop add '<repo>'`：package.json 加依赖 + `node_modules\dsh-dajiangjun` 符号链接 + pnpm-lock。
- 往 `~/.dsh/profiles/desktop/cordis.patch.yml` **追加**（非覆盖，diff 确认只加了 9 行）：
  ```yaml
  - insert:
      - id: dajiangjun
        name: dsh-dajiangjun
        config:
          enabled: false
          notify:
            enabled: false
  ```
- **出厂全关**。工具在下一次 desktop boot 后才出现（插件代码下次 boot 才加载，notes §5）；当前 live GUI 未重启、未验证工具出现。
- 回退：`Copy-Item cordis.patch.yml.bak-dajiangjun cordis.patch.yml -Force`，或把那行改 `disabled: true`，**不删文件**。

## 诚实登记：第 55 条测试是接力新会话自己加的

全套现为 **55 绿**（53 原 + 1 resolveAgent 回归「权限投影读不到」+ 1「失败注入 #2：docPath 不存在…必须留审计行」）。**最后这条不是控制方或我写的，是端到端里被接力派发出去的新会话自己加的**——它按「继续验证接力链」的指令，发现"doc 闸修复没有单测"这个真实缺口，写了一条正确断言 `reason:'doc-unreadable'` 的回归测试。这是 v1「新会话真的自己开工」的最强旁证（不只是产出文本，还做了正确的实事）；但也意味着**接力的新会话会改 repo**——观测期（只开 notify、不开 enabled）下这条已可控。

## 提交

`1abc337` resolveAgent+doc 闸修复 · `f6c3571` rename+prompt 签名修复 · `f25cd51` spec/notes 文档更新。`lib/index.js`、`test/index.test.js` 的改动都在前两个提交里。

---

# Fix Report 3（Ruling 34：读档必须在闸门之后）

## 修了什么

- `lib/relay.js` 抽出 **`preflightGates({ config, isSubagent })`**（配置不可读 / 总开关 / 调用者三道，无 I/O、无副作用）；`evaluateGates` 首行调用它，**单一实现**（没把三道闸抄两份）。
- `lib/index.js` `runRelay` 在 `readFileSync` **之前**先跑 `preflightGates`，不通过直接返回 `rejected`（exitCode 同闸门）且**不写审计**、**不读档**。
- `test/index.test.js` 改写「总开关关闭时拒且**真正的零副作用**（未读档、未留审计）」：传**不存在**的路径，断言 `gate:'total-switch'`（不是 `doc`）且 `readAudit` 为空。

## RED 证据

只改测试不改实现，跑一次（`node --test test/index.test.js`）：
```
✖ 总开关关闭时拒且**真正的零副作用**（未读档、未留审计）
  AssertionError: 读档发生在总开关之前 → 关闭时仍有副作用
  + actual - expected
  + 'doc'
  - 'total-switch'
```
（正是控制方在活宿主撞出的同一症状：总开关关着却返回 `doc`。）

## 结果

- 全套 **55/55 绿**（那条是改写不是新增，计数不变）。
- **端到端四条 Expected 复验仍全过**（mainline `relay-e2e-test5`）：preview ✅ → dispatched（`newSessionId: session-ac055382…`）✅ → 出现 `【续】relay-e2e-test5` 新会话 ✅ → 新会话 `running:true` 自开工 ✅。主路径未被破坏。

## 活宿主复核：**我（子代理）做不到，需控制方代跑**

我无权访问 live desktop 的工具列表或 HTTP API：我的工具清单里没有 `steward_relay`，且 desktop 宿主对未鉴权请求返回 401、其 `?token=` 是进程生成不落盘（`~/.dsh/web-login` 是 Edge 传输配置，取不到可复用令牌）。所以"HMR 是否已把新代码热更新进运行中的 desktop"我**无法在活宿主里观察**，只能如实报：**这一步待控制方（本就在 live desktop、已看到 steward_relay 工具）自己调一次确认**——若返回 `total-switch` 说明 HMR 已生效，若仍返回 `doc` 则说明需下次 boot 才生效。

## 提交

`8c5727f` fix: preflightGates 在读档前跑（总开关关闭时零副作用）。

---

# Fix Report 4（终审修复轮 Ruling 36-39 — 最终收口）

## Status：完成（4 条 Ruling 全部落实；端到端四条 Expected 全过）

上一实施者在完成前崩了，工作树留了未提交改动（`lib/index.js` / `lib/relay.js` / `test/index.test.js` / `test/relay.test.js`）。我逐条对着 findings 核对（并独立引 asar 内源码核实 Ruling 36 的判据），结论：**4 条改动全部正确，无需推翻；唯一缺口是 README 测试数没改**（Ruling 39 之一），已由我补上。

## 核对结论（每条 Ruling + 我怎么核的）

### Ruling 36（阻断项）—— 改对了，保留

- 实现：`isSubagentCaller` 改为 `exec?.agent?.session?.header?.parentSession != null`（旧 `exec?.parent !== undefined && exec?.parent !== null` 已删）。
- **独立 asar 核实判据**（非仅信 findings）：
  - `dsh-tools/lib/index.js:1306` 与 `dsh-tools/lib/types/ptc.js:439` 均为 `parent: exec.token`——只在 PTC（run_code/workflow）嵌套派发时赋值；
  - `dsh-tools/lib/index.js:1423` 有 `exec.agent?.session.header.cwd`——确认 `exec.agent.session.header` 是 agent-loop 工具调用的真实路径；
  - `dsh-subagent/lib/types/child-agent.js:117` 与 `dsh-subagent/lib/index.js:476` 均为 `parentSession: parentHeader.id`——子会话建会话时把 `parentSession` 写进 session header；
  - `dsh-subagent/lib/index.js:852` 有 `activation.handle.agent.session.header.parentSession`——与判据路径逐字吻合。
  - 结论：`exec.parent` 判子代理是错的，`header.parentSession` 是对的。原改动正确。
- 测试：两条新测试**都经由 `isSubagentCaller` 本身**（`ctx.registered.execute` 喂 `exec.agent.session.header.parentSession` 存在/不存在的两种 `exec`，**不喂布尔**），满足"不许再喂布尔值"的要求。

### Ruling 37（Important）—— 改对了，保留

- `validateDoc` 新增头部含 `主线:` 校验（`/^\s*主线\s*[:：]\s*\S/m`）。
- `resolveMainline` 在 HEAD 本来就返回 `null`（`if (!first || first === '.') return null`），**无需改**；真正的 fail-open 在 `runRelay` 的 `?? ''`，已改为 `?? null` 并在 `if (!mainline)` 处拒绝（`gate:'doc'`、exitCode 5、留审计行）。
- 说明：`if (!mainline)` 是兜底防御——`validateDoc` 现在强制头部含 `主线:`，正常路径走不到这里（`resolveMainline` 必取到非空主线）；但它堵死了 `?? ''` 把 null 吞成空主线的最后一处。该兜底无法经公开工具入口测试（`runRelay` 未导出、且校验保证主线非空），故**无单测**，靠 `validateDoc` 测试钉住可观测行为。

### Ruling 38（Important）—— 改对了，保留

- `dispatchRelay` 先 `resolveAgent(sourceSessionId)` 取 `header.cwd`，再 `create(srcCwd ? { cwd: srcCwd } : {})`（取不到才退 defaultCwd）；注释改成事实（"cwd 与源会话一致"）。
- 补了 4 条测试：建会话传源 cwd、权限降级（可变 `stateOf`）、create 后失败退出码 3、create 失败退出码 1。
- 说明：**权限降级/退出码 3/退出码 1 三条是"补覆盖"不是"修 bug"**——HEAD 的 `dispatchRelay` 逻辑本已正确（降级检查、`exitCode: newId ? 3 : 1` 都在），只是 `fakeCtx.stateOf` 是常量导致降级路径测不到。所以这三条在旧实现下**不会红**（本就是绿的），红证据只有 cwd 那条（见下）。

### Ruling 39（Minor，终审判定必须修）—— 部分已做，README 由我补齐

- `dedupeKey` 定义 + `test/relay.test.js` 未使用 import 均已删 ✓（grep 确认全仓零引用）。
- `lib/index.js` 过时注释（"Task 8 补" 两处、`create({})` 注释）已更新 ✓。
- **README「53 个测试」→ 已改为 62**（原改动没动 README，我补的）。

## RED 证据（每条可复现，均为"临时回退实现→跑对应测试→红→还原"）

### Ruling 36（关键）：子代理判据测试在旧 `exec.parent` 下红

```
$ node --test --test-name-pattern="子代理判据"
✖ 子代理判据：header.parentSession 存在 → 拒（caller，退出码 2）
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  + 'preview'
  - 'rejected'
```
（旧实现 `exec.parent` 对 `{agent:{...}}` 返回 false → 走预览，而测试断言 `rejected`。正是"子代理不会被拦"的假绿。）

### Ruling 37：头部缺主线测试在旧 validateDoc 下红

```
$ node --test --test-name-pattern="头部缺主线"
✖ 头部缺主线 → 拒（spec §4 头部必须含主线）
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual: true
  - expected: false
```
（旧 validateDoc 不查头部主线 → `r.ok=true`，测试断言 `false`。）

### Ruling 38：cwd 测试在旧 `create({})` 下红

```
$ node --test --test-name-pattern="建会话传源会话的 cwd"
✖ 建会话传源会话的 cwd（不靠 process.cwd() 碰巧一致）
  AssertionError [ERR_ASSERTION]: 建会话没传源会话的 cwd → 新会话 cwd 漂到 process.cwd()
  + actual: undefined
  - expected: 'E:/src-cwd'
```
（旧实现 `create({})` 不传 cwd → `createCall[1].cwd` 为 undefined。）

Ruling 38 的三条路径（权限降级/退出码 3/退出码 1）与 Ruling 39（死导出/README/注释）**无红证据**：前者是补覆盖（旧代码已正确），后者是死代码删除与文档改动，无可红的实现分叉。如实说明，未伪造。

## 全套测试

```
$ & $node --test
ℹ tests 62
ℹ pass 62
ℹ fail 0
```
**62/62 绿**（基线 55，上一实施者加了 7 条：R36 两条 + R37 一条 + R38 四条）。

## 端到端四条 Expected（隔离 profile steward-dev，端口 3080，已关停）

改了调用者判据与档校验入口后重跑，**四条全过**。mainline `relay-e2e-r36`，源会话 `session-xxxxxxxx…`，新会话 `session-xxxxxxxx-<redacted>`。

审计 `~/.dsh/steward/audit/2026-10.jsonl`（原始行）：
```
{"result":"preview","dryRun":true,"mainline":"relay-e2e-r36","sourceSessionId":"session-xxxxxxxx-<redacted>","relayId":"relay-session-xxxxxxxx-<redacted>-202610071330"}
{"result":"dispatched","dryRun":false,"mainline":"relay-e2e-r36","sourceSessionId":"session-xxxxxxxx-<redacted>","relayId":"relay-session-xxxxxxxx-<redacted>-202610071331","newSessionId":"session-xxxxxxxx-<redacted>"}
```

四条 Expected：
1. **预览返回 preview、无新会话** ✅ —— 首行 `result:"preview"`、`dryRun:true`；此时 `session/list` 无任何 `【续】` 新会话。
2. **真执行返回 dispatched** ✅ —— 次行 `result:"dispatched"`，`newSessionId:"session-xxxxxxxx…"`。
3. **出现 `【续】<主线名>` 新会话** ✅ —— `session/list` 出现 `session-xxxxxxxx…`，`title:"【续】relay-e2e-r36"`。
4. **该新会话自己开工** ✅ —— `running:true`、`agentAvailable:true`、`asOfSeq:52`（已提交 52 个事件）、`sessionStats:{turns:1,steps:5,llmMs:27367}`（LLM 实跑 27s）、`turnOutline[0].prompt="读交接档 <repo>\_scratch\e2e-final\rel…"`，`session/page`（throughSeq=52）抓到 6+ 条 `type:"assistant/message"` 事件。

**附加验证（顺带坐实 Ruling 38 与 Ruling 36 的端到端效果）**：
- 新会话 `cwd:"<repo>\_scratch\e2e-final"` —— 等于**源会话 cwd**，不是 `process.cwd()`（宿主进程 cwd 是仓库根）。旧实现会漂到仓库根，且新会话会拿到仓库根写权限。
- 主会话（源会话 header 无 `parentSession`）**没有被误判成子代理** —— 接力正常派发，`gate` 没走到 `caller`。

驱动方式：`dsh --profile steward-dev --no-open` 起隔离 web 宿主（端口 3080，桌面占 19387 未碰），启动输出一次性令牌换签名 cookie 后 `POST /api/session/{create,prompt,list,page}`（args 形状：`{request:{…}}`、list 用 `{_request:{}}`、page 用 `{request:{address:{kind:'session',sessionId},throughSeq}}`）。跑完已 `job_kill` 关停，端口 3080 已释放，desktop 宿主（PID 18964）全程未动。

## 提交

`f15b832` fix: 终审 Ruling 36-39 — 子代理判据改 header.parentSession / 档校验补头部主线 / 建会话传源 cwd / 删死导出 dedupeKey（只含 README.md、lib/index.js、lib/relay.js、test/index.test.js、test/relay.test.js 五个文件，120 insertions / 13 deletions）。未动计划与 spec、未动 package.json / cordis.patch.yml、未碰 `~/.dsh/profiles/desktop/`。

---

# Fix Report 5（Ruling 41 — 终审最后一处，判据收紧为 origin==='subagent'）

## Status：完成（分支最后一个未决项已定稿）

R41 是 scoped 复审抓到的 Important 误判：`isSubagentCaller` 用 `parentSession != null` 判子代理**过宽**——fork 也写 `parentSession`（`dsh-api-session-controller/lib/types/commands.js:254` 的 `parentSession: source.header.id`，附近无 `origin`），但子代理才写 `origin:'subagent'`（`dsh-subagent/lib/types/child-agent.js:117` `parentSession` + `:121` `origin:'subagent'`）。宿主自己的判别器是 `origin === 'subagent'`（`dsh-api-session-controller/lib/index.js:126-132` 首行；同包 `commands.js:522` 亦以 `source.origin !== 'subagent'` 判别）。后果：fork 出来的合法调用者会被误判成子代理而**错误拒绝**（功能回归）。

## 修了什么

- `isSubagentCaller` 收紧为 `return exec?.agent?.session?.header?.origin === 'subagent'`，**与宿主判别器逐字一致**；注释写清 fork 与子代理的区别、以及**为什么刻意不写** `parentSession != null && origin === 'subagent'` 这种"更稳"变体（那是同一事实两处口径，宿主一改我们又错一次）。
- 三条调用者测试（**全部经 `ctx.registered.execute(...)` 走 `isSubagentCaller` 本身，不喂布尔**）：
  1. `origin:'subagent'` → 拒（`gate:'caller'`、退出码 2）；
  2. 普通会话（无 origin 无 parentSession）→ 放行（preview）；
  3. **fork 形态（有 parentSession、无 origin）→ 放行（preview）**——本轮核心断言。
- README 测试数 62 → 63。

## RED 证据（fork 测试在旧 `parentSession != null` 实现下红）

```
$ node --test --test-name-pattern="fork 判据"
✖ fork 判据：有 parentSession 无 origin → 放行（走预览）
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  + 'rejected'
  - 'preview'
    actual: 'rejected',
    expected: 'preview',
```
（旧实现把 fork 误判成子代理 → 拒；测试断言放行。改判据后转绿。）

## 全套测试

```
$ & $node --test
ℹ tests 63
ℹ pass 63
ℹ fail 0
```
**63/63 绿**（62 + 1 fork 测试）。

## 端到端四条 Expected（隔离 profile steward-dev，端口 3080，已关停）

判据再动后复验，**四条全过**。mainline `relay-e2e-r41`，源会话 `session-xxxxxxxx…`，新会话 `session-xxxxxxxx-<redacted>`。

审计原始行：
```
{"result":"preview","dryRun":true,"mainline":"relay-e2e-r41","sourceSessionId":"session-xxxxxxxx-<redacted>","relayId":"relay-session-xxxxxxxx-<redacted>-202610071343"}
{"result":"dispatched","dryRun":false,"mainline":"relay-e2e-r41","sourceSessionId":"session-xxxxxxxx-<redacted>","relayId":"relay-session-xxxxxxxx-<redacted>-202610071344","newSessionId":"session-xxxxxxxx-<redacted>"}
```

四条 Expected：① 预览 preview、无新会话 ✅ ② dispatched ✅ ③ 新会话 `title:"【续】relay-e2e-r41"` ✅ ④ 新会话 `running:true` + `agentAvailable:true` + `asOfSeq:48` + `turns:1 steps:4 llmMs:13912` + `session/page` 抓到 5+ 条 `assistant/message` ✅。新会话 cwd = `_scratch\e2e-r41`（=源 cwd，R38 仍生效）。跑完 job_kill 关停、端口 3080 释放，desktop 宿主（PID 18964，占 19387）全程未动。

## 提交

`637b1b3` fix: Ruling 41 — isSubagentCaller 收紧为 origin==='subagent'（fork 不误判）（只含 lib/index.js、test/index.test.js、README.md 三个文件，26 insertions / 9 deletions）。

