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
