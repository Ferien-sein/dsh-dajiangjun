### Task 7: `lib/index.js` — Config、工具注册、dryRun 预览路径

**Files:**
- Create: `lib/index.js`
- Create: `cordis.patch.yml`
- Create: `test/index.test.js`

**Interfaces:**
- Consumes: Task 4/5/6 的 `validateDoc`、`checkForbidden`、`resolveMainline`、`evaluateGates`、`makeRelayId`；Task 2/3 的 `appendAudit`、`readAudit`
- Produces:
  - `name = 'dajiangjun'`、`inject`、`Config`（schemastery）、`apply(ctx, config)`
  - 内部 `runRelay(ctx, config, args, exec)` —— Task 8 在其上补真执行分支
  - 工具 `steward_relay`，输出 schema 为对象 `{ kind, exitCode, message, relayId, gate }`

- [ ] **Step 1: 写 `cordis.patch.yml`**

```yaml
# 大管家 bundle 层：profile 的 package.json 声明 dsh.bundle.patch 指向本文件。
# name 是包名（从 profile 的 node_modules 解析），不是相对路径。
- insert:
    - id: dajiangjun
      name: dsh-dajiangjun
```

- [ ] **Step 2: 写失败的测试**

`test/index.test.js` —— 用替身 ctx 测工具行为，不需要真宿主。

```js
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
      // ⚠️ 真实返回形状是 **{ agent } 或 { error } 的包装，不是 agent 本身**。
      // 早期这里写成 `{ session: { id } }`（照控制方的错误假设），于是**代码与替身互相印证、一起错**：
      // 53 条单测全绿、5 轮独立审查全过，却测了一个**不存在的 API 形状**，直到端到端才炸。
      // 这就是"替身照实现写"这种做法的代价——它是本项目最想避免的"假绿"。
      resolveAgent: async (id) => { calls.push(['resolveAgent', id]); return { agent: { session: { id } } } },
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
  const docPath = path.join(h, '大管家-xxxxxxxx-1200.md')
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
```


- [ ] **Step 3: 跑测试确认失败**

```powershell
& $node --test test/index.test.js 2>&1 | Select-Object -Last 20
```
Expected: FAIL — `Cannot find module '../lib/index.js'`

- [ ] **Step 4: 实现 `lib/index.js`（本任务只做预览路径）**

