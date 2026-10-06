# 大管家 v1（会话接力）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 DeepSeek Harness 做一个宿主插件：当前会话写完交接档后调一个工具，插件校验档、过闸门、建新会话、命名、投递接手指令，新会话自己开工；缺省只预览不真做。

**Architecture:** 纯宿主插件（无客户端半体），三个源文件——`lib/store.js`（审计哈希链 + 原子写 + 单例锁）、`lib/relay.js`（纯逻辑：档契约、禁写内容、序表、闸门）、`lib/index.js`（cordis 接线 + 工具注册）。工具缺省 `dryRun:true`，单一实现由 `ctx.dryRun` 分支，不分预览/执行两个函数。

**Tech Stack:** Node.js ESM（本机内置 v24.21.0）、`@deepseek-ai/cordis` 4.0.4、`@deepseek-ai/schemastery` 3.18.4、`@deepseek-ai/dsh-tools` 0.2.0-rc.2、测试用 Node 内置 `node:test`（不引框架）。

**Spec:** `docs/superpowers/specs/2026-10-06-dajiangjun-session-relay-design.md`

## Global Constraints

- 目标宿主：**DeepSeek Harness 0.2.0-rc.2**（本机 Electron 桌面版）。不兼容更早版本，不做版本分支。
- `package.json` 必须 `"type": "module"`；宿主 Loader 按 ESM 解析。
- **不引入任何运行时依赖**，只用 `node:` 内置模块。peerDependencies：`@deepseek-ai/cordis: ~4.0.4`、`@deepseek-ai/schemastery: ~3.18.4`、`@deepseek-ai/dsh-tools: 0.2.0-rc.2`。
- 包名 `dsh-dajiangjun`；cordis 插件名 `dajiangjun`；工具名 `steward_relay`；patch 行 id `dajiangjun`。
- 一切注册走 `ctx.effect(...)` 或交出 disposer，否则 HMR/卸载会泄漏。
- **红线（违反即静默失败，见 spec §7）**：
  - R-1 投递只能用 `mode:'queue'` 或 `'steer'`，**绝不用 `inject`**（`inject` 的 `wakeup=false`，会话不会跑且不报错）。
  - R-2 权限档位比较**必须**走序表 `read-only(0) < workspace-write(1) < danger-full-access(2)`，不得字符串比较。
  - R-3 闸门读不到配置时**拒绝**，不得当"全放行"。
  - R-4 锁必须 `flag:'wx'` 原子创建，禁止"先 `existsSync` 再写"。
  - R-5 状态文件必须原子写（临时文件 → `fs.renameSync`），禁止直接 `writeFileSync(目标)`。
- **计数一律忽略 `dryRun:true` 的审计行**（spec §1 G2）。违反的后果：预览两次被拒 → 经失败闸把自己锁死。
- 出厂配置里所有开关**初值 = 关**。
- 每个任务结束**必须**跑该任务的验证命令并提交。提交信息用中文，`feat:`/`test:`/`docs:` 前缀。
- 本机 `git` 不在 PATH：用 `<git>\cmd\git.exe`（版本段会随 GitHub Desktop 更新而变）。
- 本机 `node` 不在 PATH：用 `$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`。
- **改动 `desktop` profile 之前必须先备份 `~/.dsh/profiles/desktop/cordis.patch.yml`**；禁用插件一律写 `disabled: true`，不删文件。

---

### Task 1: 环境闸门 — 隔离 profile + 最小插件跑通

这一步不通过，后面全部白做。同时清掉 spec §10 的 A3 / A6 / A7 三个假设。

**Files:**
- Create: `_scratch/hello/package.json`（一次性探针，`_scratch/` 已被 gitignore）
- Create: `_scratch/hello/cordis.patch.yml`
- Create: `_scratch/hello/lib/index.js`
- Create: `docs/notes/dsh-api-notes.md`
- Modify: `docs/superpowers/specs/2026-10-06-dajiangjun-session-relay-design.md`（§10 假设表）

**Interfaces:**
- Consumes: 无
- Produces: `docs/notes/dsh-api-notes.md` —— 记录**实测**得到的：隔离 profile 名、`inject` 数组的确切服务键名（`sessionController` / `sessionTitle` / `sessionProjections` 的真实拼写）、`defineTool` 实测形状、以及"新增插件行是否需要重启宿主"。Task 7–9 依赖该文件的 `inject` 键名。

- [ ] **Step 1: 写探针插件**

`_scratch/hello/package.json`：

```json
{
  "name": "dsh-hello",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./lib/index.js",
  "exports": { ".": { "default": "./lib/index.js" }, "./package.json": "./package.json" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "files": ["lib", "cordis.patch.yml"],
  "peerDependencies": { "@deepseek-ai/cordis": "~4.0.4" }
}
```

`_scratch/hello/cordis.patch.yml`：

```yaml
- insert:
    - id: hello
      name: dsh-hello
```

`_scratch/hello/lib/index.js`：

```js
export const name = 'hello'
export const inject = []

export function apply(ctx) {
  const info = {
    dshHomeEnv: process.env.DSH_HOME ?? null,
    cwd: process.cwd(),
    services: ['tools', 'sessionController', 'sessionTitle', 'sessionProjections', 'settings', 'llm']
      .filter((k) => ctx.get(k) !== undefined),
  }
  ctx.logger?.info?.('hello probe: %o', info)
  process.stderr.write(`[hello-probe] ${JSON.stringify(info)}\n`)
}
```

- [ ] **Step 2: 建隔离 profile**

Run（PowerShell）：
```powershell
dsh --profile steward-dev --from-default-profile web --no-open
```
它会建 profile 并启动服务。等到 stderr 出现 `[hello-probe]` 或启动日志稳定后 `Ctrl+C`。
Expected: `~/.dsh/profiles/steward-dev/package.json` 存在。

如果 `--from-default-profile` 不接受 `--no-open`，去掉它并手动关掉浏览器标签。

- [ ] **Step 3: 装探针插件**

```powershell
dsh plugin --profile steward-dev add '<repo>\_scratch\hello'
dsh plugin --profile steward-dev list --depth 0
```
Expected: 列表里出现 `dsh-hello`。

- [ ] **Step 4: 验证插件行进了配置树**

```powershell
dsh --profile steward-dev --dump-config 2>&1 | Select-String -Pattern 'hello'
```
Expected: 出现 `- id: hello` / `name: dsh-hello`。

**若这一步失败**：说明 `dsh.bundle.patch` 没被解析。检查 `package.json` 里 `dsh.bundle.patch` 的路径是否相对包根、文件是否存在。此处不通就停下报告，不要继续。

- [ ] **Step 5: 跑起来，收集服务键名**

```powershell
dsh --profile steward-dev
```
从 stderr 抓 `[hello-probe]` 那行。

Expected: `services` 数组里至少出现 `tools`。把**实际出现**的键名原样记下来——**这一步的产出就是真名**，后续任务用真名，不用下面任何猜测。

**若某个键名不出现**：说明该服务的 `inject` 名与我预期的不同。用下面这条找出真名：
```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node '<repo>\_scratch\asar.mjs' cat '<dsh-install>\resources\app.asar' 'dsh/node_modules/@deepseek-ai/dsh-session-title/package.json' 2>$null
```
看 `package.json` 里声明的服务名（`cordis` 的 `Service` 声明或 `inject` 约定），记进笔记。

