# Task 7 报告：`lib/index.js` — Config、工具注册、dryRun 预览路径

- 日期：2026-10-06
- 分支：`feat/session-relay`
- 提交：`0eaf5da` feat: Config（出厂开关全关）+ steward_relay 工具 + dryRun 预览路径
- 状态：**DONE_WITH_CONCERNS**（唯一 concern 见 §6：brief 里 `output.schema` 的写法在已装 `dsh-tools@0.2.0-rc.2` 上不可运行，已按库源码改成等价写法）

---

## 1. 实现了什么

新增三个文件（无其它改动）：

| 文件 | 内容 |
|---|---|
| `cordis.patch.yml` | brief Step 1 原文逐字：`insert: [{ id: dajiangjun, name: dsh-dajiangjun }]` |
| `test/index.test.js` | brief Step 2 的 6 条测试逐字 |
| `lib/index.js` | `name` / `inject` / `Config` / `apply` + 内部 `runRelay`，brief Step 4 原文（唯一改动见 §6） |

`lib/index.js` 的对外形状：

- `name = 'dajiangjun'`
- `inject = ['tools', 'sessionController', 'sessionTitle', 'sessionProjections']`
- `Config`（schemastery）：`enabled` 默认 `false`，`notify.enabled` 默认 `false`；其余阈值默认 `softLimitRatio 0.7` / `rateLimitMinutes 20` / `failureLimit 2` / `lockTtlMs 120000` / `forbiddenQuoteLines 5`，全部带 `min`/`max` 范围
- `apply(ctx, config)`：`defineTool({ name: 'steward_relay', ... })` 后 `ctx.effect(() => ctx.tools.register(tools))`
- `runRelay(ctx, config, args, exec)`：读档 → `validateDoc` → `checkForbidden` → `resolveMainline` → `makeRelayId` → `evaluateGates` → 预览或拒

**只做预览路径**：真执行（建会话 / 权限断言 / 改名 / 投递）未实现，代码里只有一句注释 `// 真执行分支由 Task 8 补上（在那之前本工具只有预览能力）`。没有 TODO 占位、没有 `deps` 脚手架、没有 Task 8 的任何代码。

## 2. 测试与结果

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node --test test/index.test.js   # 单文件
& $node --test                      # 全套
```

**单文件：6/6 通过，exit 0**

```
✔ 出厂开关一律为关 (1.3994ms)
✔ 阈值有合理默认且带范围 (0.195ms)
✔ 软限比例越界被拒 (0.3313ms)
✔ dryRun 缺省为 true：零真副作用 (11.7316ms)
✔ 总开关关闭时拒且零写操作 (5.2403ms)
✔ 新 home 的审计流水为空 (1.9271ms)
ℹ tests 6
ℹ pass 6
ℹ fail 0
ℹ duration_ms 226.2108
```

**全套：41/41 通过，exit 0**（store 12 + relay 23 + index 6）

```
ℹ tests 41
ℹ pass 41
ℹ fail 0
ℹ duration_ms 1004.7169
```

**输出干净性**：跑 `& $node --test 2>&1 | Where-Object { $_ -notmatch '^[\s]*[✔ℹ]' -and $_.Trim() -ne '' }` → **空**（无 warning、无杂散 stdout/stderr、无半截行）。

## 3. TDD 证据

### RED（实现前）

命令：

```powershell
& $node --test test/index.test.js 2>&1 | Select-Object -Last 20
```

真实输出（尾段）：

```
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///<repo>/lib/index.js'
}

