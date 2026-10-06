import test from 'node:test'
import assert from 'node:assert/strict'
import { checkForbidden, parseDoc, resolveMainline, validateDoc } from '../lib/relay.js'

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
