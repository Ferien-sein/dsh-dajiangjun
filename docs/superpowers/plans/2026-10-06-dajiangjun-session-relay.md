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
- **测试命令一律用 `& $node --test`（跑全套）或 `& $node --test <文件名>`（跑单个）。绝不要用目录形式 `node --test test/`** —— 本机 Node **v24.21.0** 会把目录当模块 `require`，报 `Cannot find module '<repo>\test'`，**测试文件根本不会加载**（拿到的是"测试没跑"而不是失败）。已实测：无参 ✔ / 指名文件 ✔ / 目录 ✖。
- `pnpm-lock.yaml` **必须入库**：`@deepseek-ai/*` 依赖要可复现，且不入库会被后续任务的 `git add -A` 当未跟踪文件扫走。

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

**两个已知坑，按需绕**：
- **端口冲突**：正在跑的桌面宿主占着 19387。若这次 boot 报端口占用，给 app 传自己的端口（`--port 19399` 之类）——launcher 之后的参数会透传给 app。
- **`--no-open` 不被接受**：去掉它，手动关掉弹出的浏览器标签。

**判据是"目录建出来了"，不是"命令以 0 退出"**：这个 app 起服务后不会自己退，`Ctrl+C` 中断是预期终点。

- [ ] **Step 3: 装探针插件**

```powershell
dsh plugin --profile steward-dev add '<repo>\_scratch\hello'
dsh plugin --profile steward-dev list --depth 0
```
Expected: 列表里出现 `dsh-hello`。

**若 pnpm 因 peer 依赖解析失败而拒绝**（这个探针包声明了 `@deepseek-ai/cordis` peer）：加 pnpm 的 `--no-strict-peer-dependencies` 重试，或干脆把探针包的 `peerDependencies` 删掉（它只是个探针，不 import 任何东西）。**判据是"插件行列进了配置树"，不是"用了哪条 pnpm 命令"。**

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

把 §10 的 **A3**（最小插件能装进隔离 profile 并拉起）、**A7**（`inject` 服务键名）、**A10**（新增插件行的生效时机：配置树立即生效、插件代码下次 boot 才加载）标为**已验证**并附结论。

**A6**（`sessionTitle.rename()` 在新会话上生效）本任务**没有**实测，保持原状不要动它。新增的 A10 是热加载那条事实的归属，不是 A6。

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
  - `acquireLock(home: string, key: string, opts?: { ttlMs: number, now?: number }): { ok: true, stole: boolean } | null` —— **抢占成功时在函数内部**向审计流水追加一行 `actionId: 'lock-steal'`
  - `releaseLock(home: string, key: string): void`
  - `lockPath(home: string, key: string): string`

- [ ] **Step 1: 写失败的测试**

追加到 `test/store.test.js`：

