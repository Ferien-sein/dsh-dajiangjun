### Task 2: `lib/store.js` — 审计流水与哈希链

**Files:**
- Create: `lib/store.js`
- Create: `test/store.test.js`
- Create: `package.json`（仓库根，真正的插件包）

**Interfaces:**
- Consumes: 无
- Produces:
  - `dshHome(): string`
  - `auditDir(home: string): string`
  - `auditFile(home: string, date?: Date): string`
  - `canonical(entry: object): string`
  - `hashEntry(entry: object): string`
  - `appendAudit(home: string, entry: object): object` —— 返回写入的整行（含 `prevHash`、`hash`）
  - `readAudit(home: string, months?: number, now?: Date): object[]`
  - `verifyChain(entries: object[]): { ok: boolean, brokenAt?: number, reason?: string }`

- [ ] **Step 1: 建仓库根的 `package.json`，并装上测试要用的两个包**

```json
{
  "name": "dsh-dajiangjun",
  "version": "0.1.0",
  "description": "大管家 — DeepSeek Harness 的会话接力：写档、建会话、投递、让新会话自己开工。",
  "private": true,
  "type": "module",
  "main": "./lib/index.js",
  "types": "./lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./package.json": "./package.json"
  },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "files": ["lib", "cordis.patch.yml", "README.md"],
  "scripts": { "test": "node --test" },
  "peerDependencies": {
    "@deepseek-ai/cordis": "~4.0.4",
    "@deepseek-ai/schemastery": "~3.18.4",
    "@deepseek-ai/dsh-tools": "0.2.0-rc.2"
  },
  "devDependencies": {
    "@deepseek-ai/schemastery": "3.18.4",
    "@deepseek-ai/dsh-tools": "0.2.0-rc.2"
  },
  "engines": { "node": ">=20" }
}
```

`devDependencies` 不是可选项：`lib/index.js` 与测试都要 `import` 这两个包，它们必须能从**本仓库**的 `node_modules` 解析到（装进 profile 没用——那是宿主运行时的解析路径，不是 repo 的）。装：

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$pnpm = '<dsh-install>\resources\runtime\pnpm\bin\pnpm.cjs'
& $node $pnpm -C '<repo>' install
```

Expected: 仓库下出现 `node_modules/@deepseek-ai/{schemastery,dsh-tools}`。

**若 install 失败**（`@deepseek-ai` scope 需要令牌）：改从 jsDelivr 拉这两个包的公开产物放进 `node_modules`（API 侦察阶段已用这条路拉到过 `.d.ts`，说明它们公开可读），并在 `docs/notes/dsh-api-notes.md` 里记下用的是哪条路。


- [ ] **Step 2: 写失败的测试**

`test/store.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appendAudit, auditFile, hashEntry, readAudit, verifyChain } from '../lib/store.js'

function home() {
  return mkdtempSync(path.join(tmpdir(), 'dj-store-'))
}

test('appendAudit 串起哈希链', () => {
  const h = home()
  const a = appendAudit(h, { ts: '2026-10-06T00:00:00.000Z', actionId: 'x', dryRun: false })
  const b = appendAudit(h, { ts: '2026-10-06T00:00:01.000Z', actionId: 'x', dryRun: false })
  assert.equal(a.prevHash, '')
  assert.equal(b.prevHash, a.hash)
  assert.equal(a.hash, hashEntry(a))
})

test('verifyChain 检出被篡改的行', () => {
  const h = home()
  appendAudit(h, { ts: '2026-10-06T00:00:00.000Z', actionId: 'x', dryRun: false })
  appendAudit(h, { ts: '2026-10-06T00:00:01.000Z', actionId: 'x', dryRun: false })
  const file = auditFile(h, new Date('2026-10-06T00:00:00.000Z'))
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  assert.equal(verifyChain(rows).ok, true)
  rows[0].actionId = 'tampered'
  const v = verifyChain(rows)
  assert.equal(v.ok, false)
  assert.equal(v.brokenAt, 0)
})

test('readAudit 只读当月与上月', () => {
  const h = home()
  appendAudit(h, { ts: '2026-09-15T00:00:00.000Z', actionId: 'old', dryRun: false })
  appendAudit(h, { ts: '2026-10-06T00:00:00.000Z', actionId: 'new', dryRun: false })
  appendAudit(h, { ts: '2026-08-01T00:00:00.000Z', actionId: 'ancient', dryRun: false })
  const rows = readAudit(h, 2, new Date('2026-10-06T00:00:00.000Z'))
  assert.deepEqual(rows.map((r) => r.actionId).sort(), ['new', 'old'])
})

test('半截 JSON 行不让整条链炸掉', () => {
  const h = home()
  appendAudit(h, { ts: '2026-10-06T00:00:00.000Z', actionId: 'a', dryRun: false })
  const file = auditFile(h, new Date('2026-10-06T00:00:00.000Z'))
  writeFileSync(file, readFileSync(file, 'utf8') + '{"ts":"2026-10-06T00:00:02', 'utf8')
  const rows = readAudit(h, 2, new Date('2026-10-06T00:00:00.000Z'))
  assert.equal(rows.length, 1)
})

test('链跨月连续：跨月读取后 verifyChain 不误报', () => {
  const h = home()
  appendAudit(h, { ts: '2026-08-15T12:00:00.000Z', actionId: 'aug', dryRun: false })
  appendAudit(h, { ts: '2026-09-15T12:00:00.000Z', actionId: 'sep', dryRun: false })
  appendAudit(h, { ts: '2026-10-06T12:00:00.000Z', actionId: 'oct', dryRun: false })

  const all = readAudit(h, 12, new Date('2026-10-06T00:00:00.000Z'))
  assert.deepEqual(all.map((r) => r.actionId), ['aug', 'sep', 'oct'])
  assert.equal(verifyChain(all).ok, true, '跨月链断了——新月份首行的 prevHash 没指向上月末行')

  const oct = all.find((r) => r.actionId === 'oct')
  const sep = all.find((r) => r.actionId === 'sep')
  assert.equal(oct.prevHash, sep.hash)
})

