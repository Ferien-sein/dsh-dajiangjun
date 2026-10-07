import { readFileSync } from 'node:fs'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { checkForbidden, evaluateGates, makeRelayId, permissionOk, resolveMainline, validateDoc } from './relay.js'
import { acquireLock, appendAudit, dshHome, readAudit, readJson, releaseLock, updateJson, writeTextAtomic } from './store.js'

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

// dsh-tools 的 value schema DSL 不允许在根节点写 `required`，必填标在属性上
// （源码 `assertAuthorKeys` + `task.allowRequired`：根 false、属性 true）。
// 编译结果与 `required: ['kind','exitCode','message']` 等价，已实测。
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

  let text
  try {
    text = readFileSync(args.docPath, 'utf8')
  } catch {
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

  if (dryRun) {
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
  return dispatchRelay(ctx, config, { mainline, relayId, docPath: args.docPath, sourceSessionId, text })
}

/** 把接力元信息回写到档的「头部」段末尾（spec §3 步骤 ⑪）。先剔除旧键再插入 → 幂等。 */
function rewriteHeader(text, { relayId, sessionId, at }) {
  const KEY = /^\s*(链|已交接|接手会话)\s*[:：]/
  const lines = String(text).split(/\r?\n/).filter((l) => !KEY.test(l))
  const headIdx = lines.findIndex((l) => /^\s*#{1,6}\s+头部\s*$/.test(l))
  let insertAt = lines.length
  if (headIdx >= 0) {
    for (let i = headIdx + 1; i < lines.length; i++) {
      if (/^\s*#{1,6}\s+\S/.test(lines[i])) { insertAt = i; break }
    }
  }
  lines.splice(insertAt, 0, `链: ${relayId}`, `已交接: ${at}`, `接手会话: ${sessionId}`)
  return lines.join('\n')
}

export async function dispatchRelay(ctx, config, { mainline, relayId, docPath, sourceSessionId, text }) {
  const home = dshHome()
  const lockKey = `relay-${sourceSessionId}`
  const audit = (row) =>
    appendAudit(home, { ts: new Date().toISOString(), actor: 'agent', actionId: 'relay', dryRun: false, mainline, sourceSessionId, relayId, ...row })

  // 抢占的审计行由 acquireLock 自己写（doc 02 §5.6），调用点不需要补
  const got = acquireLock(home, lockKey, { ttlMs: config.lockTtlMs ?? 120000 })
  if (!got) {
    audit({ result: 'skipped', gate: 'single-flight' })
    return { kind: 'skipped', exitCode: 0, relayId, gate: 'single-flight', message: '已有同源会话的接力在进行，本次静默退出。' }
  }

  let newId
  try {
    // ⑦ 建会话（cwd 缺省与源会话同源；字段以 Task 1 笔记为准）
    const created = await ctx.sessionController.create({})
    newId = created.sessionId

    // ⑧ 权限回读断言（R-2：走序表）
    const srcAgent = await ctx.sessionController.resolveAgent(sourceSessionId)
    const dstAgent = await ctx.sessionController.resolveAgent(newId)
    const sourceMode = ctx.sessionProjections.stateOf(srcAgent.session, 'sandboxMode') ?? 'workspace-write'
    const targetMode = ctx.sessionProjections.stateOf(dstAgent.session, 'sandboxMode') ?? 'workspace-write'
    if (!permissionOk(sourceMode, targetMode)) {
      audit({ result: 'failed', gate: 'permission', newSessionId: newId })
      // 只报不收拾：归档不可逆（spec §1 N9）
      return { kind: 'partial', exitCode: 5, relayId, gate: 'permission', message: `权限降级（源 ${sourceMode} → 新 ${targetMode}），已建会话 ${newId} 但未投递。请人工处置该空会话。` }
    }

    // ⑨ 命名
    await ctx.sessionTitle.rename(newId, `\u3010\u7eed\u3011${mainline}`)

    // ⑩ 投递 —— R-1：只能 queue 或 steer，inject 不唤醒
    const mode = 'queue'
    if (mode !== 'queue' && mode !== 'steer') throw new Error('R-1 违反：投递模式只能是 queue 或 steer')
    await ctx.sessionController.prompt({
      requestId: `${relayId}-prompt`,
      sessionId: newId,
      mode,
      content: [{ type: 'text', text: INSTRUCTION(docPath, relayId, mainline) }],
    })

    // ⑪ 回写档头（原子重写原文，不是旁挂文件）
    writeTextAtomic(docPath, rewriteHeader(text, { relayId, sessionId: newId, at: new Date().toISOString() }))

    // ⑫ 审计
    audit({ result: 'dispatched', newSessionId: newId })
    return { kind: 'dispatched', exitCode: 0, relayId, message: `已派发。新会话 ${newId}，链标识 ${relayId}。` }
  } catch (error) {
    audit({ result: 'failed', newSessionId: newId, error: String(error?.message ?? error) })
    // 失败发生在 create() 之后就**必须点名那个会话**：它可能已经收到投递。
    // 不点名的后果是具体且危险的——去重闸只认 result === 'dispatched' 的行，
    // 所以人工在不知情下重试会**再投一次**，而那个已投递的会话没人能指认（Ruling 24）。
    const orphan = newId
      ? `已建会话 ${newId}（失败可能发生在其收到投递之后），请人工核查该会话再决定是否重试；`
      : ''
    return { kind: 'partial', exitCode: newId ? 3 : 1, relayId, message: `接力中断：${String(error?.message ?? error)}。${orphan}链标识 ${relayId}。` }
  } finally {
    releaseLock(home, lockKey)
  }
}

// ---- 主动提醒（spec §13）----

export function notifyLine(pct) {
  return `\u26a0 本会话上下文已用 ~${Math.round(pct * 100)}%，接近上限。准备交接：写完交接档后调用 steward_relay。`
}

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function inQuietHours(hour, from, to) {
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to
}

/** 只报状态变化 + 冷却 + 日上限 + 免打扰（spec §13.3）。 */
export function shouldNotify(state, { now, pct, config }) {
  if (config.enabled !== true) return false
  if (inQuietHours(now.getHours(), config.quietFrom, config.quietTo)) return false
  const today = dayKey(now)
  const todayCount = state.today === today ? (state.todayCount ?? 0) : 0
  if (todayCount >= config.dailyCap) return false
  if (!state.lastAt) return true
  const sinceMin = (now.getTime() - new Date(state.lastAt).getTime()) / 60000
  if (sinceMin < config.cooldownMinutes) return false
  return pct - (state.lastPct ?? 0) >= config.growthStepPct / 100
}

// 当前要追加进系统提示的那一行（'' = 无提醒）。section 每次 assemble 现取。
let reminderLine = ''
let reminderBound = false

/**
 * 追加提醒行的唯一实现（A8 实测：走 `system-prompt/assemble` waterfall，见
 * docs/notes/dsh-api-notes.md §7）。只在第一次真正要提醒时挂一次监听；此后每次
 * 系统提示组装把 reminderLine 作为末段 section 塞进去。reminderLine 为空串时
 * renderPrompt 会过滤空段 → 零 token。
 */
function appendReminder(ctx, line) {
  reminderLine = line
  if (reminderBound) return
  reminderBound = true
  ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
    const out = await next()
    if (!reminderLine) return out
    return { ...out, sections: [...out.sections, { name: 'dajiangjun:reminder', text: reminderLine }] }
  })
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

  // 主动提醒：llm 用迟绑定（Ruling 8），不写进顶层 inject —— 为一个可选读操作
  // 赌整个插件不激活不划算。dsh-plugin-notify-sound 就是 ctx.inject(['settings'], …) 这么写的。
  ctx.inject(['llm'], (sctx) => {
    // 触发点：session/event 是每个落盘会话事件的 cordis 事件（不是 assistant/message 这个
    // 持久化事件名）；assistant/message 只以 session 事件形态出现，见 notes §8。
    sctx.on('session/event', (_session, event) => {
      if (event?.type !== 'assistant/message') return
      if (config?.notify?.enabled !== true) return
      const usage = event.data?.usage
      const src = event.data?.message?.source
      if (!usage || !src?.provider || !src?.model) return
      // A9：resolveModelInfo 是 async，上下文上限在 context.contextWindow（不是顶层 contextWindow）。
      sctx.llm.resolveModelInfo(src.provider, src.model).then((info) => {
        const limit = info?.context?.contextWindow
        if (!limit) return // A9：取不到分母就不提醒，不许猜
        const pct = (usage.inputTokens ?? 0) / limit
        if (pct < (config?.softLimitRatio ?? 0.7)) return
        const stateFile = `${dshHome()}\\steward\\notify-state.json`
        const state = readJson(stateFile, {})
        const now = new Date()
        if (!shouldNotify(state, { now, pct, config: config.notify })) return
        updateJson(stateFile, () => ({
          lastPct: pct,
          lastAt: now.toISOString(),
          today: dayKey(now),
          todayCount: (state.today === dayKey(now) ? (state.todayCount ?? 0) : 0) + 1,
        }))
        appendAudit(dshHome(), { ts: now.toISOString(), actor: 'plugin', actionId: 'notify', dryRun: false, result: 'sent', pct })
        appendReminder(ctx, notifyLine(pct))
      }, (error) => {
        // 未注册 provider 或 adapter 查询失败 → 取不到分母 → 不提醒，但必须可观测。
        process.emitWarning(`steward: 取上下文上限失败（${src.provider}/${src.model}）：${String(error?.message ?? error)}`)
      })
    })
  })
}
