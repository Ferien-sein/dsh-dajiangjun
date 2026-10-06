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
