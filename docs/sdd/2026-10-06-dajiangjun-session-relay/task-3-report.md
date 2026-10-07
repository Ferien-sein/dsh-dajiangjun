# Task 3 报告：`lib/store.js` — 原子写、单例锁、并发安全

状态：**DONE**（无阻塞）

分支：`feat/session-relay`　提交：`16c972e`

---

## 1. 实现了什么

在 `lib/store.js` **文件末尾追加**（Task 2 的 12 个函数一行未动）：

| 导出 | 作用 |
| --- | --- |
| `writeTextAtomic(file, text)` | 同目录临时文件 `${file}.tmp-${pid}-${Date.now()}` → `renameSync`；Windows 上 `EPERM`/`EBUSY`/`EACCES` 按 `RENAME_RETRY_MS = [50, 150, 400]` 重试；最终失败时删临时文件并抛出原错误 |
| `writeJsonAtomic(file, value)` | **委托** `writeTextAtomic`（`JSON.stringify(value, null, 2)`），不复制重试逻辑 |
| `readJson(file, fallback)` | 文件不存在或 JSON 解析失败都返回 `fallback`（半截文件不抛） |
| `updateJson(file, fn)` | 读-改-写唯一入口：`fn(readJson(file, undefined))` → `writeJsonAtomic`，返回新值 |
| `lockPath(home, key)` | `<home>/steward/locks/<key>.lock` |
| `acquireLock(file, { ttlMs, now })` | `writeFileSync(..., { flag: 'wx' })` 原子创建；`EEXIST` 时读锁文件，`startedAt` 过期才抢占并返回 `{ ok: true, stole: true }`，否则 `null` |
| `releaseLock(file)` | `rmSync(file, { force: true })`，吞掉异常 |

`lib/store.js` 顶部 `node:fs` 导入补了 `renameSync`、`rmSync`、`writeFileSync`（其余导入未动）。

`test/store.test.js`：补 5 条测试（并发自增、原子写+无临时文件残留、抢不到锁、过期抢占、release 后可再抢）、补 `readdirSync` 导入、把 `readJson` 等新导出并入**同一条** `../lib/store.js` 导入（没有产生重复的 import 语句）。

依赖：只用 `node:` 内置模块 + `Atomics`/`SharedArrayBuffer` 全局对象，`package.json` 未改，零新增运行时依赖。

---

## 2. 测试与结果

命令（全程用全套模式，**未**用目录形式 `node --test test/`）：

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node --test 2>&1 | Select-Object -Last 25
```

结果：**11 tests / 11 pass / 0 fail / 0 cancelled / 0 skipped**，输出干净（无 warning、无 unhandled rejection、无残留文件报错）。提交 `16c972e` 在其上复跑一次，同样 11/11 全绿。

---

## 3. TDD 证据

### RED（实现之前，Step 2）

命令：`& $node --test 2>&1 | Select-Object -Last 25`

```
file:///<repo>/test/store.test.js:7
  acquireLock,
  ^^^^^^^^^^^
SyntaxError: The requested module '../lib/store.js' does not provide an export named 'acquireLock'
    at #asyncInstantiate (node:internal/modules/esm/module_job:455:21)
    at async ModuleJob.run (node:internal/modules/esm/module_job:553:5)
    at async node:internal/modules/esm/loader:647:26