- [ ] **Step 6: 写 API 笔记**

Create `docs/notes/dsh-api-notes.md`，把 Step 5 的实测结果、以及下面这段**已核实**的 `defineTool` 形状写进去（来源：asar 内 `dsh-tools/README.zh.md:34-58`）：

```ts
ctx.tools.register(defineTool({
  name: 'read_file',
  description: 'Read a file from disk.',
  parameters: {
    path: { type: 'string', required: true, description: 'Absolute file path' },
    offset: { type: 'number' },
  },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args, exec) {
    return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
  },
}))
```

并记下 `exec`（`ToolRunContext`）的字段：`{ token, callId, rootCallId, name, signal, agent?, parent?, schema?, arguments, deferContext(msg), concludeTurn() }`。

- [ ] **Step 7: 记下新增插件行是否需要重启**

在笔记里明确回答：`dsh plugin add` 之后，**不重启**能否让新插件行生效？做法：Task 1 Step 4 之后不重启直接 `--dump-config` 看是否已生效；再在 Step 5 启动一次看是否加载。把结论写成一句话。

- [ ] **Step 8: 更新 spec 的假设表**

把 §10 的 A3（最小插件能装进隔离 profile 并拉起）、A7（`inject` 服务键名）标为**已验证**并附结论；A6（热加载）按 Step 7 的结论标注。

- [ ] **Step 9: Commit**

```powershell
$git = '<git>\cmd\git.exe'
& $git -C '<repo>' add docs/notes/dsh-api-notes.md docs/superpowers/specs
& $git -C '<repo>' commit -m "docs: 环境闸门通过 — 隔离 profile、插件挂载、defineTool 实测形状"
```

---

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

- [ ] **Step 1: 建仓库根的 `package.json`**

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
  "scripts": { "test": "node --test test/" },
  "peerDependencies": {
    "@deepseek-ai/cordis": "~4.0.4",
    "@deepseek-ai/schemastery": "~3.18.4",
    "@deepseek-ai/dsh-tools": "0.2.0-rc.2"
  },
  "engines": { "node": ">=20" }
}
```

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
```

- [ ] **Step 3: 跑测试确认失败**

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node --test test/ 2>&1 | Select-Object -Last 20
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

function lastHash(file) {
  if (!existsSync(file)) return ''
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
  if (lines.length === 0) return ''
  try {
    return JSON.parse(lines[lines.length - 1]).hash ?? ''
  } catch {
    return ''
  }
}

export function appendAudit(home, entry) {
  const file = auditFile(home, entry.ts ? new Date(entry.ts) : new Date())
  mkdirSync(path.dirname(file), { recursive: true })
  const row = { ...entry, prevHash: lastHash(file), hash: '' }
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

export function verifyChain(entries) {
  let prev = ''
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
& $node --test test/ 2>&1 | Select-Object -Last 20
```
Expected: PASS，4 个测试全绿。

- [ ] **Step 6: Commit**

```powershell
& $git -C '<repo>' add package.json lib/store.js test/store.test.js
& $git -C '<repo>' commit -m "feat(store): 审计流水 append-only + 哈希链 + 当月/上月读取"
```

---

### Task 3: `lib/store.js` — 原子写、单例锁、并发安全

**Files:**
- Modify: `lib/store.js`
- Modify: `test/store.test.js`

**Interfaces:**
- Consumes: Task 2 的 `dshHome`
- Produces:
  - `writeJsonAtomic(file: string, value: unknown): void`
  - `readJson(file: string, fallback: unknown): unknown`
  - `updateJson(file: string, fn: (v: any) => any): void`
  - `acquireLock(file: string, opts: { ttlMs: number, now?: number }): { ok: true, stole: boolean } | null`
  - `releaseLock(file: string): void`
  - `lockPath(home: string, key: string): string`

- [ ] **Step 1: 写失败的测试**

追加到 `test/store.test.js`：

```js
import { acquireLock, lockPath, releaseLock, updateJson, writeJsonAtomic } from '../lib/store.js'

test('updateJson 并发 100 次自增不丢更新', async () => {
  const h = home()
  const file = path.join(h, 'counter.json')
  writeJsonAtomic(file, { n: 0 })
  await Promise.all(Array.from({ length: 100 }, () => Promise.resolve().then(() => updateJson(file, (v) => ({ n: v.n + 1 })))))
  assert.equal(readJson(file, { n: -1 }).n, 100)
})

test('writeJsonAtomic 留下完整 JSON，不留临时文件', () => {
  const h = home()
  const file = path.join(h, 'a.json')
  writeJsonAtomic(file, { hello: '世界' })
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { hello: '世界' })
  const leftovers = readdirSync(h).filter((f) => f.includes('.tmp-'))
  assert.deepEqual(leftovers, [])
})

test('锁：抢不到返回 null', () => {
  const h = home()
  const lock = lockPath(h, 'relay-s1')
  assert.ok(acquireLock(lock, { ttlMs: 60000, now: 1000 }))
  assert.equal(acquireLock(lock, { ttlMs: 60000, now: 2000 }), null)
})

test('锁：过期可抢占并记 stole', () => {
  const h = home()
  const lock = lockPath(h, 'relay-s1')
  acquireLock(lock, { ttlMs: 1000, now: 0 })
  const got = acquireLock(lock, { ttlMs: 1000, now: 5000 })
  assert.equal(got.ok, true)
  assert.equal(got.stole, true)
})

test('锁：release 后可再抢', () => {
  const h = home()
  const lock = lockPath(h, 'relay-s1')
  acquireLock(lock, { ttlMs: 1000, now: 0 })
  releaseLock(lock)
  assert.ok(acquireLock(lock, { ttlMs: 1000, now: 10 }))
})
```

在文件顶部的导入里补上 `readdirSync`：

```js
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
```

并补 `readJson` 的导入（与 `store.js` 的导出一致）。

- [ ] **Step 2: 跑测试确认失败**

```powershell
& $node --test test/ 2>&1 | Select-Object -Last 25
```
Expected: FAIL — `writeJsonAtomic is not a function` 之类。

- [ ] **Step 3: 实现**

追加到 `lib/store.js`（并把导入补全：`renameSync`、`rmSync`、`writeFileSync`）：

```js
const RENAME_RETRY_MS = [50, 150, 400]

function sleepSync(ms) {
  // ponytail: 同步睡眠用 Atomics.wait，省掉一个异步化改造。只在 rename 重试路径上用。
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** 原子写文本：同目录临时文件 → rename；Windows 上 EPERM/EBUSY 重试（R-5）。 */
export function writeTextAtomic(file, text) {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, text, 'utf8')
  for (let i = 0; ; i++) {
    try {
      renameSync(tmp, file)
      return
    } catch (error) {
      // Windows 上目标被其他进程打开会 EPERM/EBUSY（同步盘锁、句柄占用）
      const retryable = ['EPERM', 'EBUSY', 'EACCES'].includes(error.code)
      if (!retryable || i >= RENAME_RETRY_MS.length) {
        try { rmSync(tmp, { force: true }) } catch {}
        throw error
      }
      sleepSync(RENAME_RETRY_MS[i])
    }
  }
}

export function writeJsonAtomic(file, value) {
  writeTextAtomic(file, JSON.stringify(value, null, 2))
}

export function readJson(file, fallback) {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function updateJson(file, fn) {
  // ponytail: 单进程内用同目录临时文件 + rename 达成串行可见性；跨进程并发由调用方用锁串行化。
  const next = fn(readJson(file, undefined))
  writeJsonAtomic(file, next)
  return next
}

export function lockPath(home, key) {
  return path.join(home, 'steward', 'locks', `${key}.lock`)
}

/** 原子创建（flag:'wx'），禁止 existsSync-then-write（TOCTOU，spec R-4）。 */
export function acquireLock(file, { ttlMs, now = Date.now() }) {
  mkdirSync(path.dirname(file), { recursive: true })
  try {
    writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: now, ttl: ttlMs }), { flag: 'wx' })
    return { ok: true, stole: false }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const held = readJson(file, null)
  const expired = held && typeof held.startedAt === 'number' && now - held.startedAt > (held.ttl ?? ttlMs)
  if (!expired) return null
  writeJsonAtomic(file, { pid: process.pid, startedAt: now, ttl: ttlMs, stoleFrom: held })
  return { ok: true, stole: true }
}