```js
import { acquireLock, lockPath, releaseLock, updateJson, writeJsonAtomic } from '../lib/store.js'

// 注意：这条**不测并发**。Promise.all 里全是同步的 updateJson，Node 单线程逐个跑完，零交错；
// 即便把 updateJson 退化成"非原子读 + 直接 writeFileSync"，计数照样是 100。
// 它验证的是"连续 100 次读-改-写不丢更新、文件始终是完整 JSON"。
// 跨进程的原子性**由调用方的锁负责**（见 lib/store.js 里 updateJson 的注释），本任务不提供该保证，
// 也就不假造一个测试去暗示它成立。真要压并发得另起 worker_threads/子进程，已记入台账待办。
test('updateJson 连续 100 次读-改-写不丢更新（进程内串行）', () => {
  const h = home()
  const file = path.join(h, 'counter.json')
  writeJsonAtomic(file, { n: 0 })
  for (let i = 0; i < 100; i++) updateJson(file, (v) => ({ n: v.n + 1 }))
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
  assert.ok(acquireLock(h, 'relay-s1', { ttlMs: 60000, now: 1000 }))
  assert.equal(acquireLock(h, 'relay-s1', { ttlMs: 60000, now: 2000 }), null)
})

test('锁：过期可抢占，且抢占必须留下审计行', () => {
  const h = home()
  acquireLock(h, 'relay-s1', { ttlMs: 1000, now: 0 })
  const got = acquireLock(h, 'relay-s1', { ttlMs: 1000, now: 5000 })
  assert.equal(got.ok, true)
  assert.equal(got.stole, true)

  const rows = readAudit(h, 2, new Date(5000))
  assert.equal(rows.length, 1, '抢占没有留下审计行（doc 02 §5.6 要求「抢占并记一行审计」）')
  assert.equal(rows[0].actionId, 'lock-steal')
  assert.equal(rows[0].result, 'stolen')
  assert.equal(rows[0].reason, 'expired')
})

test('锁：损坏/半截的锁文件视为持有者已死，可被抢占（否则这把锁永久卡死）', () => {
  const h = home()
  acquireLock(h, 'relay-s1', { ttlMs: 60000, now: 0 })
  writeFileSync(lockPath(h, 'relay-s1'), '{"pid":123,"started', 'utf8') // 进程在 create 与 write 之间崩了

  const got = acquireLock(h, 'relay-s1', { ttlMs: 60000, now: 10 })
  assert.equal(got.ok, true, '半截锁文件把锁永久锁死了：held 解析成 null 时 expired 恒为 false')
  assert.equal(got.stole, true)
  assert.equal(readAudit(h, 2, new Date(10))[0].reason, 'unreadable')
})

test('锁：release 后可再抢', () => {
  const h = home()
  acquireLock(h, 'relay-s1', { ttlMs: 1000, now: 0 })
  releaseLock(h, 'relay-s1')
  assert.ok(acquireLock(h, 'relay-s1', { ttlMs: 1000, now: 10 }))
})
```

在文件顶部的导入里补上 `readdirSync`：

```js
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
```

并补 `readJson` 的导入（与 `store.js` 的导出一致）。

- [ ] **Step 2: 跑测试确认失败**

