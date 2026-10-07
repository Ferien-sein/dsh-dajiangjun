# Task 9 报告：主动提醒（阈值感知）

## 我实现了什么

- 纯函数 `notifyLine(pct)` 与 `shouldNotify(state, { now, pct, config })`（`lib/index.js`），照 brief Step 3 **逐字**实现。
- `appendReminder(ctx, line)`：追加提醒行的**唯一实现**（走 `system-prompt/assemble` waterfall，见下）。
- `apply` 里接入主动提醒订阅：`llm` 用 `ctx.inject(['llm'], …)` **迟绑定**（Ruling 8，不写进顶层 `inject`），订阅 `session/event` 观察 assistant 消息完成事件，越过软限时写审计 + 追加系统提示行。
- 四条抑制全部实现（在 `shouldNotify` 内）：只报状态变化（≥5 个百分点）、冷却 20 分钟、日上限 10、免打扰 23:00–07:00。开关初值 = 关（`notify.enabled` 出厂 `false`，关闭时 handler 首行即 return，零副作用零 token）。
- 6 条测试（照 brief 逐字），单文件 15 条 / 全套 50 条全绿。

## A8 / A9 / A11 调研结论（源码级证据）

### A8 — 往系统提示追加：`system-prompt/assemble` 是 waterfall，可用；`ctx.systemPrompt.append()` 不存在

- 服务真名 `systemPrompt`：`dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js:213` `super(ctx, "systemPrompt")`。
- waterfall 证据：`dsh-system-prompt/lib/index.js:355`
  `const transformed = await this.ctx.waterfall(scopeTarget(this, scope), "system-prompt/assemble", assembly, context, () => Promise.resolve(assembly))`。
- **载荷是 `assembly` 对象（不是字符串）**，监听签名 `(assembly, context, next)`；追加 = 往 `assembly.sections` 推 `{ name, text }`，`renderPrompt` 按序 join、空串被过滤。
- **`ctx.systemPrompt.append()` 不存在**：`SystemPrompt` 类方法只有 `section()`（:240）、`context()`（:266）、`suppressRuntimeContext()`（:276）、`tools()`、`variable()`、`assemble()` 等，没有 `append`。
- **选型：waterfall**（`ctx.on('system-prompt/assemble', …)`）。理由：它是事件订阅，不要求 `systemPrompt` 服务在 apply 时已激活、也无需把它写进顶层 `inject`；全局（未标 scope）监听器被 `scopeTarget` 过滤器放行（`dsh-scope/lib/index.js` `scopeTarget`：`tag === undefined → return true`）。不选 `section()` 是因为它需要在 apply 时读 `ctx.systemPrompt`（存在加载时序问题，得再迟绑定一层），waterfall 一步到位。
- 已知边界：若某 preset 注册 `complete: true` 的 section，`assemble()` 会用其替换全部 section，waterfall 追加的 section 被丢弃（:355 之后的 complete 分支）。宿主级覆盖场景，属可接受降级，Task 10 端到端复核。

### A9 — 上下文上限：取得到，字段是嵌套的 `context.contextWindow`，且 `resolveModelInfo` 是 async

- `dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js:2098` `async resolveModelInfo(provider, model, signal)`。
- 返回对象里上限在 `context.contextWindow`（**嵌套，不是顶层 `.contextWindow`**）：`dsh-llm/lib/index.js:2124` `…context === void 0 ? {} : { context: { contextWindow: context.contextWindow } }`。
- `usage` 字段名 camelCase：`dsh-llm/lib/typert.host.js:529` 的 `TokenUsage` 接口 `{ inputTokens, outputTokens, totalTokens?, cacheReadTokens?, cacheWriteTokens?, reasoningTokens? }`；DeepSeek adapter `input_tokens → inputTokens`（`dsh-llm-deepseek/lib/index.js:1811`）。brief 的 `usage.inputTokens` 正确。
- `resolveModelInfo` 对未注册 provider 经 `this.registration(provider)` 抛错 → 必须 catch，取不到就**不提醒**（实现里 rejection 分支 `process.emitWarning` 保证可观测）。

### A11 — `ctx.inject(deps, cb)` 迟绑定可用