export function releaseLock(file) {
  try { rmSync(file, { force: true }) } catch {}
}
```

- [ ] **Step 4: 跑测试确认通过**

```powershell
& $node --test test/ 2>&1 | Select-Object -Last 25
```
Expected: PASS，9 个测试全绿。

- [ ] **Step 5: Commit**

```powershell
& $git -C '<repo>' add lib/store.js test/store.test.js
& $git -C '<repo>' commit -m "feat(store): 原子写（Windows rename 重试）+ flag:wx 单例锁 + updateJson"
```

---

### Task 4: `lib/relay.js` — 交接档结构契约与主线名

**Files:**
- Create: `lib/relay.js`
- Create: `test/relay.test.js`

**Interfaces:**
- Consumes: 无（纯函数，无 I/O）
- Produces:
  - `SECTIONS: string[]` —— `['头部','现状','已完成','在途','下一步','待拍板','速查']`
  - `parseDoc(text: string): { sections: Record<string,string[]>, errors: string[] }`
  - `resolveMainline(parsed, docPath: string): string | null`
  - `validateDoc(text: string): { ok: boolean, errors: string[], parsed: object }`

- [ ] **Step 1: 写失败的测试**

`test/relay.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDoc, resolveMainline, validateDoc } from '../lib/relay.js'

const GOOD = `# 头部
主线: 大管家
源会话: session-abc
时间: 2026-10-06 12:00

# 现状
插件骨架已跑通，正在做档校验。

# 已完成
- 隔离 profile 跑通（_scratch/hello/lib/index.js）
- defineTool 形状已核实（docs/notes/dsh-api-notes.md）

# 在途
无

# 下一步
1. 实现档校验
2. 实现闸门
3. 跑端到端

# 待拍板
无

# 速查
- 设计稿：docs/superpowers/specs/2026-10-06-dajiangjun-session-relay-design.md
- 红线：投递不许用 inject
`

test('正例通过', () => {
  const r = validateDoc(GOOD)
  assert.equal(r.ok, true, JSON.stringify(r.errors))
})

test('反例一：下一步段全是散文没有有序列表 → 拒', () => {
  const bad = GOOD.replace('1. 实现档校验\n2. 实现闸门\n3. 跑端到端', '先把档校验写了，然后做闸门。')
  const r = validateDoc(bad)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('下一步')))
})

test('反例二：已完成项无证据路径 → 拒', () => {
  const bad = GOOD.replace('- 隔离 profile 跑通（_scratch/hello/lib/index.js）', '- 隔离 profile 跑通了')
  const r = validateDoc(bad)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('已完成')))
})

test('反例三：段标题不是逐字匹配 → 拒', () => {
  const bad = GOOD.replace('# 下一步', '## 下一步是什么')
  const r = validateDoc(bad)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('下一步')))
})

test('主线名取值序：段1 → 文件名 → null', () => {
  const fromSection = parseDoc(GOOD)
  assert.equal(resolveMainline(fromSection, 'whatever.md'), '大管家')

  const noHeader = parseDoc(GOOD.replace('主线: 大管家\n', ''))
  assert.equal(resolveMainline(noHeader, 'C:/x/会话接力-20261006-1200.md'), '会话接力')

  assert.equal(resolveMainline(noHeader, 'C:/x/没有时间戳.md'), '没有时间戳')
  assert.equal(resolveMainline(noHeader, 'C:/x/.md'), null)
})
```

- [ ] **Step 2: 跑测试确认失败**

```powershell
& $node --test test/relay.test.js 2>&1 | Select-Object -Last 20
```
Expected: FAIL — `Cannot find module '../lib/relay.js'`

- [ ] **Step 3: 实现 `lib/relay.js`**

```js
export const SECTIONS = ['头部', '现状', '已完成', '在途', '下一步', '待拍板', '速查']

const HEADING = /^\s*#{1,6}\s+(\S.*?)\s*$/
const ORDERED = /^\s*\d+[.、)]\s*\S/
const HAS_EVIDENCE = /[/\\][^\s，。）)]+/

/** 段标题必须逐字匹配（容忍前面的 # 与空白），不做模糊。 */
export function parseDoc(text) {
  const sections = {}
  const errors = []
  let current = null
  for (const line of String(text).split(/\r?\n/)) {
    const m = HEADING.exec(line)
    if (m) {
      const title = m[1]
      if (SECTIONS.includes(title)) {
        current = title
        sections[current] = []
        continue
      }
      current = null // 非本契约的标题：退出当前段，不报错
      continue
    }
    if (current) sections[current].push(line)
  }
  for (const name of SECTIONS) {
    if (!(name in sections)) errors.push(`缺少段「${name}」`)
  }
  return { sections, errors }
}

function sectionText(lines) {
  return (lines ?? []).join('\n')
}

export function validateDoc(text) {
  const parsed = parseDoc(text)
  const errors = [...parsed.errors]
  if (errors.length) return { ok: false, errors, parsed }

  const bullet = (parsed.sections['已完成'] ?? []).filter((l) => /^\s*[-*]\s*\S/.test(l))
  if (bullet.length === 0) errors.push('段「已完成」没有任何条目')
  for (const line of bullet) {
    if (!HAS_EVIDENCE.test(line)) errors.push(`段「已完成」的条目缺证据路径：${line.trim()}`)
  }

  const next = (parsed.sections['下一步'] ?? [])
  if (!next.some((l) => ORDERED.test(l))) errors.push('段「下一步」缺少有序列表项（`1. ` 开头且非空）')

  const current = sectionText(parsed.sections['现状']).trim()
  if (!current) errors.push('段「现状」为空')

  return { ok: errors.length === 0, errors, parsed }
}

