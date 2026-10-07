# Task 2 报告：`lib/store.js` — 审计流水与哈希链

**Status:** DONE_WITH_CONCERNS
**Branch:** `feat/session-relay`
**Commit:** `f9ac4f7` feat(store): 审计流水 append-only + 哈希链 + 当月/上月读取

---

## 1. 实现了什么

按 brief 的 6 个 Step 逐条做完，代码为**逐行转写**（非重新设计）：

- `package.json`（仓库根，插件包清单）—— brief 里给了完整 JSON，逐字照抄。
- `test/store.test.js` —— brief 里的 4 个测试逐字照抄。
- `lib/store.js` —— brief 里的实现逐字照抄，导出 brief「Produces」列出的全部 8 个接口：
  `dshHome` / `auditDir` / `auditFile` / `canonical` / `hashEntry` / `appendAudit` / `readAudit` / `verifyChain`。

设计要点（均为 brief 原有，未增删）：审计落 `$DSH_HOME/steward/audit/YYYY-MM.jsonl`，每行 JSON 带
`prevHash`（上一行的 `hash`，首行为 `''`）与自身 `hash`（sha256 over 键排序的 `[k,v]` 数组，`hash` 字段自身不参与计算）；
`readAudit` 只读当月与上月、跳过解析不了的行；`verifyChain` 逐行校验 `prevHash` 链与 `hash`。

**未做（遵守控制方裁定）**：
- 没实现 `dryRun` 过滤 —— 唯一实现留在 `lib/relay.js`（Task 6）。
- 没碰原子写 / 单例锁 —— 那是 Task 3。
- `lib/store.js` 只 `import` `node:crypto` / `node:fs` / `node:os` / `node:path`，**零运行时依赖，不碰任何 `ctx`**。

---

## 2. 装依赖走的是哪条路（裁定 1）

**走的是主路线：npm registry，一次成功，不需要 `@deepseek-ai` scope 令牌。**
**没有**走 jsDelivr 退路。

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$pnpm = '<dsh-install>\resources\runtime\pnpm\bin\pnpm.cjs'
& $node $pnpm -C '<repo>' install
```

输出尾部（`EXIT=0`，22.9s，pnpm v11.7.0）：

```
Packages: +22
dependencies:
+ @deepseek-ai/cordis 4.0.4
devDependencies:
+ @deepseek-ai/dsh-tools 0.2.0-rc.2
+ @deepseek-ai/schemastery 3.18.4
Done in 22.9s using pnpm v11.7.0
```

证据（包确实装在**本仓库**、且**能从本仓库**解析到）：

```
> Get-ChildItem node_modules\@deepseek-ai | Select Name
cordis
dsh-tools
schemastery

> node -e "import('@deepseek-ai/schemastery').then(m=>console.log('schemastery ok', typeof m.default))"
schemastery ok function          # cwd = <repo>
```

`@deepseek-ai/cordis` 是被 pnpm 的 auto-install-peers 顺带装进 `node_modules` 的（`package.json`
的 `dependencies` 字段**没有**被改写，已核对）。没有用 `dsh plugin --profile … add`。

---

## 3. TDD 证据

### Step 2 — 先写测试
`test/store.test.js` 先于实现落盘，逐字来自 brief。

### Step 3 — RED（实现之前，真实输出）

命令与退出码：

```powershell
& $node --test
# EXIT=1
```

```
node:internal/modules/esm/resolve:272
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<repo>\lib\store.js'
    imported from <repo>\test\store.test.js
    at finalizeResolution (node:internal/modules/esm/resolve:272:11)
    at moduleResolve (node:internal/modules/esm/resolve:879:12)
    ...
  code: 'ERR_MODULE_NOT_FOUND'
