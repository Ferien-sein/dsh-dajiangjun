import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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
