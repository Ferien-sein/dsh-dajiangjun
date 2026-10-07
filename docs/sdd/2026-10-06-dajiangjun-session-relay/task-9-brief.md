### Task 9: `lib/index.js` — §13 主动提醒

**Files:**
- Modify: `lib/index.js`
- Modify: `test/index.test.js`

**Interfaces:**
- Consumes: Task 2 的 `readAudit` / `appendAudit`（**不再用 `updateJson` / `readJson`——通知状态不落独立文件**）
- Produces: `notifyLine(pct: number): string` 与 `shouldNotify(rows, { now, pct, sessionId, config }): { ok: boolean, reason?: string }`

- [ ] **Step 1: 写失败的测试**

```js
import { notifyLine, shouldNotify } from '../lib/index.js'

const ncfg = { enabled: true, cooldownMinutes: 20, dailyCap: 10, growthStepPct: 5, quietFrom: 23, quietTo: 7 }

/** 造一条 `notify` 审计行（shouldNotify 只关心这几个字段）。 */
const row = (ts, pct, sessionId = 's1', result = 'sent') =>
  ({ ts, actionId: 'notify', dryRun: false, result, sessionId, pct })

test('开关关 → 不提醒', () => {
  const v = shouldNotify([], { now: new Date('2026-10-06T12:00:00'), pct: 0.9, sessionId: 's1', config: { ...ncfg, enabled: false } })
  assert.equal(v.ok, false)
})

test('首次越限提醒；未涨 5 个百分点不重复', () => {
  const now = new Date('2026-10-06T12:00:00')
  assert.equal(shouldNotify([], { now, pct: 0.72, sessionId: 's1', config: ncfg }).ok, true)
  const rows = [row('2026-10-06T11:00:00.000Z', 0.72)]
  assert.equal(shouldNotify(rows, { now, pct: 0.74, sessionId: 's1', config: ncfg }).reason, 'growth')
  assert.equal(shouldNotify(rows, { now, pct: 0.78, sessionId: 's1', config: ncfg }).ok, true)
})

test('冷却期内不提醒', () => {
  const now = new Date('2026-10-06T12:00:00')
  const rows = [row('2026-10-06T11:50:00.000Z', 0.70)]
  assert.equal(shouldNotify(rows, { now, pct: 0.90, sessionId: 's1', config: ncfg }).reason, 'cooldown')
})

test('日上限封顶（全局，按天计）', () => {
  const now = new Date('2026-10-06T12:00:00')
  const rows = [
    row('2026-10-06T10:00:00.000Z', 0.70),
    ...Array.from({ length: 9 }, (_, i) => row(`2026-10-06T10:0${i}:00.000Z`, 0.70, `s${i + 2}`)),
  ]
  assert.equal(rows.length, 10)
  assert.equal(shouldNotify(rows, { now, pct: 0.95, sessionId: 's1', config: ncfg }).reason, 'daily-cap')
})

test('免打扰时段不提醒', () => {
  assert.equal(shouldNotify([], { now: new Date('2026-10-06T23:30:00'), pct: 0.9, sessionId: 's1', config: ncfg }).reason, 'quiet')
  assert.equal(shouldNotify([], { now: new Date('2026-10-06T03:00:00'), pct: 0.9, sessionId: 's1', config: ncfg }).reason, 'quiet')
  assert.equal(shouldNotify([], { now: new Date('2026-10-06T07:00:00'), pct: 0.9, sessionId: 's1', config: ncfg }).ok, true)
})

test('★ 会话之间互不抑制（spec §13.3「同一会话」）★', () => {
  const now = new Date('2026-10-06T12:00:00')
  // s1 刚刚提醒过；s2 从未提醒过。s2 的**首次**提醒不得被 s1 的状态吃掉。
  // 这条正是"全局单文件状态"会挂掉的地方，也是本插件常态运行态（源会话与「续」会话并存）。
  const rows = [row('2026-10-06T11:59:00.000Z', 0.85, 's1')]
  assert.equal(shouldNotify(rows, { now, pct: 0.72, sessionId: 's1', config: ncfg }).ok, false, 's1 应被冷却挡住')
  assert.equal(shouldNotify(rows, { now, pct: 0.72, sessionId: 's2', config: ncfg }).ok, true, 's2 的首次提醒被别的会话吞了')
})

test('suppressed 行不进 growth/日上限 计数，但**参与冷却**', () => {
  const now = new Date('2026-10-06T12:00:00Z')
  const rows = [row('2026-10-06T11:59:00.000Z', 0.9, 's1', 'suppressed')]
  // 1 分钟前刚记过一行 suppressed → 本条被冷却挡成 'cooldown'（静默跳过，不再写行）
  assert.equal(shouldNotify(rows, { now, pct: 0.72, sessionId: 's1', config: ncfg }).reason, 'cooldown')
  // 20 分钟后再来：冷却过了，且 growth 只跟 sent 比（没有 sent 行）→ 放行
  const later = new Date('2026-10-06T12:30:00Z')
  assert.equal(shouldNotify(rows, { now: later, pct: 0.72, sessionId: 's1', config: ncfg }).ok, true)
})

test('★ 免打扰期内不许每条消息都写一行（抑制本身不得刷屏）★', () => {
  const quiet = new Date('2026-10-06T23:30:00') // 本地时间，getHours() 用本地
  // 第一条越限：判为 quiet，由 handler 记一行 suppressed
  assert.equal(shouldNotify([], { now: quiet, pct: 0.9, sessionId: 's1', config: ncfg }).reason, 'quiet')
  // 紧接着的第二条：必须被冷却挡成 'cooldown'，而不是再写一行 suppressed
  const rows = [row(quiet.toISOString(), 0.9, 's1', 'suppressed')]
  const next = new Date(quiet.getTime() + 60_000)
  assert.equal(shouldNotify(rows, { now: next, pct: 0.91, sessionId: 's1', config: ncfg }).reason, 'cooldown')
  // 冷却窗口过后才允许再记一行 → 免打扰期内最多每 20 分钟一行，有界
  const after = new Date(quiet.getTime() + 21 * 60_000)
  assert.equal(shouldNotify(rows, { now: after, pct: 0.92, sessionId: 's1', config: ncfg }).reason, 'quiet')
})

test('提醒文案含百分比与工具名', () => {
  const line = notifyLine(0.72)
  assert.ok(line.includes('72%'))
  assert.ok(line.includes('steward_relay'))
})
```

