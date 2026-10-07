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
  assert.equal(resolveMainline(noHeader, 'C:/x/会话接力-xxxxxxxx-1200.md'), '会话接力')

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