/** 取值序：段1 的「主线:」→ 档文件名首段 → null（不猜）。 */
export function resolveMainline(parsed, docPath) {
  const header = sectionText(parsed?.sections?.['头部'] ?? [])
  const m = /^\s*主线\s*[:：]\s*(\S.*?)\s*$/m.exec(header)
  if (m) return m[1]
  const base = String(docPath).split(/[/\\]/).pop() ?? ''
  const stem = base.replace(/\.md$/i, '')
  const first = stem.split('-')[0]
  if (!first || first === '.') return null
  return first
}
```

- [ ] **Step 4: 跑测试确认通过**

```powershell
& $node --test test/relay.test.js 2>&1 | Select-Object -Last 20
```
Expected: PASS，5 个测试全绿。

- [ ] **Step 5: Commit**

```powershell
& $git -C '<repo>' add lib/relay.js test/relay.test.js
& $git -C '<repo>' commit -m "feat(relay): 交接档七段结构契约 + 主线名取值序"
```

---

### Task 5: `lib/relay.js` — 四类禁写内容

**Files:**
- Modify: `lib/relay.js`
- Modify: `test/relay.test.js`

**Interfaces:**
- Consumes: Task 4 的 `parseDoc`
- Produces:
  - `checkForbidden(text: string, opts?: { quoteLines?: number }): { ok: boolean, hits: { kind: string, line: number }[] }`
  - 命中项**只返回类目与行号，绝不回显命中内容**

- [ ] **Step 1: 写失败的测试**

```js
import { checkForbidden } from '../lib/relay.js'

test('四类禁写各命中一例', () => {
  const cases = [
    ['凭据值', 'key = sk-abcdefghijklmnopqrstuvwxyz012345'],
    ['内网地址', '服务在 http://192.168.1.20:3080 上'],
    ['他人隐私', '联系 zhang.san@example.com 处理'],
    ['会话原文', 'user: 帮我把这个改一下\nassistant: 好的，我这就改\nuser: 还有这个\nassistant: 也改了\nuser: 再检查一遍'],
  ]
  for (const [kind, text] of cases) {
    const r = checkForbidden(text)
    assert.equal(r.ok, false, `${kind} 没被拦住`)
    assert.ok(r.hits.some((h) => h.kind === kind), `命中类目里没有 ${kind}`)
  }
})

test('干净文本通过；回环地址不算内网', () => {
  assert.equal(checkForbidden('服务在 http://127.0.0.1:19387/docs/notes.md 上').ok, true)
  assert.equal(checkForbidden('见 docs/superpowers/specs/x.md 第 3 节').ok, true)
})

test('命中项不回显命中内容', () => {
  const secret = 'sk-abcdefghijklmnopqrstuvwxyz012345'
  const r = checkForbidden(`key = ${secret}`)
  assert.equal(JSON.stringify(r).includes(secret), false)
})
```

- [ ] **Step 2: 跑测试确认失败**

```powershell
& $node --test test/relay.test.js 2>&1 | Select-Object -Last 20
```
Expected: FAIL — `checkForbidden is not a function`

- [ ] **Step 3: 实现**

追加到 `lib/relay.js`：

```js
const FORBIDDEN = [
  ['凭据值', /\bsk-[A-Za-z0-9_-]{16,}/, /(?:Bearer\s+[A-Za-z0-9._-]{16,})/i, /(?:password|passwd|token|secret|api[_-]?key)\s*[:=]\s*\S+/i],
  ['内网地址', /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}(?:\.\d{1,3})?\b/, /https?:\/\/(?!127\.0\.0\.1|localhost\b)[A-Za-z0-9.-]+/],
  ['他人隐私', /\b1[3-9]\d{9}\b/, /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
]

/** 只返回类目与行号；绝不回显命中内容（否则等于把禁写内容搬进日志）。 */
export function checkForbidden(text, opts = {}) {
  const quoteLines = opts.quoteLines ?? 5
  const lines = String(text).split(/\r?\n/)
  const hits = []
  lines.forEach((line, i) => {
    for (const [kind, ...patterns] of FORBIDDEN) {
      if (patterns.some((p) => p.test(line))) {
        hits.push({ kind, line: i + 1 })
        break
      }
    }
  })
  // 会话原文：连续 >= quoteLines 行以 user:/assistant: 开头
  let run = 0
  lines.forEach((line, i) => {
    if (/^\s*(?:user|assistant)\s*[:：]/i.test(line)) {
      run += 1
      if (run === quoteLines) hits.push({ kind: '会话原文', line: i + 1 })
    } else {
      run = 0
    }
  })
  return { ok: hits.length === 0, hits }
}
```

- [ ] **Step 4: 跑测试确认通过**

```powershell
& $node --test test/relay.test.js 2>&1 | Select-Object -Last 20
```
Expected: PASS，8 个测试全绿。

- [ ] **Step 5: Commit**

```powershell
& $git -C '<repo>' add lib/relay.js test/relay.test.js
& $git -C '<repo>' commit -m "feat(relay): 交接档四类禁写内容检查（不回显命中内容）"
```

---

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
 * 闸门判定（spec §5 的 8 道中除单飞锁外的 7 道）。
 * 短路顺序：总开关 → 调用者 → 配置 → 档 → 禁写 → 去重 → 速率 → 失败 → 权限。
 */
export function evaluateGates(input) {
  const { config, auditRows = [], now = new Date() } = input

  if (config === null || config === undefined) return { ok: false, gate: 'config-unreadable', reason: '配置读不到，按拒处理', code: 5 }
  if (config.enabled !== true) return { ok: false, gate: 'total-switch', reason: '总开关关闭', code: 5 }
  if (input.isSubagent) return { ok: false, gate: 'caller', reason: '子代理不得发起接力', code: 2 }
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

### Task 7: `lib/index.js` — Config、工具注册、dryRun 预览路径

**Files:**
- Create: `lib/index.js`
- Create: `cordis.patch.yml`
- Create: `test/index.test.js`

**Interfaces:**
- Consumes: Task 4/5/6 的 `validateDoc`、`checkForbidden`、`resolveMainline`、`evaluateGates`、`makeRelayId`；Task 2/3 的 `appendAudit`、`readAudit`
- Produces:
  - `name = 'dajiangjun'`、`inject`、`Config`（schemastery）、`apply(ctx, config)`
  - 内部 `runRelay(ctx, config, args, exec)` —— Task 8 在其上补真执行分支
  - 工具 `steward_relay`，输出 schema 为对象 `{ kind, exitCode, message, relayId, gate }`

- [ ] **Step 1: 写 `cordis.patch.yml`**

```yaml
# 大管家 bundle 层：profile 的 package.json 声明 dsh.bundle.patch 指向本文件。
# name 是包名（从 profile 的 node_modules 解析），不是相对路径。
- insert:
    - id: dajiangjun
      name: dsh-dajiangjun
```

- [ ] **Step 2: 写失败的测试**

`test/index.test.js` —— 用替身 ctx 测工具行为，不需要真宿主。

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Config, apply } from '../lib/index.js'
import { readAudit } from '../lib/store.js'

const GOOD_DOC = `# 头部
主线: 大管家
源会话: session-src

# 现状
正在跑测试。

# 已完成
- 隔离 profile 跑通（_scratch/hello/lib/index.js）

# 在途
无

# 下一步
1. 跑端到端
2. 更新 spec

# 待拍板
无