```js
import { readFileSync } from 'node:fs'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { checkForbidden, evaluateGates, makeRelayId, preflightGates, resolveMainline, validateDoc } from './relay.js'
import { appendAudit, dshHome, readAudit } from './store.js'

export const name = 'dajiangjun'

// 键名以 Task 1 的 docs/notes/dsh-api-notes.md 实测结果为准
export const inject = ['tools', 'sessionController', 'sessionTitle', 'sessionProjections']

export const Config = z.object({
  enabled: z.boolean().default(false),
  softLimitRatio: z.number().min(0.1).max(0.95).default(0.7),
  rateLimitMinutes: z.number().min(0).default(20),
  failureLimit: z.number().min(1).default(2),
  lockTtlMs: z.number().min(1000).default(120000),
  forbiddenQuoteLines: z.number().min(1).default(5),
  notify: z.object({
    enabled: z.boolean().default(false),
    cooldownMinutes: z.number().min(0).default(20),
    dailyCap: z.number().min(0).default(10),
    growthStepPct: z.number().min(1).default(5),
    quietFrom: z.number().min(0).max(23).default(23),
    quietTo: z.number().min(0).max(23).default(7),
  }).default({}),
})

// 必填标在**属性**上，不能写在根节点：dsh-tools@0.2.0-rc.2 的 value schema DSL
// 对根任务设 allowRequired:false，根级 `required` 会被 assertAuthorKeys 抛
// "schema.required is not supported by the value schema DSL"；而 defineTool 内部是 eager 编译的，
// 所以这个错会在 apply() 当场炸，不是等到首次调用。属性级的 `required: true` 会经
// property 任务装配成同一个根 `required` 数组——产物与直接写根 required 逐字节等价（Ruling 21）。
const OUTPUT = {
  type: 'object',
  properties: {
    kind: { type: 'string', required: true },
    exitCode: { type: 'number', required: true },
    gate: { type: 'string' },
    relayId: { type: 'string' },
    message: { type: 'string', required: true },
  },
  additionalProperties: false,
}

const INSTRUCTION = (docPath, relayId, mainline) =>
  `读交接档 ${docPath}，按第 5 段「下一步」逐条继续。\n你是接力会话；链标识 ${relayId}；主线 ${mainline}。\n开工前先读档全文，不要只看这一段。`

function isSubagentCaller(exec) {
  return exec?.parent !== undefined && exec?.parent !== null
}

async function runRelay(ctx, config, args, exec) {
  const home = dshHome()
  const sourceSessionId = exec?.agent?.id ?? exec?.agent?.session?.id ?? 'unknown'
  const auditRows = readAudit(home, 2, new Date())
  const dryRun = args.dryRun !== false

  // ⚠️ 前置闸门必须在**读档之前**跑：总开关关着时"零副作用"意味着不读档、不落审计，
  // 且返回的是"未启用"而不是误导性的"读不到交接档"（Ruling 34，端到端实测抓到）。
  const pre = preflightGates({ config, isSubagent: isSubagentCaller(exec) })
  if (!pre.ok) {
    return {
      kind: 'rejected', exitCode: pre.code, gate: pre.gate,
      message: `${pre.reason}。（关闭时零副作用：未读档、未留审计）`,
    }
  }

  let text
  try {
    text = readFileSync(args.docPath, 'utf8')
  } catch {
    // spec §5：每道闸都必须留审计行（带原因）。这里以前直接 return 不落审计，
    // 端到端实测才暴露——"读不到档"是闸门拒绝，不是无事发生。
    appendAudit(home, {
      ts: new Date().toISOString(), actor: 'agent', actionId: 'relay', dryRun,
      result: 'rejected', gate: 'doc', reason: 'doc-unreadable', sourceSessionId,
    })
    return { kind: 'rejected', exitCode: 5, gate: 'doc', message: `读不到交接档：${args.docPath}` }
  }

  const doc = validateDoc(text)
  const forbidden = checkForbidden(text, { quoteLines: config.forbiddenQuoteLines })
  const mainline = resolveMainline(doc.parsed, args.docPath) ?? args.mainline ?? ''
  const relayId = makeRelayId(sourceSessionId, new Date())

  const gate = evaluateGates({
    config,
    sourceSessionId,
    mainline,
    docOk: doc.ok,
    forbiddenOk: forbidden.ok,
    auditRows,
    permission: null, // 预览阶段还没有目标会话；真执行路径在 Task 8 补
    now: new Date(),
    isSubagent: isSubagentCaller(exec),
  })

  const base = { relayId, gate: gate.gate }

  if (!doc.ok) {
    appendAudit(home, { ts: new Date().toISOString(), actor: 'agent', actionId: 'relay', dryRun, result: 'rejected', gate: 'doc', mainline, sourceSessionId, relayId })
    return { ...base, kind: 'rejected', exitCode: 5, message: `交接档不合格：\n- ${doc.errors.join('\n- ')}` }
  }
  if (!forbidden.ok) {
    appendAudit(home, { ts: new Date().toISOString(), actor: 'agent', actionId: 'relay', dryRun, result: 'rejected', gate: 'forbidden', mainline, sourceSessionId, relayId })
    const list = forbidden.hits.map((h) => `第 ${h.line} 行：${h.kind}`).join('\n- ')
    return { ...base, kind: 'rejected', exitCode: 5, message: `交接档含禁写内容（不回显命中内容）：\n- ${list}` }
  }
  if (!gate.ok && gate.gate !== 'permission') {
    appendAudit(home, { ts: new Date().toISOString(), actor: 'agent', actionId: 'relay', dryRun, result: 'rejected', gate: gate.gate, mainline, sourceSessionId, relayId })
    return { ...base, kind: 'rejected', exitCode: gate.code, message: `闸门未通过（${gate.gate}）：${gate.reason}` }
  }

  // 真执行分支由 Task 8 补上（在那之前本工具只有预览能力）
  const preview = [
    '【预览】以下操作尚未执行（dryRun 缺省为 true，确认真执行请传 dryRun:false）',
    `- 主线：${mainline}`,
    `- 链标识：${relayId}`,
    `- 将新建会话（cwd 同源会话），标题：\u3010\u7eed\u3011${mainline}`,
    `- 将投递接手指令（mode: queue，约 ${INSTRUCTION(args.docPath, relayId, mainline).length} 字符）`,
    `- 将回写档头：链 / 已交接时间 / 接手会话`,
    `- 将追加 1 行审计到 ${home}\\steward\\audit\\`,
  ].join('\n')

  appendAudit(home, {
    ts: new Date().toISOString(),
    actor: 'agent',
    actionId: 'relay',
    dryRun: true,
    result: 'preview',
    mainline,
    sourceSessionId,
    relayId,
  })
  return { ...base, kind: 'preview', exitCode: 0, message: preview }
}

export function apply(ctx, config) {
  const tools = defineTool({
    name: 'steward_relay',
    description:
      '会话接力：把当前会话的活交给一个新会话。先自己写好交接档（七段契约，见设计稿），再用本工具派发。'
      + '缺省只预览（dryRun 缺省 true），确认真执行请传 dryRun:false。',
    parameters: {
      docPath: { type: 'string', required: true, description: '交接档的绝对路径' },
      mainline: { type: 'string', description: '主线名，缺省从档里或文件名推断' },
      dryRun: { type: 'boolean', description: '缺省 true：只预览不执行' },
    },
    output: {
      schema: OUTPUT,
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args, exec) {
      return runRelay(ctx, config ?? Config({}), args, exec)
    },
  })

  ctx.effect(() => ctx.tools.register(tools))
}
```

- [ ] **Step 5: 跑测试确认通过**

```powershell
& $node --test 2>&1 | Select-Object -Last 25
```
Expected: PASS。

`@deepseek-ai/schemastery` 与 `@deepseek-ai/dsh-tools` 已在 Task 2 Step 1 装进本仓库。**若这里仍报解析不到**，说明 Task 2 Step 1 的 install 走了退路——照 `docs/notes/dsh-api-notes.md` 里记的那条路补齐，不要改成 `dsh plugin --profile ... add`（那是宿主运行时的解析路径，解决不了 repo 内 `import`）。

- [ ] **Step 6: Commit**

```powershell
& $git -C '<repo>' add lib/index.js cordis.patch.yml test/index.test.js
& $git -C '<repo>' commit -m "feat: Config（出厂开关全关）+ steward_relay 工具 + dryRun 预览路径"
```

---

