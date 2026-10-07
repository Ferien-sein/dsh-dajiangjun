import { readFileSync } from 'node:fs'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { checkForbidden, evaluateGates, makeRelayId, resolveMainline, validateDoc } from './relay.js'
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