# 速查
- 设计稿：docs/superpowers/specs/2026-10-06-dajiangjun-session-relay-design.md
`

/** 替身 ctx：记录所有服务调用，供断言"预览不得有写操作"。 */
function fakeCtx(overrides = {}) {
  const calls = []
  const ctx = {
    tools: {
      register: (def) => {
        calls.push(['register', def.name])
        ctx.registered = def
        return () => {}
      },
    },
    effect: (fn) => fn(),
    on: () => () => {},
    sessionController: {
      create: async (req) => { calls.push(['create', req]); return { sessionId: 'session-new' } },
      prompt: async (req) => { calls.push(['prompt', req]); return { accepted: true } },
      resolveAgent: async (id) => { calls.push(['resolveAgent', id]); return { session: { id } } },
    },
    sessionTitle: { rename: async (s, t) => { calls.push(['rename', t]); return { title: t, eventSeq: 1 } } },
    sessionProjections: { stateOf: () => 'workspace-write' },
    ...overrides,
  }
  ctx.calls = calls
  return ctx
}

/** 造一个只有本插件关心的临时 DSH_HOME，并写一份合格档。 */
function tempHome(doc = GOOD_DOC) {
  const h = mkdtempSync(path.join(tmpdir(), 'dj-home-'))
  process.env.DSH_HOME = h
  const docPath = path.join(h, '大管家-20261006-1200.md')
  writeFileSync(docPath, doc, 'utf8')
  return { home: h, docPath }
}

// ---- Config ----

test('出厂开关一律为关', () => {
  const c = Config({})
  assert.equal(c.enabled, false)
  assert.equal(c.notify.enabled, false)
})

test('阈值有合理默认且带范围', () => {
  const c = Config({})
  assert.equal(c.softLimitRatio, 0.7)
  assert.equal(c.rateLimitMinutes, 20)
  assert.equal(c.failureLimit, 2)
  assert.equal(c.forbiddenQuoteLines, 5)
})

test('软限比例越界被拒', () => {
  assert.throws(() => Config({ softLimitRatio: 1.5 }))
})

// ---- dryRun 零副作用（spec §1 G2 / §9 项 5）----

test('dryRun 缺省为 true：零真副作用', async () => {
  const { home, docPath } = tempHome()
  const ctx = fakeCtx()
  apply(ctx, Config({ enabled: true }))

  const res = await ctx.registered.execute({ docPath }, { agent: { id: 'session-src' } })

  assert.equal(res.kind, 'preview')
  assert.equal(res.exitCode, 0)
  assert.equal(ctx.calls.some((c) => c[0] === 'create'), false, '预览不得建会话')
  assert.equal(ctx.calls.some((c) => c[0] === 'prompt'), false, '预览不得投递')
  assert.equal(ctx.calls.some((c) => c[0] === 'rename'), false, '预览不得改名')

  const rows = readAudit(home, 2, new Date())
  assert.equal(rows.length, 1, '预览应留一行审计')
  assert.equal(rows[0].dryRun, true)
  assert.equal(rows[0].result, 'preview')
})

test('总开关关闭时拒且零写操作', async () => {
  const { docPath } = tempHome()
  const ctx = fakeCtx()
  apply(ctx, Config({ enabled: false }))
  const res = await ctx.registered.execute({ docPath }, { agent: { id: 'session-src' } })
  assert.equal(res.kind, 'rejected')
  assert.equal(res.gate, 'total-switch')
  assert.equal(ctx.calls.some((c) => c[0] === 'create'), false)
})

test('新 home 的审计流水为空', () => {
  const { home } = tempHome()
  assert.deepEqual(readAudit(home, 2, new Date()), [])
})
```


- [ ] **Step 3: 跑测试确认失败**

```powershell
& $node --test test/index.test.js 2>&1 | Select-Object -Last 20
```
Expected: FAIL — `Cannot find module '../lib/index.js'`

- [ ] **Step 4: 实现 `lib/index.js`（本任务只做预览路径）**

```js
import { readFileSync } from 'node:fs'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { checkForbidden, evaluateGates, makeRelayId, resolveMainline, validateDoc } from './relay.js'
import { appendAudit, dshHome, readAudit } from './store.js'

export const name = 'dajiangjun'

// 键名以 Task 1 的 docs/notes/dsh-api-notes.md 实测结果为准
export const inject = ['tools', 'sessionController', 'sessionTitle', 'sessionProjections']

export const Config = z.object({
  enabled: z.boolean().default(false),
  softLimitRatio: z.number().min(0.1).max(0.95).default(0.7),
  rateLimitMinutes: z.number().min(0).default(20),
  failureLimit: z.number().min(1).default(2),
  lockTtlMs: z.number().min(1000).default(120000),
  forbiddenQuoteLines: z.number().min(1).default(5),
  notify: z.object({
    enabled: z.boolean().default(false),
    cooldownMinutes: z.number().min(0).default(20),
    dailyCap: z.number().min(0).default(10),
    growthStepPct: z.number().min(1).default(5),
    quietFrom: z.number().min(0).max(23).default(23),
    quietTo: z.number().min(0).max(23).default(7),
  }).default({}),
})

const OUTPUT = {
  type: 'object',
  properties: {
    kind: { type: 'string' },
    exitCode: { type: 'number' },
    gate: { type: 'string' },
    relayId: { type: 'string' },
    message: { type: 'string' },
  },
  required: ['kind', 'exitCode', 'message'],
  additionalProperties: false,
}

const INSTRUCTION = (docPath, relayId, mainline) =>
  `读交接档 ${docPath}，按第 5 段「下一步」逐条继续。\n你是接力会话；链标识 ${relayId}；主线 ${mainline}。\n开工前先读档全文，不要只看这一段。`

function isSubagentCaller(exec) {
  return exec?.parent !== undefined && exec?.parent !== null
}

async function runRelay(ctx, config, args, exec) {
  const home = dshHome()
  const sourceSessionId = exec?.agent?.id ?? exec?.agent?.session?.id ?? 'unknown'
  const auditRows = readAudit(home, 2, new Date())
  const dryRun = args.dryRun !== false

  let text
  try {
    text = readFileSync(args.docPath, 'utf8')
  } catch {
    return { kind: 'rejected', exitCode: 5, gate: 'doc', message: `读不到交接档：${args.docPath}` }
  }

  const doc = validateDoc(text)
  const forbidden = checkForbidden(text, { quoteLines: config.forbiddenQuoteLines })
  const mainline = resolveMainline(doc.parsed, args.docPath) ?? args.mainline ?? ''
  const relayId = makeRelayId(sourceSessionId, new Date())

  const gate = evaluateGates({
    config,
    sourceSessionId,
    mainline,
    docOk: doc.ok,
    forbiddenOk: forbidden.ok,
    auditRows,
    permission: null, // 预览阶段还没有目标会话；真执行路径在 Task 8 补
    now: new Date(),
    isSubagent: isSubagentCaller(exec),
  })

  const base = { relayId, gate: gate.gate }

  if (!doc.ok) {
    appendAudit(home, { ts: new Date().toISOString(), actor: 'agent', actionId: 'relay', dryRun, result: 'rejected', gate: 'doc', mainline, sourceSessionId, relayId })
    return { ...base, kind: 'rejected', exitCode: 5, message: `交接档不合格：\n- ${doc.errors.join('\n- ')}` }
  }
  if (!forbidden.ok) {
    appendAudit(home, { ts: new Date().toISOString(), actor: 'agent', actionId: 'relay', dryRun, result: 'rejected', gate: 'forbidden', mainline, sourceSessionId, relayId })
    const list = forbidden.hits.map((h) => `第 ${h.line} 行：${h.kind}`).join('\n- ')
    return { ...base, kind: 'rejected', exitCode: 5, message: `交接档含禁写内容（不回显命中内容）：\n- ${list}` }
  }
  if (!gate.ok && gate.gate !== 'permission') {
    appendAudit(home, { ts: new Date().toISOString(), actor: 'agent', actionId: 'relay', dryRun, result: 'rejected', gate: gate.gate, mainline, sourceSessionId, relayId })
    return { ...base, kind: 'rejected', exitCode: gate.code, message: `闸门未通过（${gate.gate}）：${gate.reason}` }
  }

  // 真执行分支由 Task 8 补上（在那之前本工具只有预览能力）
  const preview = [
    '【预览】以下操作尚未执行（dryRun 缺省为 true，确认真执行请传 dryRun:false）',
    `- 主线：${mainline}`,
    `- 链标识：${relayId}`,
    `- 将新建会话（cwd 同源会话），标题：\u3010\u7eed\u3011${mainline}`,
    `- 将投递接手指令（mode: queue，约 ${INSTRUCTION(args.docPath, relayId, mainline).length} 字符）`,
    `- 将回写档头：链 / 已交接时间 / 接手会话`,
    `- 将追加 1 行审计到 ${home}\\steward\\audit\\`,
  ].join('\n')

  appendAudit(home, {
    ts: new Date().toISOString(),
    actor: 'agent',
    actionId: 'relay',
    dryRun: true,
    result: 'preview',
    mainline,
    sourceSessionId,
    relayId,
  })
  return { ...base, kind: 'preview', exitCode: 0, message: preview }
}

export function apply(ctx, config) {
  const tools = defineTool({
    name: 'steward_relay',
    description:
      '会话接力：把当前会话的活交给一个新会话。先自己写好交接档（七段契约，见设计稿），再用本工具派发。'
      + '缺省只预览（dryRun 缺省 true），确认真执行请传 dryRun:false。',
    parameters: {
      docPath: { type: 'string', required: true, description: '交接档的绝对路径' },
      mainline: { type: 'string', description: '主线名，缺省从档里或文件名推断' },
      dryRun: { type: 'boolean', description: '缺省 true：只预览不执行' },
    },
    output: {
      schema: OUTPUT,
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args, exec) {
      return runRelay(ctx, config ?? Config({}), args, exec)
    },
  })

  ctx.effect(() => ctx.tools.register(tools))
}
```

