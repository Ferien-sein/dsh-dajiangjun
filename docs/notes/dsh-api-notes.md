# DSH 宿主 API 实测笔记（Task 1 环境闸门产出）

- 日期：2026-10-06
- 环境：DeepSeek Harness **0.2.0-rc.2**（Electron 桌面版）
- 实测方式：隔离 profile `steward-dev` 内装一个一次性探针插件 `dsh-hello`（位于 `_scratch/hello/`，已 gitignore，不进版本库），boot 后从 stderr 抓 `[hello-probe]` 行。
- 用途：Task 7–9 写宿主插件时的**真源**。`inject` 数组只准抄本文件里实测到的键名，不许凭拼写猜。

---

## 1. 隔离 profile

- 名字：`steward-dev`
- 位置：`~/.dsh/profiles/steward-dev/`
- 创建命令：`dsh --profile steward-dev --from-default-profile web --no-open`
- 结论：**A3 已验证**——最小插件能装进隔离 profile 并拉起。`package.json` 里 `dsh.profile.bundles = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]`，探针插件经 `dsh plugin add` 后以 `link:` 依赖挂进配置树，boot 正常。

> 已知坑（实测踩过，记下供后续复用）：
> - 桌面宿主占着 19387，隔离 profile 的 `web` app 会自动换到 **3080**，无需手动传 `--port`。
> - `--no-open` 可正常接受（去掉它会弹出浏览器标签，仅此而已）。
> - boot 起服务后不退出，`Ctrl+C` 是预期终点；**判定靠「目录/插件行建出来了」，不是退出码**。

---

## 2. `inject` 数组的确切服务键名（真名，实测）

探针以 `inject = ['tools','sessionController','sessionTitle','sessionProjections','settings','llm']` 声明，boot 后 6 个键**全部解析为非 `undefined`**（`ctx[k] !== undefined` → `true`）。stderr 原文：

```
[hello-probe] {"dshHomeEnv":"C:\\Users\\<user>\\.dsh","cwd":"<repo>","inject":["tools","sessionController","sessionTitle","sessionProjections","settings","llm"],"resolved":[{"tools":true},{"sessionController":true},{"sessionTitle":true},{"sessionProjections":true},{"settings":true},{"llm":true}]}
```

| 键名（原样） | 提供方包 | 源码证据（`super(ctx, "...")`） | 用途（Task 7–9） |
|---|---|---|---|
| `tools` | `@deepseek-ai/dsh-tools` | `super(ctx, "tools")` | 注册工具：`ctx.tools.register(defineTool(...))` |
| `sessionController` | `@deepseek-ai/dsh-api-session-controller` | `super(ctx, "sessionController", { namespace: "session" })` | `create()` / `prompt()` |
| `sessionTitle` | `@deepseek-ai/dsh-session-title` | `super(ctx, "sessionTitle")` | `rename()` |
| `sessionProjections` | `@deepseek-ai/dsh-session-projection` | `super(ctx, "sessionProjections")` | 回读真实继承沙箱档位 |
| `settings` | `@deepseek-ai/dsh-settings` | `super(ctx, "settings")` | （v1 不用；0.2.0-rc.2 无 `register()`） |
| `llm` | `@deepseek-ai/dsh-llm` | `super(ctx, "llm")` | 取当前模型上下文上限 |

**三个易拼错的真名，务必照抄：**

1. `sessionController` —— 单数 `controller`，不是 `sessionControllers`。
2. `sessionTitle` —— 单数 `title`，不是 `sessionTitles`。
3. `sessionProjections` —— **复数** `Projections`，不是 `sessionProjection`（包名是单数 `dsh-session-projection`，服务名却是复数，这里最容易错）。

---

## 3. `defineTool` 实测形状

来源：asar 内 `dsh/node_modules/@deepseek-ai/dsh-tools/README.zh.md`（「注册工具」节）。注册一个工具即可见，注册表自动把 schema 送进系统提示词组装：

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'