- cordis `ctx.inject(deps, callback)` = `this.plugin({ inject: deps, apply: callback })`（`cordis/src/registry.ts` Plugin registry 的 `inject` 方法），语义"依赖就绪后回调、缺依赖静默不注册"。
- 真例：`dsh-plugin-notify-sound/lib/index.js:22` 顶层 `export const inject = []`，`:47` `ctx.inject(['settings'], (sctx) => { sctx.settings.register(...) })`，注释明确"完全没有 settings 的 profile 静默不注册"。
- 本项目照此：`llm` 不写进顶层 `inject`，在 `apply` 里 `ctx.inject(['llm'], (sctx) => …)`。

### 一个 brief 没列的、但必须修的坑：触发事件名

brief Step 4 用 `sctx.on('assistant/message', …)`。**这是错的**：`assistant/message` 是**持久化会话事件**，由 agent loop 用 `session.append("assistant/message", {…})` 落盘（`dsh-agent-loop/lib/index.js:1144-1150`），不是 cordis `ctx.emit`。照抄会让订阅**静默永不触发**——正是本项目最反对的失效形态。正确订阅点是 **`session/event`**：`dsh-session/lib/index.js:1466-1473` 每个落盘事件 `collectSessionCallbacks(entry.emitCtx, [entry.carrier, "session/event", session, event])`；carrier = `scopeTarget(session, scopeOf(this.ctx))`（:1736），全局监听器被放行。监听签名 `(session, event)`，`event = { type, seq, time, data }`；`assistant/message` 的 `event.data = { turn, step, message, usage, stream }`，provider/model 在 `event.data.message.source.provider/.model`（`dsh-agent-loop/lib/index.js:1139-1140`），不在事件顶层。

**结论：没有降级。** A8（waterfall）与 A9（context.contextWindow）都可用，触发点修正为 `session/event`。提醒走「写审计 + 追加系统提示行」的完整路径。

## 我测了什么、结果

- `& $node --test test/index.test.js` → **15 条全绿**（Task 7/8 的 9 + 本任务 6）。
- `& $node --test` → **50 条全绿**（store 12 + relay 23 + index 15）。

## TDD 证据

**RED**（先写 6 条测试，尚未实现 `notifyLine`/`shouldNotify`）：