- [ ] **Step 5: 跑测试确认通过**

```powershell
& $node --test test/ 2>&1 | Select-Object -Last 25
```
Expected: PASS。**若因 `@deepseek-ai/schemastery` / `@deepseek-ai/dsh-tools` 未安装而 import 失败**，先装：

```powershell
dsh plugin --profile steward-dev add '@deepseek-ai/schemastery@3.18.4'
```
并在仓库里建 `node_modules` 软链或直接 `pnpm add -D`（本机 pnpm 在 `<dsh-install>\resources\runtime\pnpm`）。**只装 peer，别装运行时依赖。**

- [ ] **Step 6: Commit**

```powershell
& $git -C '<repo>' add lib/index.js cordis.patch.yml test/index.test.js
& $git -C '<repo>' commit -m "feat: Config（出厂开关全关）+ steward_relay 工具 + dryRun 预览路径"
```

---

### Task 8: `lib/index.js` — 真执行路径

**Files:**
- Modify: `lib/index.js`
- Modify: `test/index.test.js`

**Interfaces:**
- Consumes: Task 3 的 `acquireLock` / `releaseLock` / `lockPath`；Task 1 笔记里的服务键名
- Produces: `dispatchRelay(ctx, config, { mainline, relayId, docPath, sourceSessionId, text })` —— 执行 §3 的 ⑦–⑫ 步

- [ ] **Step 1: 写失败的测试**

追加到 `test/index.test.js`。`fakeCtx` / `tempHome` / `GOOD_DOC` 已在 Task 7 定义，**不要重复定义**：

```js
import { dispatchRelay } from '../lib/index.js'

const CFG = Config({ enabled: true, lockTtlMs: 30000 })

const callArgs = (docPath, i = 0) => ({
  mainline: '大管家',
  relayId: `relay-session-src-20261006120${i}`,
  docPath,
  sourceSessionId: 'session-src',
  text: GOOD_DOC,
})

test('投递必须用 queue，绝不能用 inject', async () => {
  const { home, docPath } = tempHome()
  const ctx = fakeCtx()
  const res = await dispatchRelay(ctx, CFG, callArgs(docPath))

  assert.equal(res.kind, 'dispatched')
  const promptCall = ctx.calls.find((c) => c[0] === 'prompt')
  assert.ok(promptCall, '没有发起投递')
  assert.equal(promptCall[1].mode, 'queue')
  assert.notEqual(promptCall[1].mode, 'inject')
  assert.equal(readAudit(home, 2, new Date()).some((r) => r.result === 'dispatched'), true)
})

test('单飞：同一源会话并发 10 次，只有 1 次真执行', async () => {
  const { docPath } = tempHome()
  const ctx = fakeCtx()
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => dispatchRelay(ctx, CFG, callArgs(docPath, i))),
  )
  assert.equal(results.filter((r) => r.kind === 'dispatched').length, 1)
  assert.equal(results.filter((r) => r.exitCode === 0).length, 10, '抢不到锁的必须静默退出码 0')
  assert.equal(ctx.calls.filter((c) => c[0] === 'create').length, 1, '只许建一个会话')
})

test('回写档头：三个键进「头部」段，且重复执行不堆叠', async () => {
  const { docPath } = tempHome()
  const ctx = fakeCtx()
  await dispatchRelay(ctx, CFG, callArgs(docPath))
  const first = readFileSync(docPath, 'utf8')
  assert.ok(/^\s*链:\s*relay-session-src-/m.test(first))
  assert.ok(/^\s*接手会话:\s*session-new\s*$/m.test(first))

  await dispatchRelay(ctx, CFG, callArgs(docPath, 1))
  const second = readFileSync(docPath, 'utf8')
  assert.equal((second.match(/^\s*链:/gm) ?? []).length, 1, '链键被堆叠了')
})
```

在 `test/index.test.js` 顶部的导入里补上 `readFileSync`：

```js
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
```


- [ ] **Step 2: 跑测试确认失败**

```powershell
& $node --test test/index.test.js 2>&1 | Select-Object -Last 20
```
Expected: FAIL — `dispatchRelay is not a function`

- [ ] **Step 3: 实现 `dispatchRelay`**

追加到 `lib/index.js`（把 `acquireLock`、`releaseLock`、`lockPath`、`writeTextAtomic` 加进 `./store.js` 的导入，把 `permissionOk` 加进 `./relay.js` 的导入，并在顶部补 `import { readFileSync } from 'node:fs'`）：

