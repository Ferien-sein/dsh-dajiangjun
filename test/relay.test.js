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
