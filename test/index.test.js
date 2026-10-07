import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Config, apply, dispatchRelay, notifyLine, pressurePct, shouldNotify } from '../lib/index.js'
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
      // ⚠️ 真实签名是 prompt(request, signal)，signal 是 @Remote 取消参数、直接调用时必须显式传。
      // 端到端第三个被抓的 bug：实现写成 prompt(request) 少传 signal → signal.throwIfAborted() 抛 undefined。
      prompt: async (req, signal) => { if (!signal?.throwIfAborted) throw new Error('prompt 需要 signal（真实签名 prompt(request, signal)）'); calls.push(['prompt', req]); return { accepted: true } },
      // ⚠️ 真实返回形状是 **{ agent } 或 { error } 的包装，不是 agent 本身**。
      // 早期这里写成 `{ session: { id } }`（照控制方的错误假设），于是代码与替身互相印证、一起错：
      // 53 条单测全绿、5 轮独立审查全过，却测了一个不存在的 API 形状，直到端到端才炸。
      // 这就是"替身照实现写"的代价——本项目最想避免的"假绿"。
      resolveAgent: async (id) => { calls.push(['resolveAgent', id]); return { agent: { session: { id } } } },
    },
    // ⚠️ 真实签名是 rename(session, title)，第一参是 **session 对象**，不是 sessionId。
    // 端到端第二个被抓的 bug：实现写成 rename(newId, title)，newId 是字符串 → session.id 为 undefined。
    sessionTitle: { rename: async (session, title) => { if (!session?.id) throw new Error('rename 需要 session 对象'); calls.push(['rename', session.id, title]); return { title, eventSeq: 1 } } },
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

test('总开关关闭时拒且**真正的零副作用**（未读档、未留审计）', async () => {
  const { home } = tempHome()
  const ctx = fakeCtx()
  apply(ctx, Config({ enabled: false }))
  // 传一个**不存在**的路径：若实现先读档，就会返回 gate:'doc'；
  // 只有"先查开关"才会返回 'total-switch'。这一条把顺序钉死了。
  const res = await ctx.registered.execute(
    { docPath: path.join(home, 'nope.md') },
    { agent: { id: 'session-src' } },
  )
  assert.equal(res.kind, 'rejected')
  assert.equal(res.gate, 'total-switch', '读档发生在总开关之前 → 关闭时仍有副作用')
  assert.equal(ctx.calls.some((c) => c[0] === 'create'), false)
  assert.deepEqual(readAudit(home, 2, new Date()), [], '关闭时不得写审计行（spec §1 G8 零副作用）')
})

test('新 home 的审计流水为空', () => {
  const { home } = tempHome()
  assert.deepEqual(readAudit(home, 2, new Date()), [])
})

test('失败注入 #2：docPath 不存在 → 拒、退出码 5、零新会话、且必须留审计行', async () => {
  const { home } = tempHome()
  const ctx = fakeCtx()
  apply(ctx, Config({ enabled: true }))
  const missing = path.join(home, '查无此档.md')

  // dryRun:false 才是"真执行"路径——注入 #2 要验的正是这条路上读不到档会怎样
  const res = await ctx.registered.execute({ docPath: missing, dryRun: false }, { agent: { id: 'session-src' } })

  assert.equal(res.kind, 'rejected')
  assert.equal(res.exitCode, 5)
  assert.equal(res.gate, 'doc')
  assert.equal(ctx.calls.some((c) => c[0] === 'create'), false, '读不到档却建了会话')

  // 「读不到档」是闸门拒绝，不是无事发生——spec §5 要求每道闸都留一行审计（带原因）。
  // 这里以前 catch 后直接 return，端到端实测才发现这条拒绝路径**不写审计**，
  // 与 §5 不符。补这条断言，防它再退化。
  const rows = readAudit(home, 2, new Date())
  assert.equal(rows.length, 1, '读不到档的拒绝路径没留审计行')
  assert.equal(rows[0].result, 'rejected')
  assert.equal(rows[0].gate, 'doc')
  assert.equal(rows[0].reason, 'doc-unreadable')
  assert.equal(rows[0].dryRun, false, '缺省 dryRun:true 之外的显式调用应记 dryRun:false')
})