```js
/** 把接力元信息回写到档的「头部」段末尾（spec §3 步骤 ⑪）。先剔除旧键再插入 → 幂等。 */
function rewriteHeader(text, { relayId, sessionId, at }) {
  const KEY = /^\s*(链|已交接|接手会话)\s*[:：]/
  const lines = String(text).split(/\r?\n/).filter((l) => !KEY.test(l))
  const headIdx = lines.findIndex((l) => /^\s*#{1,6}\s+头部\s*$/.test(l))
  let insertAt = lines.length
  if (headIdx >= 0) {
    for (let i = headIdx + 1; i < lines.length; i++) {
      if (/^\s*#{1,6}\s+\S/.test(lines[i])) { insertAt = i; break }
    }
  }
  lines.splice(insertAt, 0, `链: ${relayId}`, `已交接: ${at}`, `接手会话: ${sessionId}`)
  return lines.join('\n')
}

export async function dispatchRelay(ctx, config, { mainline, relayId, docPath, sourceSessionId, text }) {
  const home = dshHome()
  const lock = lockPath(home, `relay-${sourceSessionId}`)
  const audit = (row) =>
    appendAudit(home, { ts: new Date().toISOString(), actor: 'agent', actionId: 'relay', dryRun: false, mainline, sourceSessionId, relayId, ...row })

  const got = acquireLock(lock, { ttlMs: config.lockTtlMs ?? 120000 })
  if (!got) {
    audit({ result: 'skipped', gate: 'single-flight' })
    return { kind: 'skipped', exitCode: 0, relayId, gate: 'single-flight', message: '已有同源会话的接力在进行，本次静默退出。' }
  }

  let newId
  try {
    // ⑦ 建会话（cwd 缺省与源会话同源；字段以 Task 1 笔记为准）
    const created = await ctx.sessionController.create({})
    newId = created.sessionId

    // ⑧ 权限回读断言（R-2：走序表）
    const srcAgent = await ctx.sessionController.resolveAgent(sourceSessionId)
    const dstAgent = await ctx.sessionController.resolveAgent(newId)
    const sourceMode = ctx.sessionProjections.stateOf(srcAgent.session, 'sandboxMode') ?? 'workspace-write'
    const targetMode = ctx.sessionProjections.stateOf(dstAgent.session, 'sandboxMode') ?? 'workspace-write'
    if (!permissionOk(sourceMode, targetMode)) {
      audit({ result: 'failed', gate: 'permission', newSessionId: newId })
      // 只报不收拾：归档不可逆（spec §1 N9）
      return { kind: 'partial', exitCode: 5, relayId, gate: 'permission', message: `权限降级（源 ${sourceMode} → 新 ${targetMode}），已建会话 ${newId} 但未投递。请人工处置该空会话。` }
    }

    // ⑨ 命名
    await ctx.sessionTitle.rename(newId, `\u3010\u7eed\u3011${mainline}`)

    // ⑩ 投递 —— R-1：只能 queue 或 steer，inject 不唤醒
    const mode = 'queue'
    if (mode !== 'queue' && mode !== 'steer') throw new Error('R-1 违反：投递模式只能是 queue 或 steer')
    await ctx.sessionController.prompt({
      requestId: `${relayId}-prompt`,
      sessionId: newId,
      mode,
      content: [{ type: 'text', text: INSTRUCTION(docPath, relayId, mainline) }],
    })

    // ⑪ 回写档头（原子重写原文，不是旁挂文件）
    writeTextAtomic(docPath, rewriteHeader(text, { relayId, sessionId: newId, at: new Date().toISOString() }))

    // ⑫ 审计
    audit({ result: 'dispatched', newSessionId: newId })
    return { kind: 'dispatched', exitCode: 0, relayId, message: `已派发。新会话 ${newId}，链标识 ${relayId}。` }
  } catch (error) {
    audit({ result: 'failed', newSessionId: newId, error: String(error?.message ?? error) })
    return { kind: 'partial', exitCode: newId ? 3 : 1, relayId, message: `接力中断：${String(error?.message ?? error)}` }
  } finally {
    releaseLock(lock)
  }
}
```

> `stateOf` 的第一个参数是 **session 对象**，所以两边都经 `resolveAgent()` 取 `.session`——这是已核实存在的服务方法（`dsh-api-session-controller`），不要另造 helper。


- [ ] **Step 4: 把 `dispatchRelay` 接进 `runRelay`**

把 Task 7 里 `runRelay` 的尾段替换为：

```js
  if (dryRun) return { ...base, kind: 'preview', exitCode: 0, message: preview }
  return dispatchRelay(ctx, config, { mainline, relayId, docPath: args.docPath, sourceSessionId, text })
```

（`preview` 变量定义保持不变；先 `if (dryRun)` 再 dispatch——**预览路径不得触达任何写操作**。）

- [ ] **Step 5: 跑测试确认通过**

```powershell
& $node --test test/ 2>&1 | Select-Object -Last 25
```
Expected: PASS，含"投递必须用 queue"这条。

- [ ] **Step 6: 核对 R-1 的守卫已在位**

Step 3 的 `dispatchRelay` 里已含硬断言（`const mode = 'queue'` + 模式校验），**不要再加第二处**。确认它就在 `prompt` 调用之前。

- [ ] **Step 7: Commit**

```powershell
& $git -C '<repo>' add lib/index.js test/index.test.js
& $git -C '<repo>' commit -m "feat: 真执行路径（create → 权限断言 → rename → queue 投递 → 审计）"
```

---

### Task 9: `lib/index.js` — §13 主动提醒

**Files:**
- Modify: `lib/index.js`
- Modify: `test/index.test.js`

**Interfaces:**
- Consumes: Task 2 的 `readAudit` / `appendAudit`；Task 3 的 `updateJson` / `readJson`
- Produces: `notifyLine(pct: number): string` 与 `shouldNotify(state, { now, pct, config }): boolean`

- [ ] **Step 1: 写失败的测试**

```js
import { notifyLine, shouldNotify } from '../lib/index.js'

const ncfg = { enabled: true, cooldownMinutes: 20, dailyCap: 10, growthStepPct: 5, quietFrom: 23, quietTo: 7 }

test('开关关 → 不提醒', () => {
  assert.equal(shouldNotify({}, { now: new Date('2026-10-06T12:00:00'), pct: 0.9, config: { ...ncfg, enabled: false } }), false)
})

test('首次越限提醒；未涨 5 个百分点不重复', () => {
  const now = new Date('2026-10-06T12:00:00')
  assert.equal(shouldNotify({}, { now, pct: 0.72, config: ncfg }), true)
  const st = { lastPct: 0.72, lastAt: new Date('2026-10-06T11:00:00').toISOString(), todayCount: 1, today: '2026-10-06' }
  assert.equal(shouldNotify(st, { now, pct: 0.74, config: ncfg }), false)
  assert.equal(shouldNotify(st, { now, pct: 0.78, config: ncfg }), true)
})

test('冷却期内不提醒', () => {
  const now = new Date('2026-10-06T12:00:00')
  const st = { lastPct: 0.70, lastAt: new Date('2026-10-06T11:50:00').toISOString(), todayCount: 1, today: '2026-10-06' }
  assert.equal(shouldNotify(st, { now, pct: 0.90, config: ncfg }), false)
})

test('日上限封顶', () => {
  const now = new Date('2026-10-06T12:00:00')
  const st = { lastPct: 0.70, lastAt: new Date('2026-10-06T10:00:00').toISOString(), todayCount: 10, today: '2026-10-06' }
  assert.equal(shouldNotify(st, { now, pct: 0.95, config: ncfg }), false)
})

test('免打扰时段不提醒', () => {
  const st = {}
  assert.equal(shouldNotify(st, { now: new Date('2026-10-06T23:30:00'), pct: 0.9, config: ncfg }), false)
  assert.equal(shouldNotify(st, { now: new Date('2026-10-06T03:00:00'), pct: 0.9, config: ncfg }), false)
  assert.equal(shouldNotify(st, { now: new Date('2026-10-06T07:00:00'), pct: 0.9, config: ncfg }), true)
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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function inQuietHours(hour, from, to) {
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to
}

/** 只报状态变化 + 冷却 + 日上限 + 免打扰（spec §13.3）。 */
export function shouldNotify(state, { now, pct, config }) {
  if (config.enabled !== true) return false
  if (inQuietHours(now.getHours(), config.quietFrom, config.quietTo)) return false
  const today = dayKey(now)
  const todayCount = state.today === today ? (state.todayCount ?? 0) : 0
  if (todayCount >= config.dailyCap) return false
  if (!state.lastAt) return true
  const sinceMin = (now.getTime() - new Date(state.lastAt).getTime()) / 60000
  if (sinceMin < config.cooldownMinutes) return false
  return pct - (state.lastPct ?? 0) >= config.growthStepPct / 100
}
```

