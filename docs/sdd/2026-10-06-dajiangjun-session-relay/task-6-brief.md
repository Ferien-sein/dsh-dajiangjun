### Task 6: `lib/relay.js` — 权限序表与闸门判定

**Files:**
- Modify: `lib/relay.js`
- Modify: `test/relay.test.js`

**Interfaces:**
- Consumes: Task 4/5 的 `validateDoc`、`checkForbidden`
- Produces:
  - `MODE_SEQ: Record<string, number>` —— `{ 'read-only': 0, 'workspace-write': 1, 'danger-full-access': 2 }`
  - `permissionOk(sourceMode: string, targetMode: string): boolean` —— 未知档位返回 `false`（fail-closed）
  - `dedupeKey(sourceSessionId: string): string`
  - `makeRelayId(sourceSessionId: string, date: Date): string`
  - `evaluateGates(input): { ok: boolean, gate?: string, reason?: string, code: number }`
    - `input` = `{ config, sourceSessionId, mainline, docOk, forbiddenOk, auditRows, permission: { sourceMode, targetMode } | null, now, isSubagent }`

- [ ] **Step 1: 写失败的测试**

```js
import { MODE_SEQ, dedupeKey, evaluateGates, permissionOk } from '../lib/relay.js'

const cfg = { enabled: true, rateLimitMinutes: 20, failureLimit: 2, notify: {} }
const base = {
  config: cfg,
  sourceSessionId: 'session-src',
  mainline: '大管家',
  docOk: true,
  forbiddenOk: true,
  auditRows: [],
  permission: { sourceMode: 'workspace-write', targetMode: 'workspace-write' },
  now: new Date('2026-10-06T12:00:00Z'),
  isSubagent: false,
}

test('序表：字符串比较会反转，序表不会', () => {
  assert.ok(MODE_SEQ['danger-full-access'] > MODE_SEQ['read-only'])
  assert.ok(permissionOk('read-only', 'workspace-write'))
  assert.ok(permissionOk('workspace-write', 'workspace-write'))
  assert.equal(permissionOk('danger-full-access', 'read-only'), false)
  assert.equal(permissionOk('workspace-write', 'unknown-mode'), false, '未知档位必须 fail-closed')
})

test('全部通过', () => {
  assert.deepEqual(evaluateGates(base), { ok: true, code: 0 })
})

test('总开关关 → 拒且零副作用', () => {
  const r = evaluateGates({ ...base, config: { ...cfg, enabled: false } })
  assert.equal(r.ok, false)
  assert.equal(r.gate, 'total-switch')
  assert.equal(r.code, 5)
})

test('子代理发起 → 拒，退出码 2', () => {
  const r = evaluateGates({ ...base, isSubagent: true })
  assert.equal(r.ok, false)
  assert.equal(r.gate, 'caller')
  assert.equal(r.code, 2)
})

test('配置不可读 → 拒（不许当全放行）', () => {
  const r = evaluateGates({ ...base, config: null })
  assert.equal(r.ok, false)
  assert.equal(r.gate, 'config-unreadable')
  assert.equal(r.code, 5)
})

test('权限降级 → 拒，退出码 5', () => {
  const r = evaluateGates({ ...base, permission: { sourceMode: 'danger-full-access', targetMode: 'workspace-write' } })
  assert.equal(r.ok, false)
  assert.equal(r.gate, 'permission')
  assert.equal(r.code, 5)
})

test('权限未知 → 拒', () => {
  const r = evaluateGates({ ...base, permission: null })
  assert.equal(r.ok, false)
  assert.equal(r.gate, 'permission')
})

test('速率闸：20 分钟内第二次同主线 → 拒', () => {
  const rows = [{ actionId: 'relay', mainline: '大管家', dryRun: false, result: 'dispatched', ts: '2026-10-06T11:50:00.000Z' }]
  const r = evaluateGates({ ...base, auditRows: rows })
  assert.equal(r.ok, false)
  assert.equal(r.gate, 'rate')
})

test('速率闸忽略 dryRun 行', () => {
  const rows = [{ actionId: 'relay', mainline: '大管家', dryRun: true, result: 'preview', ts: '2026-10-06T11:59:00.000Z' }]
  assert.equal(evaluateGates({ ...base, auditRows: rows }).ok, true)
})

test('失败闸：同主线连续失败 2 次 → 拒', () => {
  const rows = [
    { actionId: 'relay', mainline: '大管家', dryRun: false, result: 'failed', ts: '2026-10-06T10:00:00.000Z' },
    { actionId: 'relay', mainline: '大管家', dryRun: false, result: 'failed', ts: '2026-10-06T11:00:00.000Z' },
  ]
  const r = evaluateGates({ ...base, auditRows: rows })
  assert.equal(r.ok, false)
  assert.equal(r.gate, 'failure')
})

test('去重闸：同一源会话已交接 → 拒', () => {
  const rows = [{ actionId: 'relay', sourceSessionId: 'session-src', dryRun: false, result: 'dispatched', ts: '2026-10-01T00:00:00.000Z' }]
  const r = evaluateGates({ ...base, auditRows: rows })
  assert.equal(r.ok, false)
  assert.equal(r.gate, 'dedupe')
})

test('档不合格 → 拒，退出码 5', () => {
  const r = evaluateGates({ ...base, docOk: false })
  assert.equal(r.gate, 'doc')
  const r2 = evaluateGates({ ...base, forbiddenOk: false })
  assert.equal(r2.gate, 'forbidden')
})

test('闸门顺序：总开关先于一切', () => {
  const r = evaluateGates({ ...base, config: { ...cfg, enabled: false }, isSubagent: true, docOk: false })
  assert.equal(r.gate, 'total-switch')
})

test('fail-closed 闸不受速率/失败闸计数影响', () => {
  const rows = [{ actionId: 'relay', mainline: '大管家', dryRun: false, result: 'dispatched', ts: '2026-10-06T11:59:00.000Z' }]
  const r = evaluateGates({ ...base, auditRows: rows, docOk: false })
  // 顺序上 doc 在 rate 之前，所以报的是 doc
  assert.equal(r.gate, 'doc')
})
```