- [ ] **Step 2: 跑测试确认失败**

```powershell
& $node --test test/index.test.js 2>&1 | Select-Object -Last 20
```
Expected: FAIL

- [ ] **Step 3: 实现**

```js
export function notifyLine(pct) {
  return `\u26a0 本会话上下文已用 ~${Math.round(pct * 100)}%，接近上限。准备交接：写完交接档后调用 steward_relay。`
}

function dayKey(date) {
  const d = typeof date === 'string' ? new Date(date) : date
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function inQuietHours(hour, from, to) {
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to
}

/**
 * 只报状态变化 + 冷却 + 日上限 + 免打扰（spec §13.3）。
 *
 * 状态**全部从审计流水现算**（spec §8.1：同一事实只许一处权威源，不建独立状态文件）：
 * - 「只报状态变化」与「冷却」是**按会话**的 —— spec §13.3 原文就是「**同一会话**」。
 *   用全局单份状态会出事：A 会话的首次提醒会把状态写掉，B 会话的**首次**提醒被
 *   「冷却 + 未涨 5 个百分点」双重抑制掉；共享的日上限还会被 A 耗尽而饿死 B。
 *   而本插件的主线就是会话接力——源会话与「续」会话**并存是它的常态运行态**。
 * - 「日上限」是**全局按天**的（spec 原文「全局每日」）。
 *
 * 只看 `result === 'sent'` 的行：被抑制的行（`suppressed`）不能反过来把自己喂饱。
 */
export function shouldNotify(rows, { now, pct, sessionId, config }) {
  if (config.enabled !== true) return { ok: false, reason: 'disabled' }
  const byTs = (a, b) => String(a.ts).localeCompare(String(b.ts))
  const notify = (rows ?? []).filter((r) => r.actionId === 'notify' && r.dryRun !== true)
  const mine = notify.filter((r) => r.sessionId === sessionId).sort(byTs)
  const lastSent = mine.filter((r) => r.result === 'sent').pop()
  const lastAny = mine[mine.length - 1]

  // growth 只跟**已发出**的提醒比
  if (lastSent && pct - lastSent.pct < config.growthStepPct / 100) return { ok: false, reason: 'growth' }
  // 冷却跟**任何一行 notify**比（含 suppressed）。这是抑制刷屏的关键：
  // 若冷却也只跟 sent 比，免打扰期内 sent 永不前进 → 冷却恒满足 → **每条越限消息都写一行 suppressed**，
  // 审计流水无界增长（8 小时活跃期可近千行，而审计是永久保留的）。抑制机制自己刷屏是自相矛盾的。
  if (lastAny && (now.getTime() - new Date(lastAny.ts).getTime()) / 60000 < config.cooldownMinutes) {
    return { ok: false, reason: 'cooldown' }
  }
  const today = dayKey(now)
  if (notify.filter((r) => r.result === 'sent' && dayKey(r.ts) === today).length >= config.dailyCap) {
    return { ok: false, reason: 'daily-cap' }
  }
  if (inQuietHours(now.getHours(), config.quietFrom, config.quietTo)) return { ok: false, reason: 'quiet' }
  return { ok: true }
}
```

关于 `reason` 的用法：只有 `'daily-cap'` 与 `'quiet'` 两种**要留审计**（spec §13.3 明写「日上限超出**只记审计、不追加**」「免打扰**只记审计、不追加**」）；`'growth'` / `'cooldown'` 是"还没到时候"，静默跳过——否则每条越限的 assistant 消息都会写一行，把审计流水刷爆。

- [ ] **Step 4: 接进 `apply`**

在 `apply` 里加订阅。**`llm` 用迟绑定，不要写进顶层 `inject`**：DSH 的 `inject` 语义是"缺服务则不激活"，为一个可选读操作赌整个插件不激活不划算。本机已发布的 `dsh-plugin-notify-sound` 就是这么写的（`ctx.inject(['settings'], (sctx) => …)`），照这个模式：