test('窗口验证：readAudit 默认只读两个月，必须用 seed 补上窗口前那条的 hash', () => {
  const h = home()
  appendAudit(h, { ts: '2026-08-15T12:00:00.000Z', actionId: 'aug', dryRun: false })
  appendAudit(h, { ts: '2026-09-15T12:00:00.000Z', actionId: 'sep', dryRun: false })
  appendAudit(h, { ts: '2026-10-06T12:00:00.000Z', actionId: 'oct', dryRun: false })

  const window = readAudit(h, 2, new Date('2026-10-06T00:00:00.000Z'))
  assert.deepEqual(window.map((r) => r.actionId), ['sep', 'oct'])
  // 不传 seed 时窗口首行注定对不上——这是有意的，不是 bug
  assert.equal(verifyChain(window).ok, false)
  assert.equal(verifyChain(window).brokenAt, 0)

  const aug = readAudit(h, 12, new Date('2026-10-06T00:00:00.000Z')).find((r) => r.actionId === 'aug')
  assert.equal(verifyChain(window, aug.hash).ok, true)
})
```

- [ ] **Step 3: 跑测试确认失败**

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node --test 2>&1 | Select-Object -Last 20
```
Expected: FAIL — `Cannot find module '../lib/store.js'`

- [ ] **Step 4: 实现 `lib/store.js`**

```js
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/** DSH 主目录。DSH_HOME 优先，否则 ~/.dsh（与 AGENTS.md 的口径一致）。 */
export function dshHome() {
  return process.env.DSH_HOME ?? path.join(homedir(), '.dsh')
}

export function auditDir(home = dshHome()) {
  return path.join(home, 'steward', 'audit')
}

function ymOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function auditFile(home, date = new Date()) {
  return path.join(auditDir(home), `${ymOf(date)}.jsonl`)
}

/** 规范化序列化：键排序，剔除 hash 自身。prevHash 参与计算。 */
export function canonical(entry) {
  const keys = Object.keys(entry).filter((k) => k !== 'hash').sort()
  return JSON.stringify(keys.map((k) => [k, entry[k]]))
}

export function hashEntry(entry) {
  return createHash('sha256').update(canonical(entry)).digest('hex')
}

function lastHashIn(file) {
  if (!existsSync(file)) return ''
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
  if (lines.length === 0) return ''
  try {
    return JSON.parse(lines[lines.length - 1]).hash ?? ''
  } catch {
    return ''
  }
}

/**
 * 链必须跨文件连续：本月文件为空则回溯上月，最多回看 maxBack 个月。
 * 否则每个新月份文件的首行 prevHash 会是空串，而 readAudit 会把两个月拼成一个序列，
 * verifyChain 就会在月边界必然误报一次断链（而 spec §8.1 规定断链 = 🔴）。
 */
function lastHash(home, date, maxBack = 12) {
  const own = lastHashIn(auditFile(home, date))
  if (own) return own
  for (let i = 1; i <= maxBack; i++) {
    const t = new Date(date.getFullYear(), date.getMonth() - i, 1)
    const h = lastHashIn(auditFile(home, t))
    if (h) return h
  }
  return ''
}

export function appendAudit(home, entry) {
  const date = entry.ts ? new Date(entry.ts) : new Date()
  const file = auditFile(home, date)
  mkdirSync(path.dirname(file), { recursive: true })
  const row = { ...entry, prevHash: lastHash(home, date), hash: '' }
  row.hash = hashEntry(row)
  appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8')
  return row
}

/** 只读当月与上月；容忍半截行（跳过而不是抛）。 */
export function readAudit(home, months = 2, now = new Date()) {
  const out = []
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const file = auditFile(home, d)
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line))
      } catch {
        // 半截行（进程被杀）：跳过。审计是"防损坏 + 便于追溯"，不是"不可抵赖"
      }
    }
  }
  return out.sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
}

/**
 * seed = 窗口之前那一条的 hash。因为 readAudit 默认只读两个月，
 * 链在窗口之前可能已经开始——不传 seed 就只能验证"从链头开始"的序列。
 * ponytail: 链的长度受保留文件数限制（超出 maxBack 的旧文件不参与），够用；
 * 真要长期归档再引入外部锚点。
 */
export function verifyChain(entries, seed = '') {
  let prev = seed
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if ((e.prevHash ?? '') !== prev) return { ok: false, brokenAt: i, reason: 'prevHash mismatch' }
    if (hashEntry(e) !== e.hash) return { ok: false, brokenAt: i, reason: 'hash mismatch' }
    prev = e.hash
  }
  return { ok: true }
}
```

`dryRun` 过滤**不在本文件实现**——唯一实现放在 `lib/relay.js`（Task 6），因为只有那里在计数。别在两处各写一份。

- [ ] **Step 5: 跑测试确认通过**

```powershell
& $node --test 2>&1 | Select-Object -Last 20
```
Expected: PASS，6 个测试全绿。

- [ ] **Step 6: Commit**

```powershell
& $git -C '<repo>' add package.json pnpm-lock.yaml lib/store.js test/store.test.js
& $git -C '<repo>' commit -m "feat(store): 审计流水 append-only + 哈希链 + 当月/上月读取"
```

---