test('子代理判据：header.origin=subagent → 拒（caller，退出码 2）', async () => {
  const { docPath } = tempHome()
  const ctx = fakeCtx()
  apply(ctx, Config({ enabled: true }))
  // 必须经由 isSubagentCaller 本身：子会话的判据是 header.origin === 'subagent'（与宿主判别器逐字一致），不是 exec.parent。
  const res = await ctx.registered.execute(
    { docPath },
    { agent: { id: 'session-src', session: { header: { origin: 'subagent', parentSession: 'session-parent' } } } },
  )
  assert.equal(res.kind, 'rejected')
  assert.equal(res.gate, 'caller', '子代理（origin=subagent）没被拦 → 白名单形同虚设')
  assert.equal(res.exitCode, 2)
})

test('主会话判据：header 无 parentSession → 不是子代理（走预览）', async () => {
  const { docPath } = tempHome()
  const ctx = fakeCtx()
  apply(ctx, Config({ enabled: true }))
  const res = await ctx.registered.execute(
    { docPath },
    { agent: { id: 'session-src', session: { header: {} } } },
  )
  assert.equal(res.kind, 'preview')
})

test('fork 判据：有 parentSession 无 origin → 放行（走预览）', async () => {
  const { docPath } = tempHome()
  const ctx = fakeCtx()
  apply(ctx, Config({ enabled: true }))
  // fork 也写 parentSession，但不写 origin:'subagent'（commands.js:254）。它是有权发起接力的合法调用者，
  // 不得被误判成子代理而拒掉（Ruling 41——「parentSession != null」判据过宽）。
  const res = await ctx.registered.execute(
    { docPath },
    { agent: { id: 'session-src', session: { header: { parentSession: 'session-parent' } } } },
  )
  assert.equal(res.kind, 'preview')
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

test('权限投影读不到（resolveAgent 返回 { error }）→ 拒、退出码 5、不投递', async () => {
  const { home, docPath } = tempHome()
  const calls = []
  const ctx = fakeCtx({
    sessionController: {
      create: async () => { calls.push('create'); return { sessionId: 'session-new' } },
      resolveAgent: async () => { calls.push('resolveAgent'); return { error: { code: 'session/not-found' } } },
      prompt: async () => { calls.push('prompt'); return { accepted: true } },
    },
  })
  const res = await dispatchRelay(ctx, CFG, callArgs(docPath))
  assert.equal(res.kind, 'partial')
  assert.equal(res.exitCode, 5)
  assert.equal(res.gate, 'permission')
  assert.equal(calls.includes('prompt'), false, '权限读不到却仍然投递了')
  assert.equal(readAudit(home, 2, new Date()).some((r) => r.gate === 'permission'), true, '权限闸没留审计行')
})

test('建会话传源会话的 cwd（不靠 process.cwd() 碰巧一致）', async () => {
  const { docPath } = tempHome()
  const ctx = fakeCtx({
    sessionController: {
      create: async (req) => { ctx.calls.push(['create', req]); return { sessionId: 'session-new' } },
      resolveAgent: async (id) => ({ agent: { session: { id, header: { cwd: 'E:/src-cwd' } } } }),
    },
  })
  await dispatchRelay(ctx, CFG, callArgs(docPath))
  const createCall = ctx.calls.find((c) => c[0] === 'create')
  assert.equal(createCall[1].cwd, 'E:/src-cwd', '建会话没传源会话的 cwd → 新会话 cwd 漂到 process.cwd()')
})

test('权限降级：源 danger-full-access → 新 workspace-write → 拒、退出码 5、不投递', async () => {
  const { home, docPath } = tempHome()
  const calls = []
  const ctx = fakeCtx({
    sessionController: {
      create: async () => { calls.push('create'); return { sessionId: 'session-new' } },
      resolveAgent: async (id) => { calls.push('resolveAgent'); return { agent: { session: { id, header: { cwd: 'E:/x' } } } } },
      prompt: async () => { calls.push('prompt'); return { accepted: true } },
    },
    sessionProjections: {
      stateOf: (session) => (session.id === 'session-src' ? 'danger-full-access' : 'workspace-write'),
    },
  })
  const res = await dispatchRelay(ctx, CFG, callArgs(docPath))
  assert.equal(res.kind, 'partial')
  assert.equal(res.exitCode, 5)
  assert.equal(res.gate, 'permission')
  assert.equal(calls.includes('prompt'), false, '权限降级却仍然投递了')
  assert.equal(readAudit(home, 2, new Date()).some((r) => r.gate === 'permission'), true)
})

test('create 之后失败（prompt 抛错）→ 退出码 3、点名已建会话', async () => {
  const { docPath } = tempHome()
  const ctx = fakeCtx({
    sessionController: {
      create: async () => ({ sessionId: 'session-new' }),
      resolveAgent: async (id) => ({ agent: { session: { id, header: { cwd: 'E:/x' } } } }),
      prompt: async () => { throw new Error('boom') },
    },
  })
  const res = await dispatchRelay(ctx, CFG, callArgs(docPath))
  assert.equal(res.kind, 'partial')
  assert.equal(res.exitCode, 3)
  assert.ok(res.message.includes('session-new'), '失败发生在 create 之后，必须点名那个会话')
})

test('create 失败 → 退出码 1', async () => {
  const { docPath } = tempHome()
  const ctx = fakeCtx({
    sessionController: {
      create: async () => { throw new Error('create boom') },
      resolveAgent: async (id) => ({ agent: { session: { id, header: { cwd: 'E:/x' } } } }),
    },
  })
  const res = await dispatchRelay(ctx, CFG, callArgs(docPath))
  assert.equal(res.kind, 'partial')
  assert.equal(res.exitCode, 1)
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

test('suppressed 行不进 growth/日上限 计数，但**参与冷却**', () => {
  const now = new Date('2026-10-06T12:00:00Z')
  const rows = [row('2026-10-06T11:59:00.000Z', 0.9, 's1', 'suppressed')]
  // 1 分钟前刚记过一行 suppressed → 本条被冷却挡成 'cooldown'（静默跳过，不再写行）
  assert.equal(shouldNotify(rows, { now, pct: 0.72, sessionId: 's1', config: ncfg }).reason, 'cooldown')
  // 20 分钟后再来：冷却过了，且 growth 只跟 sent 比（没有 sent 行）→ 放行
  const later = new Date('2026-10-06T12:30:00Z')
  assert.equal(shouldNotify(rows, { now: later, pct: 0.72, sessionId: 's1', config: ncfg }).ok, true)
})

test('★ 免打扰期内不许每条消息都写一行（抑制本身不得刷屏）★', () => {
  const quiet = new Date('2026-10-06T23:30:00') // 本地时间，getHours() 用本地
  // 第一条越限：判为 quiet，由 handler 记一行 suppressed
  assert.equal(shouldNotify([], { now: quiet, pct: 0.9, sessionId: 's1', config: ncfg }).reason, 'quiet')
  // 紧接着的第二条：必须被冷却挡成 'cooldown'，而不是再写一行 suppressed
  const rows = [row(quiet.toISOString(), 0.9, 's1', 'suppressed')]
  const next = new Date(quiet.getTime() + 60_000)
  assert.equal(shouldNotify(rows, { now: next, pct: 0.91, sessionId: 's1', config: ncfg }).reason, 'cooldown')
  // 冷却窗口过后才允许再记一行 → 免打扰期内最多每 20 分钟一行，有界
  const after = new Date(quiet.getTime() + 21 * 60_000)
  assert.equal(shouldNotify(rows, { now: after, pct: 0.92, sessionId: 's1', config: ncfg }).reason, 'quiet')
})

test('提醒文案含百分比与工具名', () => {
  const line = notifyLine(0.72)
  assert.ok(line.includes('72%'))
  assert.ok(line.includes('steward_relay'))
})

test('inputTokens 小但 cacheReadTokens 大 → 提醒仍会触发（分子含缓存 token，Ruling 42）', () => {
  // 旧实现只算 inputTokens：1000/262144 ≈ 0.38% → 不触发；正确口径（含 cacheRead）≈ 77% → 触发
  const pct = pressurePct({ inputTokens: 1000, cacheReadTokens: 200000 }, 262144)
  assert.ok(pct >= 0.7, `pct=${pct} 应越过软限（旧实现漏算缓存 token）`)
})