ctx.tools.register(defineTool({
  name: 'read_file',
  description: 'Read a file from disk.',
  parameters: {
    path: { type: 'string', required: true, description: 'Absolute file path' },
    offset: { type: 'number' },
    limit: { type: 'number' },
  },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args, exec) {
    return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
  },
}))
```

要点：`parameters` 用统一 schema DSL（`string`/`number`/`integer`/`boolean`/`null`/`array`/`object`/`oneOf`）；`output.schema` 声明输出、`output.render` 渲染成 content block；`execute(args, exec)` 是执行主体，模型参数在执行前被校验。

---

## 4. `exec`（`ToolRunContext`）字段

来源：`dsh-tools/lib/index.js` 的 `createExecution()`（约 3131 行起），`execute` 收到的第二个参数实际是 `{ ...base, arguments }`：

```
{ token, callId, rootCallId, name, signal, agent?, parent?, schema?, arguments, deferContext(msg), concludeTurn() }
```

- `token` / `callId` / `rootCallId` / `name` / `signal`：执行身份与会话信号（`signal` 传给子进程 I/O，超时/取消会触发 abort）。
- `agent?` / `parent?` / `schema?`：可选，缺省时不出现在对象上（源码用展开条件字段拼装）。
- `arguments`：`deepFreeze(snapshotJsonValue(exec.arguments))`，即入参的深冻结快照。
- `deferContext(msg)`：把额外内容并入本轮上下文（工具结果之外再塞东西）。
- `concludeTurn()`：标记本轮结束（`concludingExecutions` 集合）。

> 子代理判定用 `exec.parent`：存在即视为子代理（对应 spec §8.3 的发起者白名单）。

---

## 5. 新增插件行是否需要重启宿主

**配置树立即生效，插件代码要下次 boot 才加载。**

- `dsh plugin --profile steward-dev add <path>` 之后**不重启**直接 `dsh --profile steward-dev --dump-config`，已能看到探针行：
  ```
  # == dsh-hello
  - id: hello
    name: dsh-hello
  ```
- 但插件 `apply` 只在**下一次 `dsh --profile steward-dev` boot**时才执行（`[hello-probe]` 那行是这次 boot 才打出来的）。

结论一句话：`dsh plugin add` 会立刻把依赖写进 profile 的 `package.json` 并反映到配置树，但对**已在跑的宿主进程**，新插件代码需要重启宿主（或走 `dsh-hmr` 热加载）才会执行。本项目隔离 profile 每次命令都是新 boot，天然覆盖这一点。

---

## 6. 关键坑：`inject: []` 时 `ctx.get()` 在 apply 里拿不到服务

探针最早用 `inject: []` + `apply` 里 `ctx.get(k)` 探测，**结果 `services: []`——6 个键全空**。不是键名错，是**加载顺序**：`inject: []` 意味着插件无依赖，loader 会在所有服务提供者之前启动它，此刻 `ctx.get(k)`（strict 模式要求提供方 fiber 已激活）返回 `undefined`。

同一探针改成 `inject: [...]` 声明后，6 个键全部解析成功（见 §2）。**推论（Task 7–9 必须遵守）**：插件要用的服务，一律写进 `inject` 数组；不要用 `inject: []` + `apply` 里 `ctx.get()` 去取服务——那会静默拿到 `undefined`。

---

## 7. A8：往系统提示追加一行（`system-prompt/assemble` waterfall）

- 服务真名 `systemPrompt`：`dsh-system-prompt/lib/index.js:213` `super(ctx, "systemPrompt")`。
- **`system-prompt/assemble` 确实是 waterfall**，且第三方插件能挂：`dsh-system-prompt/lib/index.js:355`
  `const transformed = await this.ctx.waterfall(scopeTarget(this, scope), "system-prompt/assemble", assembly, context, () => Promise.resolve(assembly))`。
- **监听签名是 `(assembly, context, next)`，不是 `(字符串, next)`**：waterfall 的末参是 `next` 延续，载荷是 `assembly = { sections, contexts, tools, variables }` 对象。要追加一行必须往 `assembly.sections` 里**推一个新 section**（`{ name, text }`），而不是把 `next()` 的结果当字符串拼 `\n`。`renderPrompt` 会按序 join 这些 section（`dsh-system-prompt/lib/index.js` 顶部 `renderPrompt`），空串会被过滤。
- **`ctx.systemPrompt.append()` 不存在**。`SystemPrompt` 类的方法只有 `section()`（`:240`）、`context()`（`:266`）、`suppressRuntimeContext()`（`:276`）、`tools()`、`variable()`、`assemble()`、`getSectionOrder()`、`getContextOrder()`——**没有 `append`**。若要走"注册式"追加，正确接口是 `ctx.systemPrompt.section({ name, order, text })`，且 `text` 可为函数（每次 assemble 现取）。
- 本项目选了 **waterfall**（`ctx.on('system-prompt/assemble', …)`），因为它是事件订阅、不要求 `systemPrompt` 服务在 apply 时已激活，也无需把该服务写进顶层 `inject`。全局（未标 scope）插件监听器被 `scopeTarget` 过滤器放行（`dsh-scope/lib/index.js` `scopeTarget`：`tag === undefined → return true`）。
- 已知边界：若某个 preset 注册了 `complete: true` 的 prompt section，`assemble()` 会用它替换全部 section，waterfall 里追加的 section 会被丢弃（`dsh-system-prompt/lib/index.js:355` 之后的 complete 分支）。这是宿主级覆盖场景，属可接受降级，Task 10 端到端确认。

## 8. 主动提醒的触发点与上下文上限（A9）

- **触发事件不是 `assistant/message` 这个 cordis 事件名**。`assistant/message` 是**持久化会话事件**，由 agent loop 用 `session.append("assistant/message", {…})` 落盘（`dsh-agent-loop/lib/index.js:1144-1150`），不是 `ctx.emit`。想订阅它必须挂 **`session/event`**：`dsh-session/lib/index.js:1466-1473` 在每个落盘事件上 `collectSessionCallbacks(entry.emitCtx, [entry.carrier, "session/event", session, event])`；carrier = `scopeTarget(session, scopeOf(this.ctx))`（`:1736`），全局插件监听器被放行。监听签名是 **`(session, event)`**，`event = { type, seq, time, data }`。
- `assistant/message` 的 `event.data = { turn, step, message, usage, stream }`（`dsh-agent-loop/lib/index.js:1144-1150`）；provider/model 在 **`event.data.message.source.provider` / `.model`**（`:1139-1140`），不在事件顶层。
- **`usage` 的字段名是 camelCase `inputTokens` / `outputTokens`**：`dsh-llm/lib/typert.host.js:529` 的 `TokenUsage` 接口 `{ inputTokens, outputTokens, totalTokens?, cacheReadTokens?, cacheWriteTokens?, reasoningTokens? }`；DeepSeek adapter 把 `input_tokens` 映成 `inputTokens`（`dsh-llm-deepseek/lib/index.js:1811`）。
- **上下文上限字段是嵌套的 `context.contextWindow`，且 `resolveModelInfo` 是 async**：`dsh-llm/lib/index.js:2098` `async resolveModelInfo(provider, model, signal)`，返回对象里 `context === void 0 ? {} : { context: { contextWindow: context.contextWindow } }`（`:2124`）。**不是顶层的 `.contextWindow`**。`resolveModelInfo` 对未注册 provider 会经 `this.registration(provider)` 抛错——必须 catch，取不到就**不提醒**（A9 回退，不许猜分母）。

## 9. A11：`ctx.inject(deps, cb)` 迟绑定可用

- cordis 的 `ctx.inject(deps, callback)` = `this.plugin({ inject: deps, apply: callback })`（`cordis/src/registry.ts` Plugin registry 的 `inject` 方法），语义是"依赖就绪后跑回调、缺依赖则静默不注册"。
- 真例（本机已发布插件）：`dsh-plugin-notify-sound/lib/index.js:22` 顶层 `export const inject = []`，`:47` `ctx.inject(['settings'], (sctx) => { sctx.settings.register(...) })`，注释明确"settings 就绪后再注册；完全没有 settings 的 profile 静默不注册"。
- 本项目照此：`llm` **不写进顶层 `inject`**，在 `apply` 里 `ctx.inject(['llm'], (sctx) => …)` 迟绑定（Ruling 8）。
