import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Config, apply } from '../lib/index.js'
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
