# Task 4 Report — `lib/relay.js` 交接档结构契约与主线名

## Status: DONE

## What I implemented

新建两个文件（**零改动已有文件**）：

- `lib/relay.js` — 纯函数模块，**无任何 import**（连 `node:` 内置模块都不需要），不碰 `ctx`，不依赖 `lib/store.js`。
  - `SECTIONS` —— 七段有序常量：`['头部','现状','已完成','在途','下一步','待拍板','速查']`
  - `parseDoc(text)` —— 逐行扫标题（`/^\s*#{1,6}\s+(\S.*?)\s*$/`），**段标题逐字匹配**（容忍前导 `#`/空白，不做模糊）。非契约标题退出当前段且不报错；缺失段报 `缺少段「X」`。
  - `validateDoc(text)` —— 在 parse 结果上做三条硬校验：`已完成` 每条 `-`/`*` 项必须含证据路径（`HAS_EVIDENCE`）；`下一步` 至少一条有序列表项（`1. `/`1、`/`1) ` 且非空）；`现状` 去空白后非空。段缺失时短路，只报缺失段。
  - `resolveMainline(parsed, docPath)` —— 取值序：段1（`头部`）的 `主线[:：]` → 档文件名去掉 `.md` 后按 `-` 取首段 → `null`（不猜）。
- `test/relay.test.js` — 5 个测试（1 正例 + 3 反例 + 1 主线名取值序）。

两个文件的内容与 brief 中给出的代码块**逐字一致**，已用程序比对证明（见下）。

## What I tested and results

| 命令 | 结果 |
|---|---|
| `& $node --test test/relay.test.js` | **5 tests / 5 pass / 0 fail** |
| `& $node --test`（全套） | **17 tests / 17 pass / 0 fail**（T2+T3 的 12 + 本任务 5） |

基线（写 relay 之前）实测 `& $node --test` → `tests 12 / pass 12`，所以 17 = 12 + 5，无回归。

### TDD Evidence

**Step 2 — RED**

命令：
```powershell
& $node --test test/relay.test.js 2>&1 | Select-Object -Last 20
```

输出（真实）：
```
node:internal/modules/esm/resolve:272
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<repo>\lib\relay.js' imported from <repo>\test\relay.test.js
    at finalizeResolution (node:internal/modules/esm/resolve:272:11)
    at moduleResolve (node:internal/modules/esm/resolve:879:10)
    ...
Node.js v24.21.0
✖ test\relay.test.js (108.164ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 116.1101

✖ failing tests:

test at test\relay.test.js:1:1
✖ test\relay.test.js (108.164ms)
  'test failed'
[exit code: 1]
```

为什么这个失败是预期的：测试文件先于实现创建，`import { parseDoc, resolveMainline, validateDoc } from '../lib/relay.js'` 指向尚不存在的模块，Node 在**加载期**就抛 `ERR_MODULE_NOT_FOUND`——这正是 brief Step 2 写明的预期（`Cannot find module '../lib/relay.js'`）。它证明"测试确实跑了并且确实红了"，而不是"测试没被加载"（那会是另一种症状：0 个测试被发现）。

**Step 4 — GREEN**

命令：
```powershell
& $node --test test/relay.test.js 2>&1 | Select-Object -Last 20
```

输出（真实）：
```
✔ 正例通过 (1.1528ms)
✔ 反例一：下一步段全是散文没有有序列表 → 拒 (0.2508ms)
✔ 反例二：已完成项无证据路径 → 拒 (1.0696ms)
✔ 反例三：段标题不是逐字匹配 → 拒 (0.2147ms)
✔ 主线名取值序：段1 → 文件名 → null (0.4226ms)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 128.5905
```

全套：
```powershell
& $node --test 2>&1 | Select-Object -Last 14
```
```
ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1023.4568
```

输出干净：无 stderr 噪声、无 Node 警告、无未处理拒绝、无 console 输出，退出码 0。

### 反例是否因"正确的原因"失败（自审实测）

brief 给的断言是 `r.errors.some(e => e.includes('下一步'))` 这类**宽松**匹配——一个只因其它原因变红的用例也能骗过它。所以我另跑了一次探针，直接打印每个反例的**完整 errors 数组**，确认每条错误都是针对性的、且是该文档**唯一**的错误：

```
正例:   ok=true    errors=[]                                                          段keys=[头部,现状,已完成,在途,下一步,待拍板,速查]
反例一: ok=false   errors=["段「下一步」缺少有序列表项（`1. ` 开头且非空）"]
反例二: ok=false   errors=["段「已完成」的条目缺证据路径：- 隔离 profile 跑通了"]
反例三: ok=false   errors=["缺少段「下一步」"]                                          段keys=[头部,现状,已完成,在途,待拍板,速查]
        反例三 下一步段内容=null
```

