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