```powershell
& $node --test 2>&1 | Select-Object -Last 25
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

/**
 * 原子创建（flag:'wx'），禁止 existsSync-then-write（TOCTOU，spec R-4）。
 *
 * 签名收 `home` + `key` 而不是裸路径，是**刻意的**：doc 02 §5.6 要求「抢占并记一行审计」，
 * 而写审计需要 `home`。收不收 `home` 决定了"抢占能不能悄悄发生而不留痕"——收进来，
 * 审计就在同一个函数里，不依赖任何调用点记得补一行。
 */
export function acquireLock(home, key, { ttlMs, now = Date.now() } = {}) {
  const file = lockPath(home, key)
  mkdirSync(path.dirname(file), { recursive: true })
  try {
    writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: now, ttl: ttlMs }), { flag: 'wx' })
    return { ok: true, stole: false }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }

  const held = readJson(file, null)
  // held === null 覆盖两种情形：文件为空/半截（进程在 create 与 write 之间崩了），
  // 或内容不可解析。两者都说明持有者已死。若不这样看待，`expired` 会恒为 false，
  // 这把锁就**永远**抢不到了——活性故障比崩溃更难查。
  const unreadable = held === null || typeof held.startedAt !== 'number'
  const expired = !unreadable && now - held.startedAt > (held.ttl ?? ttlMs)
  if (!unreadable && !expired) return null

  writeJsonAtomic(file, { pid: process.pid, startedAt: now, ttl: ttlMs, stoleFrom: held })
  appendAudit(home, {
    ts: new Date(now).toISOString(),
    actor: 'plugin',
    actionId: 'lock-steal',
    dryRun: false,
    result: 'stolen',
    lock: key,
    reason: unreadable ? 'unreadable' : 'expired',
    stoleFrom: held,
  })
  return { ok: true, stole: true }
}

export function releaseLock(home, key) {
  try {
    rmSync(lockPath(home, key), { force: true })
  } catch (error) {
    // 非 ENOENT（EACCES/EBUSY）说明锁没删掉：它是活锁，靠 ttl 兜底。
    // 但**不许静默**——这条路以前 `catch {}` 吞掉一切，与"静默失效必须可观测"冲突。
    if (error.code !== 'ENOENT') process.emitWarning(`steward: releaseLock 未能删除锁 ${key}: ${error.code}`)
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```powershell
& $node --test 2>&1 | Select-Object -Last 25
```
Expected: PASS，12 个测试全绿。

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

test('内网地址：公网链接放行、内网主机名拦住', () => {
  // 公网文档链**不该**被当成内网地址。拦它没有任何安全收益——公网 URL 不泄漏内网拓扑；
  // 代价却是合法交接档被判不合格、整条接力卡住，而上游设计把**误报率列为第一 KPI**。
  assert.equal(checkForbidden('见 https://nodejs.org/api/ 的说明').ok, true)
  assert.equal(checkForbidden('见 https://github.com/kira905/ops-handoff-design 的说明').ok, true)

  // 真正的内网主机名要拦住：无点的裸主机名，与私有后缀
  assert.equal(checkForbidden('服务在 http://my-nas/ 上').ok, false)
  assert.equal(checkForbidden('服务在 http://storage.local/ 上').ok, false)
  assert.equal(checkForbidden('服务在 http://box.lan/ 上').ok, false)

  // 私网 IP 由同一类的另一条模式捕获，URL 模式**不重复覆盖**它
  assert.equal(checkForbidden('服务在 http://192.168.1.20:3080 上').ok, false)
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
  // 内网地址之一：非回环、且**不像公网 FQDN** 的 URL 主机——无点的裸主机名，或私有后缀。
  // 刻意**不**拦公网 FQDN：公网链接不泄漏内网拓扑，拦它没有安全收益，代价却是误报率，
  // 而上游设计把误报率列为第一 KPI（doc 07）。私网 IP 由本类前一条模式负责，这里不重复覆盖。
  ['内网地址', /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}(?:\.\d{1,3})?\b/, /https?:\/\/(?!127\.0\.0\.1|localhost\b)(?:[A-Za-z0-9-]+\.(?:local|lan|internal|intranet|home|corp)\b|[A-Za-z0-9-]+(?![\w.-]))/i],
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
Expected: PASS，9 个测试全绿。

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
      // ⚠️ 真实返回形状是 **{ agent } 或 { error } 的包装，不是 agent 本身**。
      // 早期这里写成 `{ session: { id } }`（照控制方的错误假设），于是**代码与替身互相印证、一起错**：
      // 53 条单测全绿、5 轮独立审查全过，却测了一个**不存在的 API 形状**，直到端到端才炸。
      // 这就是"替身照实现写"这种做法的代价——它是本项目最想避免的"假绿"。
      resolveAgent: async (id) => { calls.push(['resolveAgent', id]); return { agent: { session: { id } } } },
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

test('总开关关闭时拒且**真正的零副作用**（未读档、未留审计）', async () => {
  const { home } = tempHome()
  const ctx = fakeCtx()
  apply(ctx, Config({ enabled: false }))
  // 传一个**不存在**的路径：若实现先读档，就会返回 gate:'doc'；
  // 只有"先查开关"才会返回 'total-switch'。这一条把顺序钉死了。
  const res = await ctx.registered.execute(
    { docPath: path.join(home, 'nope.md') },
    { agent: { id: 'session-src' } },
  )
  assert.equal(res.kind, 'rejected')
  assert.equal(res.gate, 'total-switch', '读档发生在总开关之前 → 关闭时仍有副作用')
  assert.equal(ctx.calls.some((c) => c[0] === 'create'), false)
  assert.deepEqual(readAudit(home, 2, new Date()), [], '关闭时不得写审计行（spec §1 G8 零副作用）')
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
import { checkForbidden, evaluateGates, makeRelayId, preflightGates, resolveMainline, validateDoc } from './relay.js'
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

// 必填标在**属性**上，不能写在根节点：dsh-tools@0.2.0-rc.2 的 value schema DSL
// 对根任务设 allowRequired:false，根级 `required` 会被 assertAuthorKeys 抛
// "schema.required is not supported by the value schema DSL"；而 defineTool 内部是 eager 编译的，
// 所以这个错会在 apply() 当场炸，不是等到首次调用。属性级的 `required: true` 会经
// property 任务装配成同一个根 `required` 数组——产物与直接写根 required 逐字节等价（Ruling 21）。
const OUTPUT = {
  type: 'object',
  properties: {
    kind: { type: 'string', required: true },
    exitCode: { type: 'number', required: true },
    gate: { type: 'string' },
    relayId: { type: 'string' },
    message: { type: 'string', required: true },
  },
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

  // ⚠️ 前置闸门必须在**读档之前**跑：总开关关着时"零副作用"意味着不读档、不落审计，
  // 且返回的是"未启用"而不是误导性的"读不到交接档"（Ruling 34，端到端实测抓到）。
  const pre = preflightGates({ config, isSubagent: isSubagentCaller(exec) })
  if (!pre.ok) {
    return {
      kind: 'rejected', exitCode: pre.code, gate: pre.gate,
      message: `${pre.reason}。（关闭时零副作用：未读档、未留审计）`,
    }
  }

  let text
  try {
    text = readFileSync(args.docPath, 'utf8')
  } catch {
    // spec §5：每道闸都必须留审计行（带原因）。这里以前直接 return 不落审计，
    // 端到端实测才暴露——"读不到档"是闸门拒绝，不是无事发生。
    appendAudit(home, {
      ts: new Date().toISOString(), actor: 'agent', actionId: 'relay', dryRun,
      result: 'rejected', gate: 'doc', reason: 'doc-unreadable', sourceSessionId,
    })
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
& $node --test 2>&1 | Select-Object -Last 25
```
Expected: PASS。