```

**为什么这个失败是预期的：** `lib/store.js` 此刻还不存在，而测试文件第一行就 `import` 它，
所以 4 个测试一个都跑不到，加载期直接抛 `ERR_MODULE_NOT_FOUND`。这正是 brief Step 3 写的
Expected（`Cannot find module '../lib/store.js'`）。失败点正确 —— 它证明测试真的把被测模块接上了，
而不是「测试自己写错了所以失败」。

> **注意：brief 给的那条命令 `& $node --test test/` 在本机给出的不是这个失败** —— 见第 6 节 concern A。
> 它报的是 `Cannot find module '<repo>\test'`，测试文件根本没被加载，
> 属于「测试压根没跑」而不是「RED」。我改用能真正加载测试的无参形式拿到 RED。

### Step 5 — GREEN（实现之后，真实输出）

```powershell
& $node --test
# EXIT=0
```

```
✔ appendAudit 串起哈希链 (6.6968ms)
✔ verifyChain 检出被篡改的行 (3.65ms)
✔ readAudit 只读当月与上月 (17.9062ms)
✔ 半截 JSON 行不让整条链炸掉 (4.4169ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 708.9285
```

提交后再从 `HEAD` 复验一次，走仓库自己的脚本（`pnpm test` → `node --test`），同样 4/4、`EXIT=0`：

```
✔ appendAudit 串起哈希链 (6.2555ms)
✔ verifyChain 检出被篡改的行 (5.884ms)
✔ readAudit 只读当月与上月 (19.712ms)
✔ 半截 JSON 行不让整条链炸掉 (4.155ms)
ℹ tests 4  ℹ pass 4  ℹ fail 0  ℹ duration_ms 694.801
```

**输出整洁度：** 测试自身输出零告警、零 skip、零 todo。唯一的 stderr 噪音是 `pnpm test` 这一路
里 pnpm 把自己的命令横幅 `$ node --test` 写到 stderr、被 PowerShell 记成 `NativeCommandError`
（`FullyQualifiedErrorId: NativeCommandError`）—— 是 pnpm/PowerShell 的管道artifact，不是测试的警告；
直接 `node --test` 那一路 stderr 干净。

---

## 4. 文件变更（commit `f9ac4f7`，4 files changed, 479 insertions）

| 文件 | 状态 | 说明 |
|---|---|---|
| `package.json` | 新增 | brief 逐字照抄；**仅第 15 行 `scripts.test` 有偏离**，见 concern A |
| `lib/store.js` | 新增 | brief 逐字转写，81 行 |
| `test/store.test.js` | 新增 | brief 逐字转写，50 行 |
| `pnpm-lock.yaml` | 新增 | Step 1 `pnpm install` 的产物，见 concern B |

**转写保真度（机械核对，非目测）：** 把 brief 的代码块按行切出来跟落盘文件做 `Compare-Object -SyncWindow 0`：

```
IDENTICAL: brief lines 132-212 == lib/store.js (81 lines, 81 expected)
IDENTICAL: brief lines 69-118  == test/store.test.js (50 lines)
```

`node_modules/` 被仓库既有 `.gitignore:6` 正确忽略（`git check-ignore` 确认）。

---

## 5. 自审发现

1. **转写保真度** —— 用行级 diff 机核（上面第 4 节），不是靠眼睛。通过。
2. **死 import** —— 逐个核：`createHash`→`hashEntry`、`appendFileSync`/`mkdirSync`→`appendAudit`、
   `existsSync`/`readFileSync`→`lastHash`+`readAudit`、`homedir`→`dshHome`、`path`→`auditDir`/`auditFile`。全部在用，无死 import。
3. **YAGNI** —— `dshHome`/`auditDir`/`canonical` 当前没有测试或调用方，但它们是 brief「Produces」明列的接口，
   属被要求而非自造，保留。
4. **没越界** —— 全文件 grep 无 `dryRun` 过滤、无 `rename`/`open`/锁相关调用（Task 3 的地盘）。
5. **`package.json` 其余字段未被 `pnpm install` 改写**（尤其没偷偷塞 `dependencies`）。已读文件核对。

---

## 6. 问题与顾虑

### Concern A（需控制方裁定）：brief 指定的测试命令在本机 Node 上不工作，我改了 `scripts.test`

`E:\...\node\bin\node.exe` 是 **v24.21.0**。brief Step 3/5 指定的 `node --test test/`（也是
brief package.json 里的 `scripts.test`）在这个版本下**不把目录当搜索路径**，而是当成一个模块去 require：

```
=== node --test test/ ===
Error: Cannot find module '<repo>\test'
ℹ tests 1  ℹ pass 0  ℹ fail 1        # 测试文件从未被加载
```

实测四种写法（同一个 node）：

| 命令 | 结果 |
|---|---|
| `node --test test/` | ✖ 报 `Cannot find module '...\test'`，测试未被加载 |
| `node --test`（无参） | ✔ 自动发现 `test/store.test.js`，给出 brief 预期的 RED |
| `node --test "test/**/*.test.js"` | ✔ node 自己展开 glob |
| `node --test test/store.test.js` | ✔ |

**我的处理：** 把 `scripts.test` 从 brief 的 `"node --test test/"` 改成 `"node --test"`（无参形式在
Node 18+ 都是默认发现 `test/` 下测试文件，向后兼容，且让 `pnpm test` 真的可用）。**这是对 brief 里
`package.json` 唯一的一处偏离**，其余一字未动；commit 正文里也写明了理由。

**为什么我自作主张而没等你回话：** 我尝试用 `ask_user_question` 问，但作为被另一个活 agent 拥有的子 agent，
人机交互不可用（工具返回 "human interaction is unavailable…"），按指示我把决定写进报告交给你裁定。
**如果你要严格照抄 brief，请把 `scripts.test` 改回 `"node --test test/"`** —— 代价是仓库自己的
`pnpm test` 在这台机器上一跑就挂，后续 Task 3/6/7/8 每次都得手敲变体命令。

### Concern B（需控制方裁定）：`pnpm-lock.yaml` 我一起提交了

brief Step 6 只让 `git add package.json lib/store.js test/store.test.js`。但 Step 1 的 `pnpm install`
在仓库根生成了 `pnpm-lock.yaml`，我把它一并入库（4 个文件而非 3 个）。理由：它是 Step 1 的直接产物，
不入库则 `node_modules` 不可复现，而且会作为未跟踪文件挂在那，被 Task 3 的 `git add -A` 顺手扫进它自己的提交。
**若你认为锁文件不该进库，`git rm --cached pnpm-lock.yaml` 即可，不影响任何代码。**

### Concern C（只是记录，不是问题）：时区口径

`readAudit` 用本地时区的月份边界去切**文件名**，而 `ts` 是 UTC 字符串 —— 这是 brief 的设计，测试
（UTC+8 下）通过。跨月边界的记录可能落到「上上个月」的文件里而读不到。这是审计量级的可接受取舍，我未改。

**后续状态：** Concern A 与 B 均已被控制方裁定吸收进 brief（commit `298cdfd`：`scripts.test` 定为
`node --test`、lockfile 入库）。现在的 brief 第 37 行就是 `"scripts": { "test": "node --test" }`，
与落盘一致，偏离已消解。

---

# 7. 审查返工（Ruling 13）

**Status:** DONE
**Commit:** `41d916a` fix(store): 哈希链跨文件连续 + verifyChain 可选 seed（Ruling 13）

## 7.1 改了什么

审查的 Important 结论：`appendAudit` 每条文件都从 `lastHash(file)` 重置 `prevHash`，而 `readAudit`
会把当月+上月拼成一个序列交给 `verifyChain`（后者假设是一条连续链），于是**任意跨两个月且两文件都有数据
→ 必然报一次 `{ok:false, brokenAt:1}`**。按控制方改好的 brief（`02be073`）逐字落代码，两处结构改动：

1. **`lastHashIn(file)` 拆出 + 新增 `lastHash(home, date, maxBack = 12)`** —— 当月文件为空时按日历月回溯
   最多 12 个月，取最近一条 `hash`。`appendAudit` 改为 `prevHash: lastHash(home, date)`（并顺带把
   `date` 提为局部变量复用），链因此**跨文件连续**。
2. **`verifyChain(entries, seed = '')`** —— `let prev = seed`。验证窗口（`readAudit` 默认只读两个月）时，
   窗口之前那条的 hash 不在手里，由调用方通过 `seed` 补上；不传 seed 时"窗口首行对不上"是**有意行为**，测试里也如此断言。

## 7.2 覆盖测试（新增 2 条，逐字来自 brief）

- `链跨月连续：跨月读取后 verifyChain 不误报` —— 8/9/10 月各写一条，`readAudit(h, 12, …)` 得到
  `['aug','sep','oct']`，断言 `verifyChain(all).ok === true`，且 `oct.prevHash === sep.hash`。
- `窗口验证：readAudit 默认只读两个月，必须用 seed 补上窗口前那条的 hash` —— 断言窗口是 `['sep','oct']`，
  不传 seed 时 `ok === false && brokenAt === 0`（有意），传 `aug.hash` 后 `ok === true`。

## 7.3 TDD 证据（RED → GREEN）

**RED（只加测试、未改实现）：** `& $node --test`，`EXIT=1`

```
✔ appendAudit 串起哈希链 (7.6485ms)
✔ verifyChain 检出被篡改的行 (5.1839ms)
✔ readAudit 只读当月与上月 (17.9308ms)
✔ 半截 JSON 行不让整条链炸掉 (4.6663ms)
✖ 链跨月连续：跨月读取后 verifyChain 不误报 (8.4514ms)
✖ 窗口验证：readAudit 默认只读两个月，必须用 seed 补上窗口前那条的 hash (5.0147ms)
ℹ tests 6  ℹ pass 4  ℹ fail 2
```

失败内容正是被报告的缺陷本身：跨月那条挂在 `verifyChain(all).ok` 期望 true 实得 false（月边界断链）；
窗口那条挂在 `brokenAt` 期望 0 实得 1（`seed` 参数尚不存在）。**4 条老测试此时仍全绿** —— 说明补充的测试
没有破坏既有行为，且原测试套件确实抓不到这个缺陷（如审查所说）。

**GREEN（改完实现）：** `& $node --test`，`EXIT=0`

```
✔ appendAudit 串起哈希链 (9.7393ms)
✔ verifyChain 检出被篡改的行 (4.9142ms)
✔ readAudit 只读当月与上月 (19.9965ms)
✔ 半截 JSON 行不让整条链炸掉 (6.1593ms)
✔ 链跨月连续：跨月读取后 verifyChain 不误报 (8.9512ms)
✔ 窗口验证：readAudit 默认只读两个月，必须用 seed 补上窗口前那条的 hash (9.9475ms)
ℹ tests 6  ℹ suites 0  ℹ pass 6  ℹ fail 0  ℹ cancelled 0  ℹ skipped 0  ℹ todo 0
ℹ duration_ms 718.9141
```

提交 `41d916a` 之后又从 `HEAD` 复跑一次，同样 6/6、`EXIT=0`、stderr 干净（零告警 / 零 skip / 零 todo）。

## 7.4 转写保真度与自审（返工后重做）

对照改后的 brief（286 行）重新机核，`Compare-Object -SyncWindow 0` 行级比对：

```
IDENTICAL: lib/store.js       (104 lines)   # == brief 163-266
IDENTICAL: test/store.test.js (81 lines)    # == brief 69-149
                                              # brief 第 37 行 scripts.test == package.json 第 15 行
```

- **`git diff` 只含预期的两处改动**，无顺手改动、无格式噪音；两个文件都无死代码：`lastHashIn` 只被
  `lastHash` 用，`lastHash` 只被 `appendAudit` 用；没有新增 import（`auditFile` 本文件已有）。
- **未越界**：仍然没有 `dryRun` 过滤、没有 Task 3 的原子写/锁。
- 控制方点名的 2 条 Minor（`ymOf` 本地时区 vs UTC `ts`；`lastHash` 每次 append 重读整文件 O(n²)）
  **按要求未动**，留台账。

## 7.5 顾虑

`lastHash` 回溯上限 `maxBack = 12` 个月，即"连续 12 个月无任何审计"才会退化成空 `prevHash`；
而 `readAudit` 默认窗口只读 2 个月，所以**只要发生过一次跨空档月的写入**，窗口验证就必须靠 `seed` 补
（brief 的 `ponytail:` 注释已把这层天花板写明）。这是裁定范围内的设计，不是缺陷，但 Task 6/8 真正接上
`verifyChain` 时，**调用方必须记得传 seed**，否则会重新引入"窗口首行误报"——只把 `ok:false` 当红是安全的，
但只传窗口内数据又期望 `ok:true` 就会踩坑。建议 Task 6 在 `relay.js` 里落一个"读窗口 + 取窗口前一条 hash +
verify"的小封装，把这条约束收进一处。
