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