`@deepseek-ai/schemastery` 与 `@deepseek-ai/dsh-tools` 已在 Task 2 Step 1 装进本仓库。**若这里仍报解析不到**，说明 Task 2 Step 1 的 install 走了退路——照 `docs/notes/dsh-api-notes.md` 里记的那条路补齐，不要改成 `dsh plugin --profile ... add`（那是宿主运行时的解析路径，解决不了 repo 内 `import`）。

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
- Consumes: Task 3 的 `acquireLock(home, key, opts)` / `releaseLock(home, key)`（抢占的审计行由 `acquireLock` 自己写，调用点不必补）；Task 1 笔记里的服务键名
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

  // 第二次必须喂**改后**的档文本（从磁盘读回来），否则 rewriteHeader 的去重分支根本没被走到：
  // 喂原始 GOOD_DOC 的话结果是从原文本重新生成，永远只有一条链键 → 断言恒真、删掉过滤也能过。
  // 生产路径 runRelay 正是从磁盘读档，所以第二次读到的文本**含**上次写的键——那条过滤真的在承重。
  await dispatchRelay(ctx, CFG, { ...callArgs(docPath, 1), text: readFileSync(docPath, 'utf8') })
  const second = readFileSync(docPath, 'utf8')
  assert.equal((second.match(/^\s*链:/gm) ?? []).length, 1, '链键被堆叠了')
  assert.equal((second.match(/^\s*接手会话:/gm) ?? []).length, 1, '接手会话键被堆叠了')
  assert.equal((second.match(/^\s*已交接:/gm) ?? []).length, 1, '已交接键被堆叠了')
})