- [ ] **Step 2: 跑测试确认失败**

```powershell
& $node --test test/relay.test.js 2>&1 | Select-Object -Last 25
```
Expected: FAIL — `evaluateGates is not a function`

- [ ] **Step 3: 实现**

追加到 `lib/relay.js`：

```js
export const MODE_SEQ = { 'read-only': 0, 'workspace-write': 1, 'danger-full-access': 2 }

/** R-2：档位比较走序表；未知档位一律 false（fail-closed）。 */
export function permissionOk(sourceMode, targetMode) {
  const a = MODE_SEQ[sourceMode]
  const b = MODE_SEQ[targetMode]
  if (a === undefined || b === undefined) return false
  return b >= a
}

export function dedupeKey(sourceSessionId) {
  return `relay|${sourceSessionId}`
}

export function makeRelayId(sourceSessionId, date) {
  const p = (n, w = 2) => String(n).padStart(w, '0')
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}`
  return `relay-${sourceSessionId}-${stamp}`
}

const real = (rows) => (rows ?? []).filter((r) => r.dryRun !== true)

function lastRealRow(rows, pred) {
  return real(rows).filter(pred).sort((a, b) => String(a.ts).localeCompare(String(b.ts))).pop() ?? null
}

function trailingFailures(rows, mainline) {
  const mine = real(rows).filter((r) => r.actionId === 'relay' && r.mainline === mainline)
  let n = 0
  for (let i = mine.length - 1; i >= 0; i--) {
    if (mine[i].result === 'failed') n += 1
    else break
  }
  return n
}