**注意两点**：
- **`session/event` 才是 cordis 总线事件**；`assistant/message` 是**持久化会话事件**（走 `session.append`），`ctx.on('assistant/message')` 会**注册成功但永不触发、且不报错**。（Task 9 已实测：`dsh-session/lib/index.js:1466-1473` 派发 `session/event`，而 `dsh-agent-loop/lib/index.js:1144-1150` 只是 `session.append('assistant/message', …)`。）
- **`resolveModelInfo` 是 async，且上限是嵌套字段** `context.contextWindow`，不是顶层。同步取会得到 `undefined` → 静默不生效。

```js
  ctx.inject(['llm'], (sctx) => {
    sctx.on('session/event', async (session, event) => {
      if (config?.notify?.enabled !== true) return
      if (event?.type !== 'assistant/message') return
      const usage = event?.data?.message?.usage
      const source = event?.data?.message?.source
      if (!usage || !source?.provider || !source?.model) return

      let limit
      try {
        const info = await sctx.llm.resolveModelInfo(source.provider, source.model)
        limit = info?.context?.contextWindow
      } catch (error) {
        // 取不到分母就不提醒（不许猜），但必须可观测，不能静默
        process.emitWarning(`steward: 取模型上限失败 ${source.provider}/${source.model}: ${error?.message ?? error}`)
        return
      }
      if (!limit) return

      const pct = (usage.inputTokens ?? 0) / limit
      if (pct < (config.softLimitRatio ?? 0.7)) return

      const home = dshHome()
      const now = new Date()
      const sessionId = session?.id ?? 'unknown'
      const verdict = shouldNotify(readAudit(home, 2, now), { now, pct, sessionId, config: config.notify })

      if (!verdict.ok) {
        // spec §13.3：日上限超出与免打扰**只记审计、不追加**；growth/cooldown 是"还没到时候"，静默跳过
        if (verdict.reason === 'daily-cap' || verdict.reason === 'quiet') {
          appendAudit(home, {
            ts: now.toISOString(), actor: 'plugin', actionId: 'notify', dryRun: false,
            result: 'suppressed', reason: verdict.reason, sessionId, pct,
          })
        }
        return
      }

      appendAudit(home, {
        ts: now.toISOString(), actor: 'plugin', actionId: 'notify', dryRun: false,
        result: 'sent', sessionId, pct,
      })
      reminderLine = notifyLine(pct)
      appendReminder(sctx)
    })
  })
```

**状态不落独立文件**——`notify` 的一切计数都从审计流水现算（spec §8.1/§13.3），保持"同一事实只许一处权威源"。**不要**再引入 `notify-state.json`，也不要 `import { readJson, updateJson }`。

> `reminderLine` 与 `reminderBound` 的具体组织，**沿用你 Task 9 已实现并经审查认可的那个版本**（模块级 `reminderLine` + 一次性绑定，避免每次调用都堆一个监听器）——那比本段骨架更好，不要退回。

`appendReminder` 是**追加那一行的唯一实现**，它怎么追加取决于 A8 的实测结论（见下）。

**`system-prompt/assemble` 与 `ctx.systemPrompt` 二者取一，以 `docs/notes/dsh-api-notes.md` 的实测为准，不可混用**：若 notes 显示 waterfall 可用，则

```js
function appendReminder(ctx) {
  // 注册时判一次开关**不够**：模块级 reminderLine 一旦设过就一直生效，
  // 于是"先开后关"之后那行提醒仍会留在系统提示里——违反 spec §13.4「关闭时零副作用」。
  if (config?.notify?.enabled !== true) return
  if (reminderBound) return
  reminderBound = true
  ctx.on('system-prompt/assemble', (assembly, next) => {
    if (config?.notify?.enabled !== true) return next() // ← 每次组装都判，关掉即不再追加
    const out = next()
    if (out === undefined) return undefined
    out.sections.push({ content: reminderLine })
    return out
  })
}
```

追加的**具体形状**（往 `assembly.sections` 推一个 section、由 `renderPrompt` join）以你 Task 9 已实现并经审查认可的版本为准；这里只强制一点：**waterfall 内部也必须检查开关**。

> 已知天花板（Task 9 实测）：若某个 preset 注册了 `complete: true` 的 prompt section，`assemble()` 会用其替换全部 section，我们追加的那行会被静默丢弃。这是 provider 侧语义，接受它并留待 Task 10 端到端复核。

否则用 `ctx.systemPrompt?.append?.(line)`。**若两条路都走不通**，把提醒降级为"只写审计 + 工具返回值"，并在报告里说明——不要留一个静默不生效的订阅。


- [ ] **Step 5: 跑测试确认通过**

```powershell
& $node --test 2>&1 | Select-Object -Last 25
```
Expected: PASS。

- [ ] **Step 6: Commit**

```powershell
& $git -C '<repo>' add lib/index.js test/index.test.js
& $git -C '<repo>' commit -m "feat: 主动提醒（系统提示追加一行，含冷却/日上限/免打扰/只报变化）"
```

---