- [ ] **Step 4: 接进 `apply`**

在 `apply` 里加订阅（`system-prompt/assemble` 的确切签名以 Task 1 笔记为准；本步骤按"能往系统提示追加一行"的最小用法写）：

```js
  ctx.effect(() => ctx.on('assistant/message', (payload) => {
    if (config?.notify?.enabled !== true) return
    const usage = payload?.message?.usage ?? payload?.usage
    const limit = ctx.llm?.resolveModelInfo?.(payload?.provider, payload?.model)?.contextWindow
    if (!usage || !limit) return // A9：取不到分母就不提醒，不许猜
    const pct = (usage.inputTokens ?? 0) / limit
    if (pct < (config.softLimitRatio ?? 0.7)) return
    const stateFile = `${dshHome()}\\steward\\notify-state.json`
    const state = readJson(stateFile, {})
    const now = new Date()
    if (!shouldNotify(state, { now, pct, config: config.notify })) return
    updateJson(stateFile, () => ({
      lastPct: pct,
      lastAt: now.toISOString(),
      today: dayKey(now),
      todayCount: (state.today === dayKey(now) ? (state.todayCount ?? 0) : 0) + 1,
    }))
    appendAudit(dshHome(), { ts: now.toISOString(), actor: 'plugin', actionId: 'notify', dryRun: false, result: 'sent', pct })
    ctx.systemPrompt?.append?.(notifyLine(pct))
  }))
```

**若 `system-prompt/assemble`（waterfall）是唯一可用的追加位**：改成 `ctx.on('system-prompt/assemble', (payload, next) => { ...; const out = next(); return out + '\n' + line })`——**以 Task 1 笔记的实测签名为准，两者不可混用**。

- [ ] **Step 5: 跑测试确认通过**

```powershell
& $node --test test/ 2>&1 | Select-Object -Last 25
```
Expected: PASS。

- [ ] **Step 6: Commit**

```powershell
& $git -C '<repo>' add lib/index.js test/index.test.js
& $git -C '<repo>' commit -m "feat: 主动提醒（系统提示追加一行，含冷却/日上限/免打扰/只报变化）"
```

---

### Task 10: 端到端（隔离 profile，含失败注入）+ 上 desktop

**Files:**
- Create: `README.md`
- Create: `lib/types/index.d.ts`
- Modify: `docs/superpowers/specs/2026-10-06-dajiangjun-session-relay-design.md`（§10 假设表标注实测结果）

**Interfaces:**
- Consumes: 全部
- Produces: 一份可复跑的端到端记录（写进 spec 的验证小节）

- [ ] **Step 1: 写 `README.md` 与类型声明**

`README.md` 必含：一句话是什么、怎么装（`dsh plugin --profile <p> add <path>`）、`Config` 字段表（含"出厂全关"）、工具签名与 dryRun 语义、**红线 R-1**、以及一条明确声明：**"兼容 DeepSeek Harness / 构建于 DeepSeek Harness 之上"，不代表官方背书**。

`lib/types/index.d.ts`：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { Schema } from '@deepseek-ai/schemastery'

export declare const name: 'dajiangjun'
export declare const inject: string[]
export declare const Config: Schema<any>
export declare function apply(ctx: Context, config: any): void
```

- [ ] **Step 2: 装进隔离 profile 并跑真链**

```powershell
dsh plugin --profile steward-dev add '<repo>'
dsh --profile steward-dev
```
在界面里开一个会话，让 agent 写一份合格交接档，然后调 `steward_relay({ docPath: '...' })` 看预览，再调 `steward_relay({ docPath: '...', dryRun: false })`。

Expected:
- 预览返回 `kind: 'preview'` 且**没有**新会话出现
- 真执行返回 `kind: 'dispatched'`
- 出现一个标题为 `【续】<主线名>` 的新会话
- 该新会话**自己开始跑**（状态 `running`，随后有 assistant 产出）← **这是 v1 的存在理由，必须亲眼看到**
- `~/.dsh/steward/audit/<当月>.jsonl` 多出一行 `result: 'dispatched'`

- [ ] **Step 3: 失败注入三例**

| # | 注入 | 期望 |
|---|---|---|
| 1 | 投递前杀进程（新会话已建、未投递） | 审计无 `dispatched`；退出码 3 或 5；档头无回写；重跑因去重键未命中而**允许**再试 |
| 2 | `docPath` 指向不存在的文件 | `kind: 'rejected'`、`exitCode: 5`、`gate: 'doc'`、**零新会话** |
| 3 | 在只读档位的会话里调用 | `gate: 'permission'`、`exitCode: 5`、**未投递**、已建会话留痕待人工处置 |

- [ ] **Step 4: 记下实测结论并更新 spec**

把三条注入的实际结果、以及 A1/A2/A4/A5/A6/A8/A9 的实测结论写进 spec §10，**未验证的照实写"未验证"**。

- [ ] **Step 5: 上 `desktop` profile（先备份）**

```powershell
Copy-Item "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml" "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml.bak-dajiangjun"
dsh plugin --profile desktop add '<repo>'
```
然后把下面这段**追加**到 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾（**不是覆盖**）：

```yaml
- insert:
    - id: dajiangjun
      name: dsh-dajiangjun
      config:
        enabled: false
        notify:
          enabled: false
```

刷新 GUI 验证工具出现。**出厂全关**——要真用必须先显式打开 `enabled`。

**若宿主起不来**（DSH 启动全有或全无）：用备份还原 `cordis.patch.yml`，或把那行改成 `disabled: true`，**不要删文件**。

- [ ] **Step 6: Commit**

```powershell
& $git -C '<repo>' add README.md lib/types/index.d.ts docs/superpowers/specs
& $git -C '<repo>' commit -m "docs: README + 类型声明 + 端到端实测结论（含三条失败注入）"
```

---

## 观测期（计划之后，不是任务）

上 desktop 后 **≥3 个自然日**：只开 `notify.enabled`，**不开** `enabled`（即只提醒、不真交接）。第一 KPI = 误报率（标记误报数 / 总提醒数），逐日记。

放行门槛（spec 引文档 07）：误报率 <5% **且**累计样本 ≥25 条才允许打开 `enabled`；样本不足不得放行。达标后放行当天只做"改 `cordis.patch.yml` 里的开关 + 留痕"，不改代码。