/**
 * **前置闸门**：不需要读档、不需要权限投影，也**不允许产生任何副作用**。
 *
 * 必须在**任何 I/O 之前**跑（spec §1 G8：关闭时零副作用）。
 * 端到端实测抓到过这个顺序错误：`runRelay` 先 `readFileSync`，于是总开关关着时
 * 仍然读了文件、还写了一行 `rejected` 审计，并给用户返回误导性的"读不到交接档"
 * 而不是"未启用"。见 Ruling 34。
 *
 * 这三道闸门**不写审计行**——"每道闸留审计行"（spec §5）从属于"关闭时零副作用"（§1 G8）：
 * 插件休眠时不落任何痕迹，否则任何人都能靠反复调用把审计流水刷大。
 */
export function preflightGates({ config, isSubagent }) {
  if (config === null || config === undefined) return { ok: false, gate: 'config-unreadable', reason: '配置读不到，按拒处理', code: 5 }
  if (config.enabled !== true) return { ok: false, gate: 'total-switch', reason: '大管家未启用（enabled 出厂为 false）', code: 5 }
  if (isSubagent) return { ok: false, gate: 'caller', reason: '子代理不得发起接力', code: 2 }
  return { ok: true, code: 0 }
}

/**
 * 闸门判定（spec §5 的 8 道中除单飞锁外的 7 道）。
 * 短路顺序：**前置三道**（配置不可读 → 总开关 → 调用者）→ 档 → 禁写 → 去重 → 速率 → 失败 → 权限。
 * （`config-unreadable` 必须最先：配置读不到时根本无法判断 `enabled`。Ruling 20）
 */
export function evaluateGates(input) {
  const { config, auditRows = [], now = new Date() } = input

  const pre = preflightGates({ config, isSubagent: input.isSubagent })
  if (!pre.ok) return pre
  if (!input.docOk) return { ok: false, gate: 'doc', reason: '交接档结构不合格', code: 5 }
  if (!input.forbiddenOk) return { ok: false, gate: 'forbidden', reason: '交接档含禁写内容', code: 5 }

  const prior = lastRealRow(auditRows, (r) => r.actionId === 'relay' && r.sourceSessionId === input.sourceSessionId && r.result === 'dispatched')
  if (prior) return { ok: false, gate: 'dedupe', reason: '该源会话已交接过一次，退出码 0 静默返回', code: 0 }

  const lastSame = lastRealRow(auditRows, (r) => r.actionId === 'relay' && r.mainline === input.mainline && r.result === 'dispatched')
  if (lastSame) {
    const gapMin = (now.getTime() - new Date(lastSame.ts).getTime()) / 60000
    if (gapMin < (config.rateLimitMinutes ?? 20)) {
      return { ok: false, gate: 'rate', reason: `同主线 ${gapMin.toFixed(1)} 分钟前刚交接，未满 ${config.rateLimitMinutes} 分钟`, code: 5 }
    }
  }

  const fails = trailingFailures(auditRows, input.mainline)
  if (fails >= (config.failureLimit ?? 2)) {
    return { ok: false, gate: 'failure', reason: `同主线连续失败 ${fails} 次，停止交接`, code: 5 }
  }

  if (!input.permission) return { ok: false, gate: 'permission', reason: '取不到权限投影，按拒处理', code: 5 }
  if (!permissionOk(input.permission.sourceMode, input.permission.targetMode)) {
    return { ok: false, gate: 'permission', reason: `权限降级：源 ${input.permission.sourceMode} → 新 ${input.permission.targetMode}`, code: 5 }
  }

  return { ok: true, code: 0 }
}
```

- [ ] **Step 4: 跑测试确认通过**

```powershell
& $node --test test/relay.test.js 2>&1 | Select-Object -Last 25
```
Expected: PASS，全部绿。

- [ ] **Step 5: Commit**

```powershell
& $git -C '<repo>' add lib/relay.js test/relay.test.js
& $git -C '<repo>' commit -m "feat(relay): 权限序表 + 7 道闸门判定（短路顺序与退出码）"
```

---