逐条确认失败原因正确：
- **反例一**：七段齐全，唯一错误是"下一步缺有序列表项"——散文被 `ORDERED` 正确拒绝，不是因为段缺失或别的原因。
- **反例二**：`已完成` 首条被摘掉 `（_scratch/hello/lib/index.js）` 后，唯一错误是"缺证据路径"，且报错文本回显了肇事行——第二行仍带 `docs/notes/dsh-api-notes.md`，未被误报。
- **反例三**：`# 下一步` → `## 下一步是什么` 后，`下一步` **不再出现在段 keys 里**（逐字匹配生效，`## 下一步是什么` 被当作非契约标题退出），因此报 `缺少段「下一步」`。这里要说明的是：该用例的断言用的是 `includes('下一步')`，而"缺少段「下一步」"确实包含该子串——**如果是"下一步缺有序列表"报的错，也会包含**，所以断言本身无法区分二者；真正区分它们的是上面的 errors 探针：该文档里 `下一步` 段内容为 `null`，错误只有"缺少段"一条，无序列表检查根本没被触达（段缺失时 `validateDoc` 短路）。故失败原因正确。

### 边界行为（额外探针确认，非 brief 要求）

```
whatever.md                          -> "whatever"
C:/x/会话接力-xxxxxxxx-1200.md        -> "会话接力"
C:/x/没有时间戳.md                    -> "没有时间戳"
C:/x/.md                             -> null
C:/x/会话接力-xxxxxxxx-1200.MD        -> "会话接力"   （.md 大小写不敏感）
C:/x/a-b-c-d.md                      -> "a"
header-present                       -> "大管家"
主线：大管家（全角冒号）               -> "大管家"
parsed=undefined                     -> "名"          （可选链兜底，不抛）
空文本                                -> ["缺少段「头部」",... x7]   （七段全缺，短路）
```

## 确认没有改动任何已有文件

三道证据：

1. `git status --porcelain`（提交前）输出恰好两行，且都是未跟踪新文件：
   ```
   ?? lib/relay.js
   ?? test/relay.test.js
   ```
2. `git diff --stat` 与 `git diff --cached --stat` **均为空输出** —— 没有任何已跟踪文件被修改。
3. `git commit` 输出：`2 files changed, 134 insertions(+)`，两条都是 `create mode 100644`（纯新增，无删除/重命名）。

另外用程序把写入的文件与 brief 的代码块逐字比对（brief 实现块 = 第 100–165 行，测试块 = 第 20–87 行）：

```
impl identical: True
test identical: True
```

行尾为纯 LF（`lib/relay.js` 66 个 LF / 0 个 CRLF，`test/relay.test.js` 68 个 LF / 0 个 CRLF），末尾带换行，与仓库既有文件一致。

## Files changed

- **Create** `lib/relay.js`（66 行，0 import）
- **Create** `test/relay.test.js`（68 行，仅 `node:test` / `node:assert/strict`）

Commit：`d7f420e feat(relay): 交接档七段结构契约 + 主线名取值序`（分支 `feat/session-relay`）
`package.json` / `lib/store.js` / `test/store.test.js` 未动；未新增任何依赖。

## Self-review findings

- **无死代码、无未使用 import**：`lib/relay.js` 零 import；`sectionText` 被 `validateDoc` 与 `resolveMainline` 各用一次，非死代码；无 `ponytail:` 标记（brief 未要求，且未留已知天花板式简化）。
- **错误消息面向 agent、可执行**：`段「已完成」的条目缺证据路径：- 隔离 profile 跑通了` 直接回显肇事整行（`line.trim()`），agent 无需自行定位；`缺少段「下一步」` 与 `段「下一步」缺少有序列表项（`1. ` 开头且非空）` 明确区分"没这段"和"这段格式不对"；后者还在消息里给出了可接受的写法字面量。
- **YAGNI**：严格只实现 brief 的四个导出 + 三个模块内正则常量，未加任何未被要求的抽象、配置项或校验。
- **未改 brief 的既定行为**：发现两处边角限制，但按"逐字转写、不自行设计"的要求**保持原样未改**，只在此记录（见下）。

## Issues or concerns

两条**低风险、未修**的观察（均为 brief 规定行为的直接后果，改动会偏离"逐字转写"）：

1. `HAS_EVIDENCE = /[/\\][^\s，。）)]+/` 只排除半角 `)`，**不排除全角 `）`**；且全角斜杠 `／`（U+FF0F）不在排除集内，会被当作路径分隔符。因此 `- 完成了（重构）` 之外，形如 `- 重构／整理完毕` 这类无反证的行有可能被误判为**含**证据而放过。影响：`已完成` 的证据要求存在罕见的漏检面。修法（若后续要收）是把 `）` 与 `／` 加入排除集，并把 `[/\\]` 收紧为"斜杠后须跟非空白且含 `.` 或已知扩展名"。
2. `resolveMainline` 的文件名回退是 `stem.split('-')[0]`，对 `a-b-c-d.md` 得 `"a"`。这是 brief 明示的取值序（取**首段**），非缺陷；仅记录：主线名本身不含 `-` 时才符合业务预期，命名约定需由上层保证。

两条都不影响本任务验收（5/5、17/17 全绿），也不需要在本任务内处理——Task 5/6 若关心路径证据强度，可在同一文件追加时一并收严。