Node.js v24.21.0
✖ test\index.test.js (104.3447ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 112.1316

✖ failing tests:

test at test\index.test.js:1:1
✖ test\index.test.js (104.3447ms)
  'test failed'
[exit code: 1]
```

为什么预期：`test/index.test.js` 第 6 行 `import { Config, apply } from '../lib/index.js'`，此刻 `lib/index.js` 尚不存在，模块解析阶段就抛 `ERR_MODULE_NOT_FOUND`，整个测试文件加载失败（这正是 brief Step 3 预期的失败形态）。

### GREEN（实现后）

见 §2 的两段输出：单文件 6/6、全套 41/41，均 exit 0。

### 中间态（诚实记录）

第一次用 brief 原文实现后跑测试，**不是** GREEN，而是第三条测试（`dryRun 缺省为 true`，及所有走 `apply` 的测试）抛：

```
Error [JsonSchemaError]: unsupported JSON schema: schema.required is not supported by the value schema DSL
  code: 'UNSUPPORTED_SCHEMA',
  violations: [ 'schema.required is not supported by the value schema DSL' ]
    at defineTool (.../@deepseek-ai/dsh-tools/lib/index.js:849:23)
    at apply (file:///<repo>/lib/index.js:120:17)
```

根因与处置见 §6。修好后才是 §2 的 GREEN。

## 4. `inject` 键名与出处

用的是 `['tools', 'sessionController', 'sessionTitle', 'sessionProjections']`，逐个出自 **`docs/notes/dsh-api-notes.md` §2「`inject` 数组的确切服务键名（真名，实测）」** 的表格，以及同节的「三个易拼错的真名」小节：

- `tools` ← §2 表格第 1 行（提供方 `@deepseek-ai/dsh-tools`）
- `sessionController` ← §2 表格第 2 行，§2 提醒 1 明确"单数 `controller`，不是 `sessionControllers`"
- `sessionTitle` ← §2 表格第 3 行，§2 提醒 2 "单数 `title`"
- `sessionProjections` ← §2 表格第 4 行，§2 提醒 3 "**复数** `Projections`，不是 `sessionProjection`"

没有用 `settings` / `llm`（§2 表格已注明 v1 不用），也没有改动拼写。遵守 §6 的坑：**依赖的服务全部写进 `inject`**，`apply` 里不用 `ctx.get(k)` 取服务（源码里 `ctx.get` 一次都没出现）。

## 5. 零副作用验证（spec G2）

测试内断言（`ctx.calls` 无 `create`/`prompt`/`rename`）之外，另跑了一个一次性探针 `_scratch/t7-probe.mjs`（`_scratch/` 已被 `.gitignore` 覆盖，不入库）做独立复核，覆盖 `dryRun` 三种取值：

```
name = dajiangjun
inject = ["tools","sessionController","sessionTitle","sessionProjections"]
--- dryRun=undefined -> kind=preview exit=0 gate=permission
    service calls: []
--- dryRun=false -> kind=preview exit=0 gate=permission
    service calls: []
--- dryRun=true -> kind=preview exit=0 gate=permission
    service calls: []
locks dir exists: false
steward tree: ["audit"]
audit rows: 3 all dryRun===true: true
results: ["preview","preview","preview"]
chain ok: true
```

结论：

1. **三种 `dryRun` 取值下服务调用数都是 0**——包括 `dryRun:false`：本任务没有真执行分支，`dryRun:false` 也只落到预览（brief 原文如此），因此不存在"预览被当成真执行"的窗口。
2. **不占锁**：`lib/index.js` 根本没 import `acquireLock`/`lockPath`/`releaseLock`（只 `import { appendAudit, dshHome, readAudit } from './store.js'`），探针实测 `steward/locks/` 目录不存在，`steward/` 下只有 `audit`。
3. **审计行一律 `dryRun:true`**（3 行全部），而 `relay.js` 的 `real()` 过滤 `r.dryRun !== true`，所以这些行**不进**去重/速率/失败三道闸的计数——**agent 反复预览不会被失败闸锁死**（brief 点名的那个具体后果不会发生）。
4. 审计哈希链自洽（`verifyChain(rows).ok === true`）。
5. 探针与测试都只写 `DSH_HOME` 指向的临时目录，**未触碰 `~/.dsh/profiles/desktop/`**。

## 6. Concern（唯一一处偏离 brief 原文）

**brief Step 4 的 `OUTPUT` 常量在已装依赖上直接抛错，无法逐字使用。**

brief 原文的 `output.schema` 用原始 JSON Schema 风格写根节点 `required`：

```js
required: ['kind', 'exitCode', 'message'],
additionalProperties: false,
```

但 `@deepseek-ai/dsh-tools@0.2.0-rc.2` 的 `valueSchemaSpecToJsonSchema` 会先 `compileValueSchema(spec, 'schema')`，其根任务 `allowRequired: false`（源码 `node_modules/.pnpm/@deepseek-ai+dsh-tools@.../lib/index.js:771-785`），而 `assertAuthorKeys` 会把根上出现的 `required` 判为 `schema.required is not supported by the value schema DSL`（同文件 `:655` 构造白名单、`:555-557` 抛错）。因为 `defineTool` **在注册时就 eager 编译 schema**（`:849`），`apply()` 一被调用就抛，六条测试里有四条直接失败。

**处置（最小化、保留 brief 的全部取值）**：翻源码确认该 DSL 的必填是标在**属性**上而不是根上（`:601-604`，`allowRequired: true` 只给属性节点），于是把必填从根 `required` 数组改写成每个属性的 `required: true`：

```js
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
```

并实测确认**编译产物与 brief 的原意完全等价**（探针直接打印 `defineTool(...)` 后的 schema）：

```json
{"type":"object","additionalProperties":false,
 "properties":{"kind":{"type":"string"},"exitCode":{"type":"number"},
 "gate":{"type":"string"},"relayId":{"type":"string"},"message":{"type":"string"}},
 "required":["kind","exitCode","message"]}
```

即：属性名、类型、`additionalProperties: false`、以及 `required: ['kind','exitCode','message']` 全部与 brief 一致，只是换成了该 DSL 支持的书写位置。代码里留了 3 行注释说明原因与出处。

**为什么没停下来问**：这不是"形状不明"或需要取舍的决策——结论由已装库源码唯一确定，且改写后 brief 声明的每一个值都原样保留，没有替代方案能更忠实。若控制器认为应当保留根 `required` 字面量，那唯一出路是升级/替换 `dsh-tools`，不属于本任务范围。

## 7. 越界检查（未改动范围外文件）

自审命令与结果：

```powershell
& $git -C '<repo>' status --porcelain
# 提交前：?? cordis.patch.yml / ?? lib/index.js / ?? test/index.test.js
# 提交后：(空)
& $git -C '<repo>' diff --stat
# (空) —— 没有任何已跟踪文件被修改
& $git -C '<repo>' show --stat --oneline HEAD
# 0eaf5da  3 files changed, 269 insertions(+)
#  cordis.patch.yml / lib/index.js / test/index.test.js
```

- `lib/store.js`、`lib/relay.js`、`test/store.test.js`、`test/relay.test.js`、`package.json` **全部未被修改**（`git diff --stat` 为空，提交只含 3 个 `create mode` 新文件）。
- 未 import `dedupeKey`（deferred 死导出）→ `grep dedupeKey lib/index.js` 无命中。
- 未给 `test/relay.test.js` 补"失败闸忽略 dryRun"的测试（deferred，不在文件范围）。
- 未碰 `~/.dsh/profiles/desktop/`：本任务所有读写都经 `dshHome()`，测试/探针把 `DSH_HOME` 指向 `mkdtempSync(tmpdir(), 'dj-home-')`。
- 临时探针只在 `_scratch/`（gitignored）；根目录试写的两个 `_scratch-probe*.mjs` 已删除（`git status` 干净可证）。
- 测试命令始终用 `& $node --test test/index.test.js` 或 `& $node --test`，**没有**用目录形式 `node --test test/`。

## 8. 自查发现

- 死代码：无。逐项核对 import 全部有消费者（`readFileSync`/`z`/`defineTool`/五个 relay 导出/三个 store 导出）；`INSTRUCTION` 与 `isSubagentCaller` 都有调用点；`OUTPUT`、`name`、`inject` 是对外契约。
- `Config` 里的 `softLimitRatio`、`lockTtlMs` 在预览路径未被读取——这是 spec 的配置面契约（Task 8 的软限与锁 TTL 要用），不是死代码；brief 原文包含它们。
- `runRelay` 的 `ctx` 形参在预览路径未被使用——brief 原文如此，是 Task 8 真执行分支的挂载点，保留（改成不含 `ctx` 反而会让 Task 8 改动面变大）。
- 重跑确认：`& $node --test` 全套 41/41、exit 0，输出无 warning。

## 9. 文件清单

| 文件 | 状态 |
|---|---|
| `cordis.patch.yml` | 新增（5 行） |
| `lib/index.js` | 新增（142 行） |
| `test/index.test.js` | 新增（122 行） |
| `_scratch/t7-probe.mjs` | 一次性验证探针，gitignored，不入库（可删） |

## 10. 遗留 / 交接给 Task 8

- 真执行分支：`lib/index.js` 的 `runRelay` 里注释所在位置（"真执行分支由 Task 8 补上"），需补建会话、权限断言（`evaluateGates` 目前传 `permission: null`，因此预览时 `gate.gate` 恒为 `'permission'`、被 `gate.gate !== 'permission'` 放行）、改名、投递、档头回写，并把预览分支的成功审计行 `dryRun: true` 改为真实 `dryRun` 值。
- `config.lockTtlMs` 与 `config.softLimitRatio` 由 Task 8 消费。