test('权限投影读不到（resolveAgent 返回 { error }）→ 拒、退出码 5、不投递', async () => {
  const { home, docPath } = tempHome()
  const calls = []
  const ctx = fakeCtx({
    sessionController: {
      create: async () => { calls.push('create'); return { sessionId: 'session-new' } },
      resolveAgent: async () => { calls.push('resolveAgent'); return { error: { code: 'session/not-found' } } },
      prompt: async () => { calls.push('prompt'); return { accepted: true } },
    },
  })
  const res = await dispatchRelay(ctx, CFG, callArgs(docPath))
  assert.equal(res.kind, 'partial')
  assert.equal(res.exitCode, 5)
  assert.equal(res.gate, 'permission')
  assert.equal(calls.includes('prompt'), false, '权限读不到却仍然投递了')
  assert.equal(readAudit(home, 2, new Date()).some((r) => r.gate === 'permission'), true, '权限闸没留审计行')
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

追加到 `lib/index.js`（把 `acquireLock`、`releaseLock`、`writeTextAtomic` 加进 `./store.js` 的导入，把 `permissionOk` 加进 `./relay.js` 的导入，并在顶部补 `import { readFileSync } from 'node:fs'`）：

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
  const lockKey = `relay-${sourceSessionId}`
  const audit = (row) =>
    appendAudit(home, { ts: new Date().toISOString(), actor: 'agent', actionId: 'relay', dryRun: false, mainline, sourceSessionId, relayId, ...row })

  // 抢占的审计行由 acquireLock 自己写（doc 02 §5.6），调用点不需要补
  const got = acquireLock(home, lockKey, { ttlMs: config.lockTtlMs ?? 120000 })
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
    // ⚠️ `resolveAgent()` 返回 `{ agent }` 或 `{ error }` 的包装，**不是 agent 本身**。
    // 端到端实测：写成 `.session` 会得到 undefined → `stateOf` 抛 "reading 'header'"，
    // 而单测因为 fakeCtx 也照错的形状写，全程绿。见 docs/notes/dsh-api-notes.md §11。
    const srcFound = await ctx.sessionController.resolveAgent(sourceSessionId)
    const dstFound = await ctx.sessionController.resolveAgent(newId)
    const modeOf = (found) =>
      found?.agent ? ctx.sessionProjections.stateOf(found.agent.session, 'sandboxMode') : undefined
    const sourceMode = modeOf(srcFound)
    const targetMode = modeOf(dstFound)
    if (!sourceMode || !targetMode || !permissionOk(sourceMode, targetMode)) {
      audit({ result: 'failed', gate: 'permission', newSessionId: newId, sourceMode, targetMode })
      // 只报不收拾：归档不可逆（spec §1 N9）
      return { kind: 'partial', exitCode: 5, relayId, gate: 'permission', message: `权限读取失败或降级（源 ${sourceMode ?? '读不到'} → 新 ${targetMode ?? '读不到'}），已建会话 ${newId} 但未投递。请人工处置该空会话。` }
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
    // 失败发生在 create() 之后就**必须点名那个会话**：它可能已经收到投递。
    // 不点名的后果是具体且危险的——去重闸只认 result === 'dispatched' 的行，
    // 所以人工在不知情下重试会**再投一次**，而那个已投递的会话没人能指认（Ruling 24）。
    const orphan = newId
      ? `已建会话 ${newId}（失败可能发生在其收到投递之后），请人工核查该会话再决定是否重试；`
      : ''
    return { kind: 'partial', exitCode: newId ? 3 : 1, relayId, message: `接力中断：${String(error?.message ?? error)}。${orphan}链标识 ${relayId}。` }
  } finally {
    releaseLock(home, lockKey)
  }
}
```

> `stateOf` 的第一个参数是 **session 对象**，所以两边都经 `resolveAgent()` 取 `.session`——这是已核实存在的服务方法（`dsh-api-session-controller`），不要另造 helper。


- [ ] **Step 4: 把 `dispatchRelay` 接进 `runRelay`**

把 Task 7 里 `runRelay` 的尾段替换为下面**三段**（不是两行——预览的审计行必须留在预览分支**内**）：

```js
  if (dryRun) {
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
  return dispatchRelay(ctx, config, { mainline, relayId, docPath: args.docPath, sourceSessionId, text })
```

**为什么不能照字面只写两行**（Ruling 22）：Task 7 的原代码里，那条预览行的 `appendAudit` 就落在这段尾段中。
- 把它一并删掉 → 预览不再留审计行，**Task 7 的 `rows.length === 1` 断言当场挂**；
- 把它留在 `if (dryRun)` 之外 → **真执行路径也会写一条幽灵 `preview` 行**，污染审计流水与闸门计数。

所以必须是这样三段：预览分支内写预览行并返回；否则才走 dispatch。`preview` 变量本身的构造保持不变，**预览路径不得触达任何真实写操作**。

- [ ] **Step 5: 跑测试确认通过**

```powershell
& $node --test 2>&1 | Select-Object -Last 25
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

**优先走非交互路线。本步骤必须尽量不依赖人肉点 GUI。**

先试 headless（`dsh headless "<task>"` 会答一个任务、打印结果、然后退出）：

```powershell
dsh plugin --profile headless add '<repo>'
dsh headless "先写一份合格的七段交接档到 <临时路径>，然后调用 steward_relay 工具：先不带 dryRun 参数预览，再带 dryRun:false 真执行。把两次的工具返回原文打印出来。"
```

若 `headless` profile 存在且能装上本插件，**这条就能无人值守地把真链跑完并打印结果——这是首选路线。**

**若 headless 不可用**（profile 不存在 / 装不进 / 驱动不了工具 / 拿不到可观测输出），**不要**改用"打开 GUI 点点看"去凑证据，**也不要**用别的间接信号代替。**停下来报 BLOCKED**，说清卡在哪一步、试了什么、需要什么。端到端验证需要人肉介入时，协调它是控制方与使用者的事，不是你硬凑的范围。

**绝不允许**（任一违反即视为伪造证据）：
- 把没跑过的链写成跑过了
- 把单元测试通过当成端到端通过
- 把"预览返回了 `preview`"当成"新会话真的自己开工了"

Expected（能跑到哪条就报哪条，跑不到的照实写"未验证"）：
- 预览返回 `kind: 'preview'`，且**没有**新会话出现
- 真执行返回 `kind: 'dispatched'`
- 出现一个标题为 `【续】<主线名>` 的新会话
- 该新会话**自己开始跑**（状态 `running`，随后有 assistant 产出）← **这是 v1 的存在理由，必须真的看到**
- `~/.dsh/steward/audit/<当月>.jsonl` 多出一行 `result: 'dispatched'`
- 若插件在 profile 里起不来：先看宿主日志；**装在隔离 profile 里起不来不算阻塞**，是 Step 1 该查清的东西，照实报告即可

- [ ] **Step 3: 失败注入三例**

| # | 注入 | 期望 | 无人值守可复现？ |
|---|---|---|---|
| 1 | 投递前杀进程（新会话已建、未投递） | 审计无 `dispatched`；退出码 3 或 5；档头无回写；重跑因去重键未命中而**允许**再试 | 难——要精确掐在 create 与 prompt 之间 |
| 2 | `docPath` 指向不存在的文件 | `kind: 'rejected'`、`exitCode: 5`、`gate: 'doc'`、**零新会话** | **容易**，且完全不产生副作用 |
| 3 | 在只读档位的会话里调用 | `gate: 'permission'`、`exitCode: 5`、**未投递**、已建会话留痕待人工处置 | 需能指定沙箱档位起会话 |

**#2 必做**（走 rejection 分支、零副作用，无人值守最容易复现）。#1 与 #3 能通过 headless/脚本复现就做；**做不到就如实写"未能验证"，并说明缺什么条件**——**不要**用改代码、打桩或手工构造返回值来伪造这三条。

这一节的价值不是"三条都绿"，而是**如实说清哪几条在无人值守下复现得了**。

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


---

## 终审修复（全分支审查 Ruling 36–39）

> 本节的发现来自**最终整分支审查**（全分支 diff `85031e8..6a53c9b`，37 commit）。上面各任务的代码块是**当时**的参考实现，未逐条回写；以本节为准。

### Ruling 36（**阻断项**）：`isSubagentCaller` 用 `exec.parent` 判子代理是错的

`exec.parent` **只在 PTC（`run_code` / `workflow`）嵌套派发时**被赋值（`dsh-tools/lib/index.js:1306`、`dsh-tools/lib/types/ptc.js:439`，均为 `parent: exec.token`）；而主会话与子代理的 agent-loop 工具调用**从不设它**（`dsh-agent-loop` 内 `parent:` 零命中）。

后果两头都错：① **子代理不会被拦**，spec §8.3 的调用者白名单形同虚设；② 主会话在 `run_code`/`workflow` 里调 `steward_relay` 会被**误判成子代理而拒掉**。

**这是与已修 4 处同款的第 5 个假绿**：唯一那条「子代理 → 拒」的测试是**直接喂 `isSubagent: true`**，绕过了真正要验的 `isSubagentCaller`。

**修法**：正确判据是 **`exec.agent.session.header.parentSession`**（`dsh-subagent` 对子会话写该字段；`CreateAgentOptions.meta.parentSession`）。并补一条**经由 `isSubagentCaller` 本身**的测试（构造 `exec.agent.session.header.parentSession` 存在 / 不存在两种），而不是喂布尔值。

### Ruling 37（Important）：`validateDoc` 对「头部含 `主线:`」不校验 + `resolveMainline` fail-open

spec §4 要求段 1 头部须含 `主线:`，第 5 段须有有序列表首项，主线名取不到则**拒绝接力**。现实现：`validateDoc` 不检查头部 `主线:`；`resolveMainline` 取不到时返回**空串**而非 `null`，`runRelay` 又用 `?? args.mainline ?? ''` 把它吞成空主线 → **fail-open**。

**修法**：`validateDoc` 增加「头部须含 `主线:`」校验；`resolveMainline` 取不到返回 `null`；`runRelay` 对空主线**拒绝**（`gate: 'doc'`），不得回落到空串。

### Ruling 38（Important）：`create({})` 未传 cwd（注释不实）+ 权限降级/退出码路径零测试

- `create({})` 没有传 `cwd`，而代码注释写「cwd 同源会话」——**不实**。真实的 `defaultCwd` 是 `process.cwd()`。要么显式传源会话的 cwd，要么把注释改成事实（选定并写明）。
- 权限**降级**路径、退出码 3、退出码 1 三条路径**零测试**：因为 `fakeCtx.stateOf` 是常量，永远返回同一个档位，降级永不触发。补 `stateOf` 可变的替身 + 三条断言。

### Ruling 39（Minor 但终审判定必须修）：死导出与文档/注释失实

- **删除 `dedupeKey`**（定义、plan Interfaces 声明、`test/relay.test.js` 的未使用 import 一并清掉）。它无任何消费者——去重闸直接比对 `sourceSessionId`。
- `README.md` 写「53 个测试」，实测 **55**。
- `lib/index.js:92,113` 有过时注释。

### 控制方流程疏漏（记录备查）

- `docs/三形状对照.md`（141 行，一份**下一期决策稿**）是**接力派发出去的新会话在端到端过程中写的**，而控制方用 `git add -A` 把它卷进了 `16e1a3b`。**教训：`git add -A` 会提交不是我写的文件。** 该文件**保留**——它是"接力真的产出有用东西"的实证，但需在分支总结里点名它的来历。


### Ruling 41（**复审新发现**）：R36 的判据过宽，会把 `fork` 会话误判成子代理

`header.parentSession != null` 太宽。控制方独立核实：

- **子代理**同时写两样：`dsh-subagent/lib/types/child-agent.js:117` `parentSession: parentHeader.id` + `:121` `origin: 'subagent'`
- **`fork`** 只写 `parentSession`：`dsh-api-session-controller/lib/types/commands.js:254` `parentSession: source.header.id`，附近**没有** `origin`
- 宿主自己的判别器用的是 **`origin === 'subagent'`**（`dsh-api-session-controller/lib/index.js:126-132`；`commands.js:522` 亦以 `source.origin !== 'subagent'` 判别）

**后果**：fork 出来的会话是**合法调用者**，却会被当成子代理拒掉（功能回归，非安全危害）。

**修法**：`isSubagentCaller` 收紧为 **`exec?.agent?.session?.header?.origin === 'subagent'`** —— 与宿主判别器**逐字一致**。刻意不自己发明 `parentSession != null && origin === 'subagent'` 这种变体：**那正是"同一事实两处口径"，下次宿主改动时会再次错判。**

**补测试**：必须覆盖 **fork 形态**（`parentSession` 存在、`origin` 缺失）→ **放行**；连同已有的「子代理 `origin:'subagent'` → 拒」与「普通会话 → 放行」。