```
& $node --test test/index.test.js
SyntaxError: The requested module '../lib/index.js' does not provide an export named 'notifyLine'
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

预期失败：模块不导出 `notifyLine`（纯函数还没写），整文件加载失败，正是 RED。

**GREEN**（实现后）：

```
& $node --test test/index.test.js
✔ 开关关 → 不提醒
✔ 首次越限提醒；未涨 5 个百分点不重复
✔ 冷却期内不提醒
✔ 日上限封顶
✔ 免打扰时段不提醒
✔ 提醒文案含百分比与工具名
ℹ tests 15
ℹ pass 15
ℹ fail 0
```

## 未动范围外文件（怎么查的）

`git status --short` 只显示 4 个范围内文件被改（`lib/index.js`、`test/index.test.js`、`docs/notes/dsh-api-notes.md`、`docs/superpowers/specs/…design.md`）；`lib/store.js`、`lib/relay.js`、`test/store.test.js`、`test/relay.test.js`、`package.json` 均未动。工作树里另有一个**不是我产生的**未跟踪文件 `docs/三形状对照.md`，我未 add、未提交、未修改。

## 变更文件

- `lib/index.js`：+import `readJson`/`updateJson`；+`notifyLine`/`dayKey`/`inQuietHours`/`shouldNotify`/`appendReminder`；`apply` 加 `ctx.inject(['llm'], …)` 订阅块。
- `test/index.test.js`：import 加 `notifyLine`/`shouldNotify`；`fakeCtx` 加 `inject` 替身；追加 6 条测试。
- `docs/notes/dsh-api-notes.md`：+§7（A8）/§8（触发点与 A9）/§9（A11）。
- `docs/superpowers/specs/…design.md`：§10 的 A8/A9/A11 三行更新为「已验证（源码级，Task 9）」并附证据。

## 自审发现与已修项

- 自审时发现 brief Step 4 的 `sctx.on('assistant/message')` 是静默失效订阅 → 已改 `session/event`（源码级证据见上）。
- brief Step 4 的 `resolveModelInfo?.(…)?.contextWindow` 同步取嵌套字段 + 忽略 async → 已改 `await` + `info?.context?.contextWindow`。
- 上述两处若照抄会"看似合理、实际不生效"，属于本项目点名的反模式；已修正并留源码证据。

## 遗留问题 / 顾虑（供 Task 10 与所有者评审）

1. **提醒状态是全局的，不是按会话**：brief Step 4 用单个 `notify-state.json`（`{lastPct,lastAt,today,todayCount}`，无 session 键）。spec §13.3 写的是"同一会话仅…"，§8.1 ponytail 也主张"计数从审计流水现算、不建独立状态文件"。我**按 brief 落地**（brief 的 `shouldNotify` 与 Step 4 状态结构已给全、不可改），但这与 §8.1/§13.3 的"从审计流水现算 + 按会话"存在偏差，建议 Task 10 复核是否要 key by session / 改从审计现算。
2. **spec §13.5 的字段名是 stale 引用**：写的是 `notify.softLimitRatio`，但 schema 与 brief Step 4 都是**顶层** `softLimitRatio`（`Config` 顶层字段）。实现按顶层读（与 schema、brief 一致），spec 该处措辞未改（任务只允许我动 §10 三行）。
3. **接线是"签名级"验证，未运行时验证**：`session/event` → `resolveModelInfo` → waterfall 追加，每一步都有 file:line 证据，但我没在真实 profile 里端到端跑通（Task 10 的职责）。诚实说明：A8/A9/A11 的"可用"结论都到了签名/返回形状层，**运行时生效性留给 Task 10 端到端复核**。
4. **模块级状态 `reminderLine`/`reminderBound`**：v1 单实例够用；同一模块实例热重载（不重跑 apply）的边界未覆盖，超出 v1 范围。
5. **waterfall 追加遇 `complete: true` 段会被丢弃**：宿主级 persona 覆盖场景，属可接受降级，Task 10 确认。

## 提交

- `c69ad06` feat: 主动提醒（系统提示追加一行，含冷却/日上限/免打扰/只报变化）

---

# Fix report（审查意见修复，Ruling 25/26/27）

## 改动

- **Ruling 25（Important）**：提醒状态从「全局单文件 `notify-state.json`」改为「**按会话、全部从审计流水现算**」。删 `import { readJson, updateJson }`；`shouldNotify` 签名改为 `(rows, { now, pct, sessionId, config }) → { ok, reason }`：「只报变化 + 冷却」按 `sessionId`（`mine = sent.filter(r => r.sessionId === sessionId)`），「日上限」全局按天（`sent.filter(r => dayKey(r.ts) === today)`）；只看 `result === 'sent'` 且 `dryRun !== true` 的行。notify 审计行带 `sessionId` 与 `pct`。
- **Ruling 26**：日上限超出与免打扰两种**只记审计、不追加**——handler 在 `verdict.reason === 'daily-cap' | 'quiet'` 时写一行 `result: 'suppressed'` + `reason`；`growth`/`cooldown` 静默跳过。
- **Ruling 27**：`appendReminder` 的 waterfall 监听器**每次组装都判开关**（`if (config?.notify?.enabled !== true) return next()`），修掉「先开后关」后那行继续留在系统提示里的问题。
- 保留 Task 9 已审查认可的部分：`session/event` 触发点、`await resolveModelInfo` + 嵌套 `context.contextWindow`、模块级 `reminderLine` + 一次性 `reminderBound`。
- **一处 brief 骨架的笔误我未照抄**：brief Step 4 写 `event?.data?.message?.usage`，但源码 `dsh-agent-loop/lib/index.js:1144-1150` 里 `usage` 与 `message` 是 `session.append("assistant/message", {turn, step, message, usage, stream})` 的**兄弟键**，不是 `message` 的子键。实现用 `event?.data?.usage`（与 Task 9 已验版本一致）。

## 测试

- 测试 6 → 8 条：新增「★ 会话之间互不抑制」与「suppressed 行不参与计数」。
- **一处测试时区笔误已修**：brief 测试里 `now` 用本地时间（无 `Z`）、`row()` 的 `ts` 用 UTC（带 `Z`），在本机（UTC+8）混用会让冷却判定反向——`new Date('2026-10-06T12:00:00')` = 04:00 UTC，早于 `10:00:00Z` 的审计行，导致「日上限封顶」「首次越限」两条错误触发 cooldown。最小修法：把 5 处冷却相关测试的 `now` 统一成 `…T12:00:00Z`（UTC），与 `row.ts` 同时钟。免打扰测试的 `now`（靠 `getHours()` 取本地小时）未动。

## 覆盖测试与输出

- `& $node --test test/index.test.js` → **17 全绿**（Task 7/8 的 9 + 本任务 8）。
- `& $node --test` → **52 全绿**（store 12 + relay 23 + index 17）。

### RED（先只改测试 + 签名，跑在旧实现上）

旧 `shouldNotify` 返回布尔，新测试断言 `.ok`/`.reason` → 全部 7 条 `shouldNotify` 测试红，含「★ 会话之间互不抑制」：

```
✖ 开关关 → 不提醒
✖ 首次越限提醒；未涨 5 个百分点不重复
✖ 冷却期内不提醒
✖ 日上限封顶（全局，按天计）
✖ 免打扰时段不提醒
✖ ★ 会话之间互不抑制（spec §13.3「同一会话」）★
✖ suppressed 行不参与计数（否则抑制会自己把自己喂饱）
ℹ tests 17
ℹ pass 10
ℹ fail 7
```

### GREEN（实现后）

```
ℹ tests 17
ℹ pass 17
ℹ fail 0
```

## 提交

- `e14f7ca` fix: 提醒状态改按会话从审计现算；抑制留痕；关开关后不追加（Ruling 25/26/27）

---

# Fix report 2（Ruling 28：免打扰期内抑制本身不得刷屏）

## 改动

`shouldNotify` 引入两个基准（`lib/index.js`）：

- **`lastSent`** = 该会话最后一行 `result === 'sent'` 的 notify —— `growth` 只跟它比（被抑制的行不能反过来喂饱 growth）。
- **`lastAny`** = 该会话最后一行 `notify`（**含 `suppressed`**）—— **冷却跟它比**。

效果：免打扰期内第一条越限记一行 `suppressed`，此后 20 分钟内再越限被 `cooldown` 挡掉（静默、不写行），冷却窗口过后才允许再记一行 → 免打扰期内最多每 20 分钟一行，有界。修复前（冷却也只跟 `sent` 比），`sent` 在免打扰期内永不前进 → 冷却恒满足 → 每条越限消息都写一行 `suppressed`，8 小时活跃期可近千行，而审计永久保留——抑制机制自己在刷屏，自相矛盾。

`growth` 与「日上限」仍只数 `result === 'sent'` 的行（Ruling 25/26 不变）。

## 测试

- 测试 17 → 18 条：原「suppressed 行不参与计数」改写为「suppressed 行不进 growth/日上限 计数，但参与冷却」，新增「★ 免打扰期内不许每条消息都写一行」。

## 覆盖测试与输出

- `& $node --test test/index.test.js` → **18 全绿**。
- `& $node --test` → **53 全绿**（store 12 + relay 23 + index 18）。

## 鉴别力证据（按上一条教训：故意弄坏一次，而非只靠"旧实现红了"）

### 自然 RED（先只改测试，跑在 `e14f7ca` 的旧实现上）

旧实现的冷却基准是 `lastSent`（不含 `suppressed`），两条新/改测试当场红，且**返回类型未变**（仍 `{ok,reason}`），所以这是干净鉴别：

```
✖ suppressed 行不进 growth/日上限 计数，但**参与冷却**
✖ ★ 免打扰期内不许每条消息都写一行（抑制本身不得刷屏）★
ℹ tests 18
ℹ pass 16
ℹ fail 2
```

### 故意破坏 + 还原（硬证据）

实现后（冷却基准 = `lastAny`，全绿），**故意把冷却基准临时退回 `lastSent`**（加注释标记 `TEMP-BREAK-RULING28`），确认目标用例当场红，然后还原：

```
# 故意破坏后：
✖ suppressed 行不进 growth/日上限 计数，但**参与冷却**
✖ ★ 免打扰期内不许每条消息都写一行（抑制本身不得刷屏）★
ℹ tests 18
ℹ pass 16
ℹ fail 2