Node.js v24.21.0
✖ test\store.test.js (124.2604ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 647.9989

✖ failing tests:

test at test\store.test.js:1:1
✖ test\store.test.js (124.2604ms)
  'test failed'
[exit code: 1]
```

为什么这个失败是"预期中的"：新测试 import 了 `acquireLock` / `lockPath` / `readJson` / `releaseLock` / `updateJson` / `writeJsonAtomic`，而此时 `lib/store.js` 一个都没导出。Node 的 ESM 在链接期就做具名导出校验，所以整份测试文件在**加载阶段**就挂了——不是断言失败，而是"模块解析失败"。这正是 RED 该有的形态：失败原因完全归因于"功能尚未实现"，而不是测试自身写错、环境污染或命令用错。

注意 RED 阶段 `tests 1 / fail 1` 是文件级失败（测试文件未能实例化），6 条旧测试也随之无法运行；实现后恢复为 11 条。

### GREEN（实现之后，Step 4）

命令：同上。

```
✔ appendAudit 串起哈希链 (9.8367ms)
✔ verifyChain 检出被篡改的行 (5.3422ms)
✔ readAudit 只读当月与上月 (19.0244ms)
✔ 半截 JSON 行不让整条链炸掉 (5.0998ms)
✔ 链跨月连续：跨月读取后 verifyChain 不误报 (8.8232ms)
✔ 窗口验证：readAudit 默认只读两个月，必须用 seed 补上窗口前那条的 hash (7.7072ms)
✔ updateJson 并发 100 次自增不丢更新 (236.2293ms)
✔ writeJsonAtomic 留下完整 JSON，不留临时文件 (3.5982ms)
✔ 锁：抢不到返回 null (4.2112ms)
✔ 锁：过期可抢占并记 stole (7.3012ms)
✔ 锁：release 后可再抢 (4.7458ms)
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1026.5625
```

提交后在 `16c972e` 上复跑的尾部输出（同一结论，证据与提交版本绑定）：

```
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1012.4786
```

---

## 4. 确认未改动 Task 2 的函数

> **本节已于修复轮订正。** 初版这里写"diff 里没有任何 `-` 删除行"，与本节下方早先引用的 `3 deletions(-)` 自相矛盾，且该断言本身是**错的**。`16c972e` 的真实删除行数是 3，全部是**导入行**。以下是按可复现命令逐条核对后的说法。

检查方法一——改动只有两处：(a) 第 2 行 `node:fs` 导入**扩展**（原有 4 个具名导入全部保留，追加 3 个），(b) 在文件末尾（`verifyChain` 闭合花括号之后）追加 72 行。`git show --numstat 16c972e` 给出 `73 1 lib/store.js` 与 `55 2 test/store.test.js`——即 lib/store.js 1 条删除、test/store.test.js 2 条删除，合计 3 条，与 `2 files changed, 128 insertions(+), 3 deletions(-)` 相符。这 3 条删除行由 `git show -U0 --format= 16c972e | Select-String '^-[^-]'` 完整列出（行尾 `#` 注释是我标注的所在位置，非命令输出），无一例外都是被就地替换的 import 语句：

```
-import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'      # lib/store.js:2
-import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'                 # test/store.test.js:3
-import { appendAudit, auditFile, hashEntry, readAudit, verifyChain } from '../lib/store.js'  # test/store.test.js:6
```

**没有任何一条删除行落在任何函数体内**——这正是"Task 2 函数未被改动"的实质依据（导入行扩展不改变函数语义）。

检查方法二——`git show -U10 --format= 16c972e -- lib/store.js | Select-String '^@@'` 得到 hunk 头 `@@ -95,10 +95,82 @@`（旧文件从第 95 行起取 10 行上下文，到末行 104 为止），另一条是 `@@ -1,12 +1,12 @@`（导入行）。也就是说：**第 3..94 行完全落在任何 hunk 之外**，逐字节未变；`@@ -95,10 @@` 那一段的 10 旧行也全是上下文行（`+` 只在第 104 行之后）。hunk 头的数字随上下文宽度变化，用 `-U2` 时同一处显示为 `@@ -103,2 +103,74 @@`，用 `-U3`（git 默认）时显示为 `@@ -102,3 +102,75 @@`；三种宽度都指向同一改动区域。`dshHome` / `auditDir` / `auditFile` / `ymOf` / `canonical` / `hashEntry` / `lastHashIn` / `lastHash` / `appendAudit` / `readAudit` / `verifyChain` 全部原样。

检查方法三——6 条 Task 2 测试在 RED（文件级挂掉）之后于 GREEN 全部重新通过，且未做任何修改。

---

## 5. 变更文件

```
lib/store.js       | 74 +++++++++++++++++++++++++++++++++++++++++++++++++++++-
test/store.test.js | 57 +++++++++++++++++++++++++++++++++++++++++++++++--
2 files changed, 128 insertions(+), 3 deletions(-)
```

提交：`16c972e feat(store): 原子写（Windows rename 重试）+ flag:wx 单例锁 + updateJson`（工作区干净）。

---

## 6. 自审发现

- **重试逻辑只有一份**：`renameSync` 的 try/catch/退避循环只存在于 `writeTextAtomic`；`writeJsonAtomic` 是纯委托（3 行）。grep `RENAME_RETRY_MS|sleepSync|renameSync` 全文仅 6 处命中：`renameSync` 1 处（导入）+ 1 处（唯一的调用点，在 `writeTextAtomic` 的循环里）、`RENAME_RETRY_MS` 1 处定义 + 2 处引用（`.length` 与下标）、`sleepSync` 1 处定义 + 1 处调用。没有第二份重试循环。
- **无死导入**：新增的 `renameSync` / `rmSync` / `writeFileSync` 均在追加代码中被使用；测试侧新增的 `readdirSync` / `readJson` 亦被使用。**未**新增任何未使用的导入。
- **无 YAGNI 越界**：只落 brief 列的 7 个导出，没有顺手加 `withLock()`、重试次数配置项之类计划外的东西。
- **导入写法的一处主动收敛**：brief 的测试片段自带一行 `import { acquireLock, lockPath, releaseLock, updateJson, writeJsonAtomic } from '../lib/store.js'`，随后又要求"补 `readJson` 的导入"。若照抄会得到**两条指向同一模块**的 import 语句。我把它们并成了文件顶部**一条**排序好的导入（含 `readJson`），语义完全等价、更少重复代码。这是本任务相对 brief 的唯一偏离，特此显式说明以便审查。
- **测试有效性核查（此处初版有一条事实错误，已订正）**：初版我写"`updateJson` 的 100 次并发自增测的是真实行为（若 `updateJson` 改成非原子或读-改-写被拆开，计数就会 < 100）"——**这是错的**，审查者已指出：`Promise.all` 里跑的全是同步的 `updateJson`，Node 单线程逐个执行完 `.then`，零交错；即便把 `updateJson` 退化成"非原子读 + 直接 `writeFileSync`"，计数照样是 100。该测试当时**根本没有测并发**，我却用一条不成立的论证给它背书，对"并发安全"给出了虚假信心。修复轮已把测试改名为「连续 100 次读-改-写不丢更新（进程内串行）」、去掉 `Promise.all` 假并发、并在注释里写明本任务不承诺跨进程原子性。订正后其余判断仍然成立：`writeJsonAtomic` 那条同时断言文件内容完整性**和**目录中无 `.tmp-` 残留（若失败路径漏删临时文件就会红）；四条锁测试分别覆盖未过期拒绝、过期抢占并留审计行（校验 `actionId` / `result` / `reason`）、损坏锁可抢占（`reason === 'unreadable'`，这条是防"锁永久卡死"的活性回归）、释放后可重入。
- **输出洁净度**：全套输出无 `ExperimentalWarning`、无 `MaxListeners`、无未处理 rejection、无 `DEP0` 弃用告警。

---

## 7. 顾虑 / 已知边界（均为 brief 既定设计，非本次偏离）

1. **`acquireLock` 的抢占路径存在窄窗竞态**：两个进程同时读到同一个过期锁时会**都**判定为过期，各自 `writeJsonAtomic` 写入自己的持有者记录（原子写保证文件不会损坏，但后写者覆盖先写者），于是两边都可能返回 `{ ok: true, stole: true }` 并同时进入临界区。首次获取走 `flag: 'wx'` 是严格原子的，只有"过期抢占"这一条路径没有 CAS。spec R-4 只要求"禁止 existsSync-then-write"，brief 的实现满足该要求；若后续要求抢占也严格互斥，需要引入 rename 抢占或基于锁文件内容比对的重读校验——**这属于 spec 层面的决定，我按 brief 原样落地并在此标注**。（修复轮补充：审查者已裁定此竞态落在上游设计接受的 ceiling 内——"最多重复执行一次、去重表兜底"，**不算 finding**，保持现状。）
2. **临时文件名用 `${pid}-${Date.now()}` 去重**：同一进程同一毫秒内两次写会算出同名临时文件。因为 `writeTextAtomic` 全程同步、不存在交错，实际无害；跨进程靠 pid 区分。仅作为边界记录，未改。
3. brief Step 4 的 Expected 写的是"9 个测试全绿"，任务书正文期望的是 11 个。以 11 为准（6 旧 + 5 新增），已达成；brief 该处数字应为笔误，未改动 brief。（修复轮补充：controller 已把 brief 更新为 222 行版，其中 Step 4 的期望值已改为 12 个——即 6 旧 + 本任务 6 条，与本轮实际结果一致。）

无阻塞项，无需决策即可继续。

---
---

# 修复报告（审查后返工轮）

本轮针对 Task 3 审查的 **2 个 Important + 1 个 Minor** 返工，另订正初版报告中的 2 处不准确断言。基准提交：`16c972e`。改动依据是 controller 更新后的 brief（222 行版，Step 1 的测试块与 Step 3 的锁实现已改）。

## A. 改了什么

### A1（Important #1）过期抢占现在必须留审计行，且签名收 `home` + `key`

`doc 02 §5.6` 要求「锁过期 → 视为持有者已死，抢占并记一行审计」。初版只在瞬态锁文件里塞了 `stoleFrom`，`releaseLock` 一删就没了，不等于 append-only 审计链。审查者还指出接口矛盾：`acquireLock(file, …)` 收不到 `home`，而 `appendAudit` 需要 `home`，这条审计在旧签名下根本实现不了。

按 controller 裁定改签名（**不**走"下沉给 Task 8、由调用点补审计"那条路）：

- `acquireLock(home, key, opts = {})` —— 内部 `const file = lockPath(home, key)`，抢占成功时自己调 `appendAudit(home, { ts: new Date(now).toISOString(), actor: 'plugin', actionId: 'lock-steal', dryRun: false, result: 'stolen', lock: key, reason, stoleFrom: held })`。
- `releaseLock(home, key)` —— 同样收 `home` + `key`。

好处是"必须留痕"变成**结构上不可遗漏**，不再依赖每个调用点记得补一行。

### A2（Important #2）「并发自增」测试名不副实 → 改名 + 去假并发

初版 `test('updateJson 并发 100 次自增不丢更新', async …)` 用 `Promise.all` + `Promise.resolve().then(...)` 包同步的 `updateJson`，Node 单线程逐个跑完，**零交错**；即便把 `updateJson` 退化成"非原子读 + 直接 `writeFileSync`"，计数照样是 100。它从未测过并发，而初版报告 §6 还用一条不成立的论证为它背书，向"并发安全"这个标题输出了虚假信心。

现在：`test('updateJson 连续 100 次读-改-写不丢更新（进程内串行）', …)`，改成朴素 `for` 循环，并在测试上方写明"这条**不测并发**……跨进程的原子性由调用方的锁负责，本任务不提供该保证，也就不假造一个测试去暗示它成立"。按 controller 指示**未**引入 `worker_threads`/子进程——`updateJson` 本就不承诺跨进程原子性，为不存在的保证造测试是本末倒置；真正的多进程验证已由 controller 记入 deferred。

### A3（Minor）损坏/半截锁文件不再把锁永久卡死；`releaseLock` 不再静默吞错

- 初版：`held` 解析失败 → `readJson` 返回 `null` → `expired` 恒为 `false` → **这把锁永远抢不到**。静默的活性故障，比崩溃更难查。
- 现在：`const unreadable = held === null || typeof held.startedAt !== 'number'`；`unreadable` 即视为持有者已死，可抢占，审计行 `reason: 'unreadable'`。
- `releaseLock` 的 `catch {}` 改为：非 `ENOENT`（`EACCES`/`EBUSY`，锁其实没删掉）时 `process.emitWarning(...)`，与项目「静默失效必须可观测」的口径对齐。

### A4 未改动的东西（逐个核对过）

- `writeTextAtomic` / `writeJsonAtomic` / `readJson` / `updateJson`：**本轮零改动**（本轮 lib diff 的两个 hunk 都落在第 155..204 行的锁区段，见 B3）。
- Task 2 的 12 个函数：**本轮零改动**。
- `RENAME_RETRY_MS` / `sleepSync` / 重试循环：仍然只有一份，`writeJsonAtomic` 仍是纯委托。
- `package.json`、lockfile、依赖：未动。仍然只用 `node:` 内置模块。
- controller 的提交 `bc3aa0e` / `298cdfd` / `02be073`：未触碰。

### A5 订正初版报告的两处不准确断言（记录卫生，非 finding）

- 初版 §4 写"diff 里没有任何 `-` 删除行，`diff --stat` 为 `74 +++...` / 0 删除"，与 §5 的 `3 deletions(-)` 自相矛盾，且**前者是错的**。真实值：`git show --numstat 16c972e` = `73 1 lib/store.js`、`55 2 test/store.test.js`，即 3 条删除行，全部是被就地替换的 import 语句（`lib/store.js:2`、`test/store.test.js:3`、`test/store.test.js:6`），由 `git show -U0 --format= 16c972e | Select-String '^-[^-]'` 完整列出。**没有一条删除行落在任何函数体内**，所以"Task 2 未动"的实质结论不变。§4 已改写成与 diff 一致的说法。
- 初版 §4 引用的 hunk 头 `@@ -103,2 +103,74 @@` 与我当时实际运行的 `git show -U2 --format= 16c972e -- lib/store.js` 输出一致；`@@ -95,10 +95,82 @@` 是**同一次改动在 10 行上下文宽度下**的显示（`git show -U10 --format= 16c972e -- lib/store.js` 复现该值），`-U3`（git 默认）下则为 `@@ -102,3 +102,75 @@`。hunk 头的行号区间随上下文宽度变化，三者指向同一改动区域：**第 3..94 行落在所有 hunk 之外，逐字节未变**。§4 现已给出可复现命令与三种宽度下的真实取值。
- 初版 §6「测试有效性核查」中那段为假并发背书的论证已删除并在原处标注订正；§7 无 CAS 抢占一条已补记"审查者裁定落在上游接受的 ceiling 内，不算 finding"。

## B. 覆盖测试与本轮命令

### B1 RED（改完测试、尚未改实现）

此轮先把测试改成新签名/新断言，此时 `lib/store.js` 仍是 `16c972e` 的旧锁实现（单路径 `acquireLock(file, opts)`）。

命令：

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node --test 2>&1
```

输出（12 tests / 8 pass / **4 fail**）：

```
✔ appendAudit 串起哈希链 (8.4233ms)
✔ verifyChain 检出被篡改的行 (6.8076ms)
✔ readAudit 只读当月与上月 (20.2077ms)
✔ 半截 JSON 行不让整条链炸掉 (4.9104ms)
✔ 链跨月连续：跨月读取后 verifyChain 不误报 (10.136ms)
✔ 窗口验证：readAudit 默认只读两个月，必须用 seed 补上窗口前那条的 hash (8.0654ms)
✔ updateJson 连续 100 次读-改-写不丢更新（进程内串行） (218.0724ms)
✔ writeJsonAtomic 留下完整 JSON，不留临时文件 (4.1333ms)
✖ 锁：抢不到返回 null (6.4528ms)
✖ 锁：过期可抢占，且抢占必须留下审计行 (2.6135ms)
✖ 锁：损坏/半截的锁文件视为持有者已死，可被抢占（否则这把锁永久卡死） (2.6323ms)
✖ 锁：release 后可再抢 (3.7651ms)
ℹ tests 12
ℹ suites 0
ℹ pass 8
ℹ fail 4
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 947.1059

✖ failing tests:

test at test\store.test.js:117:1
✖ 锁：抢不到返回 null (6.4528ms)
  AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
    assert.ok(acquireLock(h, 'relay-s1', { ttlMs: 60000, now: 1000 }))
    actual: null
    expected: true

test at test\store.test.js:123:1
✖ 锁：过期可抢占，且抢占必须留下审计行 (2.6135ms)
  TypeError: Cannot read properties of null (reading 'ok')

test at test\store.test.js:137:1
✖ 锁：损坏/半截的锁文件视为持有者已死，可被抢占（否则这把锁永久卡死） (2.6323ms)
  Error: ENOENT: no such file or directory, open '…\dj-store-HEnWO8\steward\locks\relay-s1.lock'
      at writeFileSync (node:fs:2482:20)
```

[exit code: 1]

为什么这个失败是"预期中的"：新测试按 `acquireLock(home, key, opts)` 调用，而当时的实现是 `acquireLock(file, opts)`——`home` 被当成锁文件路径、`key` 字符串被当成 opts 解构。于是第一次"获取"就返回 `null`（`writeFileSync(目录, …, {flag:'wx'})` 在 Windows 上报 `EEXIST` → 落到 `readJson(目录)` 报 `EISDIR` → `held = null` → 旧代码 `if (!expired) return null`），`relay-s1.lock` 目录也从没被建出来（`ENOENT`）。四条锁测试全红，且**失败原因完全归因于"新契约尚未实现"**：三条非锁测试与两条不涉及锁语义的测试照旧全绿；改名后的 `updateJson` 串行用例也绿——这正好反证了 Important #2：那条用例在"旧的非并发实现 + 假并发写法"下毫无区分力。

为留下这段完整 RED 证据，我临时把 `lib/store.js` 回退到 `16c972e`（`git checkout 16c972e -- lib/store.js`）跑完后按字节还原，并以 SHA256 校验还原无损（见 B3）。

### B2 GREEN（实现改完后，含还原后复跑）

命令：同上。

```
✔ appendAudit 串起哈希链 (9.9985ms)
✔ verifyChain 检出被篡改的行 (5.6162ms)
✔ readAudit 只读当月与上月 (20.176ms)
✔ 半截 JSON 行不让整条链炸掉 (6.1259ms)
✔ 链跨月连续：跨月读取后 verifyChain 不误报 (7.9894ms)
✔ 窗口验证：readAudit 默认只读两个月，必须用 seed 补上窗口前那条的 hash (9.7345ms)
✔ updateJson 连续 100 次读-改-写不丢更新（进程内串行） (212.9576ms)
✔ writeJsonAtomic 留下完整 JSON，不留临时文件 (3.1958ms)
✔ 锁：抢不到返回 null (3.676ms)
✔ 锁：过期可抢占，且抢占必须留下审计行 (8.8105ms)
✔ 锁：损坏/半截的锁文件视为持有者已死，可被抢占（否则这把锁永久卡死） (10.2445ms)
✔ 锁：release 后可再抢 (4.31ms)
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 974.1503
```

exit code: 0。**12 个测试全绿**（6 条 Task 2 + 6 条本任务），输出干净：无 `ExperimentalWarning`、无 `MaxListeners`、无未处理 rejection、无 `releaseLock` 告警（没有触发非 `ENOENT` 分支）。

新增的 2 条覆盖点（相对初版）：`锁：过期可抢占，且抢占必须留下审计行` 断言审计链里**恰好一行**且 `actionId === 'lock-steal'` / `result === 'stolen'` / `reason === 'expired'`（把 Important #1 钉死）；`锁：损坏/半截的锁文件…` 断言半截文件可被抢占且 `reason === 'unreadable'`（把 Minor 的活性故障钉死）。`updateJson` 那条改为串行后仍覆盖"连续 100 次读-改-写不丢更新"。

### B3 状态核对（还原无损 + 未误伤 Task 2）

```
restored sha256: 957EDE6707DE9D8D8C74B4DC094E92E7768BD6822902D6A87E364DD6393C657F
matches backup: True
== numstat ==
35      6       lib/store.js
32      13      test/store.test.js
== staged (expect empty) ==
== status ==
 M lib/store.js
 M test/store.test.js
```

本轮 lib diff 的 hunk 头（`git diff -U3 -- lib/store.js`）：

```
@@ -155,8 +155,15 @@ export function lockPath(home, key) {
@@ -164,13 +171,35 @@ export function acquireLock(file, { ttlMs, now = Date.now() }) {
```

两个 hunk 都落在第 155 行之后，即**只有锁区段被改**；`writeTextAtomic`（第 106..131 行附近）、`writeJsonAtomic`、`readJson`、`updateJson`、以及 Task 2 的全部函数都不在任何 hunk 内。本轮 6 条删除行全部来自 `acquireLock`/`releaseLock` 的旧实现行。

## C. 本轮自审

- **签名唯一性**：全仓 grep `acquireLock|releaseLock|lockPath` 只剩新签名的调用点（`test/store.test.js` 12 处、`lib/store.js` 定义/实现 6 处），没有任何遗留的旧签名调用者；`docs/…/plans/…md:1547`、`:1645` 的 Task 4 伪码也已使用 `acquireLock(home, lockKey, …)`，与本轮签名一致，后续任务不会踩空。
- **审计行与锁文件写入顺序**：先 `writeJsonAtomic` 落锁、再 `appendAudit` 留痕。若审计写失败会抛出（锁已持有、无痕），属 brief 既定顺序，未擅自调整。
- **`unreadable` 判定**：`held === null || typeof held.startedAt !== 'number'` 同时覆盖"空/半截文件"、"合法 JSON 但非对象"（如 `5`、`null`）、"缺字段"三种情况，不依赖 `held &&` 的短路陷阱。
- **无死导入**：本轮 lib/store.js 没新增任何导入（`appendAudit` 是同文件内的既有函数）；测试侧 `lockPath` 仍被损坏锁用例使用，`readFileSync` / `writeFileSync` / `readdirSync` / `readJson` / `readAudit` 均仍在使用。
- **未新增依赖、未碰 `~/.dsh/profiles/desktop/`、未碰 controller 的提交。**

## D. 遗留（按 controller 指示**不**在本轮处理）

1. 真正的跨进程并发验证（`worker_threads`/子进程压锁）——已记入 controller 的 deferred 台账。
2. 无 CAS 的抢占窗口、同名临时文件推理——审查者已裁定不算 finding，保持现状。
3. 报告迁移数字类问题（除本轮已订正的 §4/§6 两处外）——已记入台账，留给最终整分支审查分诊。
