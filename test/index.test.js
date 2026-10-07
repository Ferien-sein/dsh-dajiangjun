import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Config, apply, dispatchRelay, notifyLine, shouldNotify } from '../lib/index.js'
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
    inject: (deps, cb) => {
      calls.push(['inject', deps])
      return () => {}
    },
    sessionController: {
      create: async (req) => { calls.push(['create', req]); return { sessionId: 'session-new' } },
      prompt: async (req) => { calls.push(['prompt', req]); return { accepted: true } },
      resolveAgent: async (id) => { calls.push(['resolveAgent', id]); return { session: { id } } },
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

test('总开关关闭时拒且零写操作', async () => {
  const { docPath } = tempHome()
  const ctx = fakeCtx()
  apply(ctx, Config({ enabled: false }))
  const res = await ctx.registered.execute({ docPath }, { agent: { id: 'session-src' } })
  assert.equal(res.kind, 'rejected')
  assert.equal(res.gate, 'total-switch')
  assert.equal(ctx.calls.some((c) => c[0] === 'create'), false)
})

test('新 home 的审计流水为空', () => {
  const { home } = tempHome()
  assert.deepEqual(readAudit(home, 2, new Date()), [])
})

// ---- 真执行路径（dispatchRelay）----

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

// ---- 主动提醒（spec §13）----

const ncfg = { enabled: true, cooldownMinutes: 20, dailyCap: 10, growthStepPct: 5, quietFrom: 23, quietTo: 7 }

/** 造一条 `notify` 审计行（shouldNotify 只关心这几个字段）。 */
const row = (ts, pct, sessionId = 's1', result = 'sent') =>
  ({ ts, actionId: 'notify', dryRun: false, result, sessionId, pct })

test('开关关 → 不提醒', () => {
  const v = shouldNotify([], { now: new Date('2026-10-06T12:00:00'), pct: 0.9, sessionId: 's1', config: { ...ncfg, enabled: false } })
  assert.equal(v.ok, false)
})

test('首次越限提醒；未涨 5 个百分点不重复', () => {
  const now = new Date('2026-10-06T12:00:00Z')
  assert.equal(shouldNotify([], { now, pct: 0.72, sessionId: 's1', config: ncfg }).ok, true)
  const rows = [row('2026-10-06T11:00:00.000Z', 0.72)]
  assert.equal(shouldNotify(rows, { now, pct: 0.74, sessionId: 's1', config: ncfg }).reason, 'growth')
  assert.equal(shouldNotify(rows, { now, pct: 0.78, sessionId: 's1', config: ncfg }).ok, true)
})

test('冷却期内不提醒', () => {
  const now = new Date('2026-10-06T12:00:00Z')
  const rows = [row('2026-10-06T11:50:00.000Z', 0.70)]
  assert.equal(shouldNotify(rows, { now, pct: 0.90, sessionId: 's1', config: ncfg }).reason, 'cooldown')
})

test('日上限封顶（全局，按天计）', () => {
  const now = new Date('2026-10-06T12:00:00Z')
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
  const now = new Date('2026-10-06T12:00:00Z')
  // s1 刚刚提醒过；s2 从未提醒过。s2 的**首次**提醒不得被 s1 的状态吃掉。
  // 这条正是"全局单文件状态"会挂掉的地方，也是本插件常态运行态（源会话与「续」会话并存）。
  const rows = [row('2026-10-06T11:59:00.000Z', 0.85, 's1')]
  assert.equal(shouldNotify(rows, { now, pct: 0.72, sessionId: 's1', config: ncfg }).ok, false, 's1 应被冷却挡住')
  assert.equal(shouldNotify(rows, { now, pct: 0.72, sessionId: 's2', config: ncfg }).ok, true, 's2 的首次提醒被别的会话吞了')
})

test('suppressed 行不参与计数（否则抑制会自己把自己喂饱）', () => {
  const now = new Date('2026-10-06T12:00:00Z')
  const rows = [row('2026-10-06T11:59:00.000Z', 0.9, 's1', 'suppressed')]
  assert.equal(shouldNotify(rows, { now, pct: 0.72, sessionId: 's1', config: ncfg }).ok, true)
})

test('提醒文案含百分比与工具名', () => {
  const line = notifyLine(0.72)
  assert.ok(line.includes('72%'))
  assert.ok(line.includes('steward_relay'))
})