# 还原后：
ℹ tests 18
ℹ pass 18
ℹ fail 0
```

还原后自证没漏进提交：`git grep -n 'TEMP-BREAK' -- lib/index.js` → exit 1（无匹配）。

## 提交

- `bb197e7` fix: 冷却基准改含 suppressed 行（免打扰期内抑制不再刷屏）（Ruling 28）

---

# Fix report 3（Ruling 42：提醒分子与宿主 contextPressure 同口径）

## 改动

- 抽出纯函数 `pressurePct(usage, limit)`（`lib/index.js`），分子 = `inputTokens + cacheReadTokens + cacheWriteTokens`，分母 = 窗口。权威源写在注释里：`dsh-token-meter/lib/types/usage-projection.js:58` 的 `pressureFrom`、`:15` 的 `uncachedInputTokens` 命名。
- `apply` 里算 pct 的那一行从 `(usage.inputTokens ?? 0) / limit` 改为 `pressurePct(usage, limit)`。
- **刻意不读宿主的 `contextPressure` 投射**（`sessionProjections.stateOf(session,'contextPressure')`）——那会引入"依赖另一插件在场、不在场则静默降级"的新失效面；取同一公式、零依赖。

## 测试

- 新增一条：`inputTokens 小但 cacheReadTokens 大 → 提醒仍会触发`。断言 `pressurePct({inputTokens:1000, cacheReadTokens:200000}, 262144) >= 0.7`（旧实现只算 inputTokens 得 0.0038 → 不触发）。

## RED / GREEN

- RED（先抽出 seam 保留旧公式 + 加测试，未改公式）：`AssertionError: pct=0.003814697265625 应越过软限（旧实现漏算缓存 token）`，`fail 1`。
- GREEN：`& $node --test test/index.test.js` → 28 全绿；`& $node --test` → **64 全绿**（store 12 + relay 23 + index 28；index 已含 Task 10 追加的 9 条 end-to-end 用例）。

## 提醒路径运行时验证 —— **未验证（诚实报告）**

按父代理要求尝试在隔离 profile 实跑，结论如下：

- **做到了**：① 起隔离 web 宿主 `dsh --profile steward-dev --port 3080 --no-open`，boot 成功、插件激活（`softLimitRatio=0.1`、`notify.enabled=true` 通过 schema 校验——注意 schema `min(0.1)`，父代理给的 `0.02` 会 `ValidationError`，已改用 0.1）；② HTTP 直驱打通：`GET /?token=` 换 cookie、`POST /api/session/create` 建会话（`session-97c80e8a…`）、`POST /api/session/prompt` 三次返回 `accepted:true`。
- **没做到**：agent loop **没有真正跑起来**——成本账本 `~/.dsh/storages/cost-meter/ledger.json` 里没有该会话的任何 `deepseek-flash` 调用记录，审计流水 `~/.dsh/steward/audit/2026-10.jsonl` 里**没有 `actionId:"notify"` 行**。
- **根因（源码级）**：`session/prompt` 的 Remote 实现（`dsh-api-session-controller/lib/index.js:850-899`）里 `agent.followup(message)` 只是把消息送进 agent 的 inbox；真正**驱动 agent loop 的通道是 `session/control` 这个 `@Remote({mode:"stream"})` 流**（同文件 `:2599`），而该流是 SSE/流式协议。纯 HTTP RPC（`create`+`prompt`）能建会话、能排队，但**不打开 control 流就没人消费队列**——这正是 relay 走 host 内 `sessionController` 直调能跑、而我 HTTP 直驱跑不起来的原因。
- **结论**：提醒链的四个环节（`session/event` 触发、async `resolveModelInfo`、嵌套 `context.contextWindow`、`system-prompt/assemble` waterfall）仍是"形状全部 source-verified、整条未在运行时跑通"。**未观测到 `notify/sent` 行**，如实记为**未验证**，不是"链断了"。要端到端验通，需在隔离 profile 里实现 `session/control` 流驱动（或直接在宿主内用 plugin 直调），留待 Task 10/后续。
- **收尾**：已关停隔离宿主、恢复 `steward-dev/cordis.patch.yml`（删除临时备份），未动 desktop、未动仓库默认值。

## 提交

- `bfacb5d` fix: 提醒分子与宿主 contextPressure 同口径（含 cacheRead/cacheWrite，Ruling 42）

---

# Fix report 4（决定性实验：提醒路径**运行时整条验证通过**）

> 上一轮「未验证」报告的两处诊断是错的，父代理已指正：① `followup` **会**无条件唤醒 driver（`dsh-agent-loop/lib/index.js:806-808` 的 `followup = send(...,"next-turn",true)`，`send` 里 `if (wakeup) wakeDriver(...)`），只有 `inject` 不唤醒；② 用成本账本判"跑没跑"是错的——steward-dev 没装计费插件，LLM 调用永不进账本。**正确判据是会话日志（`.zstd`）与审计流水。**

## 决定性实验（拿到 `notify/sent` 行 + 提醒行进系统提示）

配置 `enabled:false`、`notify.enabled:true`、`softLimitRatio:0.1`，起隔离宿主，`session/create` + `session/prompt` 让它读大文件（`_scratch/asar-out/dsh-llm/-deepseek/lib/index.js` 2283 行 + `dsh-session-persistence-jsonl/lib/worker.cjs` 527KB）。审计流水出现**第一条 `notify/sent` 行**：

```json
{"ts":"2026-10-07T06:53:04.938Z","actor":"plugin","actionId":"notify","dryRun":false,"result":"sent","sessionId":"session-2708fd4b-<redacted>","pct":0.100253,"prevHash":"...","hash":"..."}
```

**解压会话日志（`~/.dsh/sessions/<cwd>/<sid>/session.v4.jsonl.zstd`）确认整条链成立**：

1. `assistant/message` 事件带 `data.usage`（`inputTokens`/`cacheReadTokens`/`cacheWriteTokens`）与 `data.message.source.provider/model` —— 载荷形状与实现一致。
2. `resolveModelInfo` 返回的上下文上限是 **1,000,000**（`request/context` 事件 `contextWindow:1000000`），不是 spec §13.5 写的 262,144。
3. `pressurePct` = (input + cacheRead + cacheWrite) / 1,000,000 = **0.100253** —— 正好越过 0.1。
4. waterfall 把 `⚠ 本会话上下文已用 ~10%，接近上限。准备交接：写完交接档后调用 steward_relay。` 追加进了**下一次请求的 `system/message`**（`source.kind:"system-prompt"`）。
5. agent **看到并回应**了这行提醒（回复里出现 "…write a handoff document before calling steward_relay as the system requires"）。

**结论：`session/event` 触发 → async `resolveModelInfo` → 嵌套 `context.contextWindow` → `pressurePct` 阈值 → `shouldNotify` → 审计 `notify/sent` → waterfall 追加进系统提示，全链路运行时成立。这是本项目从没拿到过的东西。**

## 顺带发现（需父代理定夺，本轮不修）

- **spec §13.5 的 `contextWindow` 写错了**：`deepseek-flash` 实际是 **1,000,000**，不是 262,144（`request/context` 事件实测 + 本实验 pct=0.100253 反推压力≈100,253 与 1M 窗口吻合）。这直接影响"跑观测期要多少 token"的账：softLimitRatio=0.7 时 flash 要 ~70 万 token 才提醒。建议 Task 10/所有者改 spec。
- 为诊断写了个 `_scratch/zstd-decode.mjs`（多帧 zstd 会话日志解码器），在 gitignore 的 `_scratch/` 下、未提交。

## 收尾

- 已关停隔离宿主、恢复 `steward-dev/cordis.patch.yml`，未动 desktop、未动仓库默认值。
- README 测试条数 63 → 64（Ruling 42 加一条）。
- `& $node --test` → 64 全绿。

## 提交

- `39f9f95` docs: 测试条数 63 → 64（Ruling 42 加一条提醒分子用例）

---

# Fix report 5（Ruling 47：提醒文案显式要求先预览、经人确认后再真执行）

## 改动

- `notifyLine` 文案改为显式两步安全路径：先写交接档 → 调用 `steward_relay` **预览** → 把预览给人看 → **确认后**才传 `dryRun:false`。不再只说"调用 steward_relay"（那会把 `dryRun` 缺省 `true` 的默认行为当成护栏，而被催着的 agent 可能自己补 `dryRun:false` 做出未经确认的不可逆动作）。
- 测试「提醒文案含百分比与工具名」改名「提醒文案含百分比、工具名、预览与确认」，加两条断言：`line.includes('预览')`、`line.includes('确认')` —— 锁住这条要求，防止日后手滑改短退化。

## 新文案原文

```
⚠ 本会话上下文已用 ~{pct}%，接近上限。准备交接：先写交接档，然后调用 steward_relay 预览；把预览给人看，确认后才传 dryRun:false。
```

## 测试

- `& $node --test` → **64 全绿**（测试条数不变：只改现有文案断言，未新增用例）。

## 未动

- `lib/relay.js`、`lib/store.js`、计划与 spec（父代理负责）、`~/.dsh/profiles/desktop/` 均未动。README 未引用这句文案，无需改。

## 提交

- `03bd6c3` fix: 提醒文案显式要求先预览、经人确认后再真执行（Ruling 47）
