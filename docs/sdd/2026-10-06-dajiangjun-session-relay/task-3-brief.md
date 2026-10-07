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

