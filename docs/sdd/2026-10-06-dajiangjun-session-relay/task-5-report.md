# Task 5 Report — `lib/relay.js` 四类禁写内容

**Status:** DONE
**Commit:** `dad1542` — `feat(relay): 交接档四类禁写内容检查（不回显命中内容）` (branch `feat/session-relay`)
**Fix commit (Ruling 19):** `dad1542` — 同标题；收窄内网地址 URL 规则，公网 FQDN 放行。详见文末 §9。
**Files changed:** `lib/relay.js` (+32 / +3 行注释并替换 1 行正则), `test/relay.test.js` (+26 新测试 / +15 fix 测试 / -1 import line)

---

## 1. What I implemented

追加到 `lib/relay.js`（纯追加，见 §4）：

- `const FORBIDDEN` —— 三个类目的模式表：`凭据值`（`sk-` 前缀 / `Bearer` / `password|passwd|token|secret|api_key` 赋值）、`内网地址`（RFC1918 字面 + 非回环 http(s) 主机）、`他人隐私`（中国大陆手机号 + 邮箱）。
- `export function checkForbidden(text, opts = {})` —— 逐行匹配前三类（每行只记**第一个**命中的类目，`break`），再对全体行做连续 `user:`/`assistant:` 计数，累计到 `opts.quoteLines`（默认 5）时记一条 `会话原文`。返回 `{ ok, hits: [{ kind, line }] }`。

逐字转录自 brief 第 55–86 行，未做任何改写（含注释与可变/不可变写法）。零新 import、零 I/O、不碰 `ctx`。

## 2. What I tested and results

| 命令 | 结果 |
| --- | --- |
| `& $node --test test/relay.test.js` | **8 pass / 0 fail**（Task 4 的 5 + 本任务 3），exit 0 |
| `& $node --test` | **20 pass / 0 fail**（store 12 + relay 8），exit 0 |

单文件命令用的是 brief 指定的**文件形式**，不是目录形式；全套用无参 `& $node --test`（其自带发现规则），两者都真实加载了测试文件（GREEN 输出逐条列出 20 个测试名，不存在"目录当模块 require"的 `Cannot find module`）。

输出干净：只有 `✔` / `ℹ` 行，无 stderr 噪声、无 warning、无未处理拒绝。

新增 3 个测试逐字来自 brief 第 18–41 行；`干净文本通过；回环地址不算内网` 断言的正是"`127.0.0.1` 与本地文档路径不算禁写"。

## 3. TDD Evidence

### RED（实现之前，只有测试）

命令：

```powershell
& $node --test test/relay.test.js 2>&1 | Select-Object -First 14
```

真实输出（头 8 行）：

```
file:///<repo>/test/relay.test.js:3
import { checkForbidden, parseDoc, resolveMainline, validateDoc } from '../lib/relay.js'
         ^^^^^^^^^^^^^^
SyntaxError: The requested module '../lib/relay.js' does not provide an export named 'checkForbidden'
    at #asyncInstantiate (node:internal/modules/esm/module_job:455:21)
    at async ModuleJob.run (node:internal/modules/esm/module_job:553:5)
```

尾部汇总：`ℹ tests 1 / ℹ pass 0 / ℹ fail 1`，`EXIT=1`。

**为什么这是预期失败：** `checkForbidden` 当时还不存在于 `lib/relay.js`，测试文件却已经 import 它，所以断言确实跑不起来、测试全红——新测试确实先于实现落地。

**与 brief 预期文案的差异（记录，非缺陷）：** brief Step 2 写的预期是 `checkForbidden is not a function`。实际报的是 ESM 链期 `SyntaxError: does not provide an export named 'checkForbidden'`。原因：ESM 的具名导入在**链接阶段**解析，不等函数被调用；缺导出比"调用时才发现不是函数"更早失败。信号等价（测试加载失败、全红、非零退出），且这是 Node 的固定行为，不可通过改写测试规避——任何形式的 import 都会这样。我没有为了凑出那句文案去改测试或先塞一个空实现。

### GREEN（实现之后）

命令：

```powershell
& $node --test test/relay.test.js 2>&1 | Select-Object -Last 20
```

真实输出：

```
✔ 正例通过 (1.2091ms)
✔ 反例一：下一步段全是散文没有有序列表 → 拒 (1.2412ms)
✔ 反例二：已完成项无证据路径 → 拒 (0.2275ms)
✔ 反例三：段标题不是逐字匹配 → 拒 (0.1946ms)
✔ 主线名取值序：段1 → 文件名 → null (0.4122ms)
✔ 四类禁写各命中一例 (1.2617ms)
✔ 干净文本通过；回环地址不算内网 (0.1586ms)
✔ 命中项不回显命中内容 (0.2116ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 139.3817
EXIT=0
```

全套 `& $node --test` 同样全绿：`ℹ tests 20 / ℹ pass 20 / ℹ fail 0`，`EXIT=0`。

## 4. Task 4 未被改动（逐条核对）

`git diff -- lib/relay.js` 是**单一追加 hunk**：`@@ -65,2 +65,34 @@`，context 只有 `resolveMainline` 结尾两行（`return first` / `}`），无任何 `-` 行。

- `SECTIONS` / `HEADING` / `ORDERED` / `HAS_EVIDENCE` / `parseDoc` / `sectionText` / `validateDoc` / `resolveMainline` —— 一个字符未动。
- `lib/store.js`、`test/store.test.js`、`package.json` —— 未纳入本次 add，`git status` 干净，未被触碰。
- `test/relay.test.js` 的 5 个既有测试 —— 未动。
- 我按指示**没有碰 `HAS_EVIDENCE`**，也没有基于那条被审查者判定为错误的观察做任何改动。

`test/relay.test.js` 唯一被改的既有行是 import 行：

```
-import { parseDoc, resolveMainline, validateDoc } from '../lib/relay.js'
+import { checkForbidden, parseDoc, resolveMainline, validateDoc } from '../lib/relay.js'
```

brief Step 1 把 import 写成了一行独立的 `import { checkForbidden } from '../lib/relay.js'`。我把它并入既有的同一模块 import 行：从同一模块重复 import 是冗余写法，并入是同一语义下更小的 diff。**这是本任务唯一对 brief 的偏离**，且不涉及任何测试体。

纯度复核（grep `lib/relay.js`）：`^\s*import `、`ctx`、`require(`、`readFile`、`writeFile` —— **全部 0 命中**。本任务没有新增任何 import。

## 5. 返回值不回显命中内容（怎么核的）

代码层（读 diff）：`checkForbidden` 只 `push({ kind, line })`；`kind` 取自常量表字面量，`line` 是 `i + 1` 索引。函数体内不存在任何把 `line`/`text`/匹配片段拼进返回值的路径。

**没有 throw 泄漏路径**：函数无 `try/catch`、自身不 `throw`，唯一可能抛的是 `String(text)`，而它抛错时消息来自**调用方对象**的 `toString`，与我们匹配到的内容无关，也不会被本函数捕获后重新包装（无包装点）。三类模式均为字面量正则，编译发生在模块加载期而非调用期，故调用期不存在"正则异常把内容带进消息"的路径；且所有正则**无 `/g` flag**，`.test()` 无 `lastIndex` 状态残留，不存在跨调用串味。

**对抗性探针**（一次性 `node --input-type=module -e`，未落任何文件到仓库），把四类命中 + `Bearer` + `172.16.0.5` + 手机号 + 内网主机名 + 自定义 `quoteLines: 3` 全部喂进去，再对整个 `JSON.stringify(结果)` 做子串检查，泄漏样本集含 `sk-abc…`、`192.168.1.20`、`zhang.san`、`zhang.san@example.com`、`user: a`、`assistant: b`、`abcdefghijklmnop`、`172.16.0.5`、`13812345678`、`internal.host`：

```
RETURN = [{"ok":false,"hits":[{"kind":"凭据值","line":1}]},{"ok":false,"hits":[{"kind":"内网地址","line":1}]},{"ok":false,"hits":[{"kind":"他人隐私","line":1}]},{"ok":false,"hits":[{"kind":"会话原文","line":5}]},{"ok":false,"hits":[{"kind":"凭据值","line":1},{"kind":"凭据值","line":2},{"kind":"内网地址","line":3},{"kind":"他人隐私","line":4},{"kind":"内网地址","line":5}]},{"ok":false,"hits":[{"kind":"会话原文","line":3}]}]
LEAKED = []
CLEAN_OK = true
QUOTE_DEFAULT_4LINES = true
EXIT=0
```

`LEAKED = []` 即全部命中内容都未出现在返回值中。同时确认了：`quoteLines` 选项生效（3 行即位）、默认阈值是 5（只有 4 行 `user:`/`assistant:` 时 `ok: true`，符合"连续 >= quoteLines"语义）、回环与本地路径不误报。仓库内的 `命中项不回显命中内容` 测试对 `sk-…` 这一例做同样的 `JSON.stringify` 子串断言。

## 6. Files changed

- `lib/relay.js` —— +32 行，纯追加（`FORBIDDEN` + `checkForbidden`）
- `test/relay.test.js` —— +26 行（3 个测试）、1 行 import 合并
- `.superpowers/sdd/2026-10-06-dajiangjun-session-relay/task-5-report.md` —— 本报告（该目录被 `.superpowers/sdd/.gitignore` 的 `*` 忽略，故不入 git，与 brief 的两文件 add 清单一致）

## 7. Self-review findings

- **Completeness**：四类禁写都有模式且在测试中各命中一例；brief 的 5 个 Step 全部执行；单文件 8 / 全套 20 均绿。
- **Discipline/YAGNI**：逐字转录，没有加"顺手"的第四类模式、没有加 `opts` 里 brief 未定义的第二开关、没有抽公共匹配器。没动任何 Task 4 代码。
- **Security**：见 §5；无回显、无 throw 泄漏路径、无正则状态残留。
- **Testing**：3 个新测试断言的是真实行为（四类各自被拦、干净文本放行、阈值语义、不回显），不是实现细节的镜像；输出干净。
- **发现并已在报告内记录的偏离（非代码缺陷）**：① brief Step 2 的预期失败文案与实际 ESM 链期报错不同（§3）；② import 合并而非新增重复 import 行（§4）。两处都不改语义，我没有为了"看起来逐字一致"去引入冗余或先塞空实现。

无遗留缺陷，无未完成项。

## 8. Issues / concerns

1. **类目判定的固有粗略度（brief 设计使然，非本任务引入）**：`内网地址` 的第二条模式 `https?:\/\/(?!127\.0\.0\.1|localhost\b)[A-Za-z0-9.-]+` 会把**任何**非回环/非 localhost 的 URL 主机判为命中——包括公网文档站（如 `https://nodejs.org/api/`）。这在本任务的 3 个测试之外，测试里恰好只用了回环地址，所以不会红；但接进闸门后，交接档里若出现公网链接就会被拦下。我**按 brief 逐字实现、未擅自放宽**——这是"宁可误拦"的安全侧取向，判定权在控制器：若实际想放行公网 http(s)，那是一条需要新测试的独立改动，不该由转录任务顺手带。**→ 已被审查证实并定级 Important，Ruling 19 裁定修；见 §9。**
2. **`他人隐私` 只覆盖手机号与邮箱**（无身份证、无微信/QQ），`凭据值` 的 `password|token…` 分支要求 `[:=]` 赋值形状。同属 brief 划定的 v1 覆盖面，记录备查。
3. **`会话原文` 只记累计到阈值的那一行**，不记连续区的起点/终点；一行同时命中"会话原文"与前三类时会出现同一行两条 hit（前者由第二个循环独立追加）。与 brief 实现一致，供下游展示时注意。

---

## 9. Fix Report — Ruling 19（收窄内网 URL 规则，公网 FQDN 放行）

**Fix commit:** `dad1542` `feat(relay): 交接档四类禁写内容检查（不回显命中内容）`（2 files changed, 19 insertions(+), 1 deletion(-)）
**触发:** 审查证实 §8 的第 1 条 Concern（本轮唯一 Important），控制器以 Ruling 19 裁定修复。我原样上报、未擅自改——返工后同样只按 brief 改，没有夹带别的调整。

### 9.1 改了什么

`lib/relay.js` 的 `内网地址` 条目：替换 URL 那条模式，并加 3 行解释性注释（逐字取自新 brief 第 73–76 行）：

```diff
-  ['内网地址', /* 私网 IP 模式不变 */, /https?:\/\/(?!127\.0\.0\.1|localhost\b)[A-Za-z0-9.-]+/],
+  // 内网地址之一：非回环、且**不像公网 FQDN** 的 URL 主机——无点的裸主机名，或私有后缀。
+  // 刻意**不**拦公网 FQDN：公网链接不泄漏内网拓扑，拦它没有安全收益，代价却是误报率，
+  // 而上游设计把误报率列为第一 KPI（doc 07）。私网 IP 由本类前一条模式负责，这里不重复覆盖。
+  ['内网地址', /* 私网 IP 模式不变 */, /https?:\/\/(?!127\.0\.0\.1|localhost\b)(?:[A-Za-z0-9-]+\.(?:local|lan|internal|intranet|home|corp)\b|[A-Za-z0-9-]+(?![\w.-]))/i],
```

（上方 diff 为可读性省略了未改动的私网 IP 模式，实际该模式逐字未动；完整增删见 `git show dad1542`。）

新规则两个分支：**无点的裸主机名**（`my-nas`）与**私有后缀**（`storage.local`）。控制器另加 `/i`。私网 IP 仍由同类第一条模式负责，URL 模式不重复覆盖。

`test/relay.test.js`：新增 `内网地址：公网链接放行、内网主机名拦住`，逐字取自新 brief 第 37–50 行（插入位置也在 brief 指定的 `干净文本通过` 与 `命中项不回显命中内容` 之间）。

改动范围核对：`git diff dad1542^ dad1542` 只有上述两处；Task 4 的 8 个函数、`checkForbidden` 的函数体、其余三类模式、`lib/store.js`、`test/store.test.js`、`package.json` 均一字未动。控制器自己的 `edfdea1`（plan/spec 修正）我没有碰。

### 9.2 TDD 证据（保序：先测试 → RED → 再实现 → GREEN）

**RED —— 新测试 + 旧正则**（`lib/relay.js` 此时仍是旧模式，未提前改实现）

命令：

```powershell
& $node --test test/relay.test.js 2>&1 | Select-Object -Last 24
```

真实输出（断言失败部分）：

```
✖ failing tests:

test at test\relay.test.js:89:1
✖ 内网地址：公网链接放行、内网主机名拦住 (0.8642ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  false !== true
  
      at TestContext.<anonymous> (file:///<repo>/test/relay.test.js:92:10)
```

汇总（同一次运行的 `Select-String` 版）：

```
✖ 内网地址：公网链接放行、内网主机名拦住 (0.8742ms)
ℹ tests 9
ℹ pass 8
ℹ fail 1
```

**为什么这是预期失败：** 失败点 `test/relay.test.js:92` 正是 `assert.equal(checkForbidden('见 https://nodejs.org/api/ 的说明').ok, true)`；`actual: false, expected: true` 即旧模式把公网文档链判成了 `内网地址`——正是 Ruling 19 要修的那个误报。控制器预判的这一例逐位命中。

**GREEN —— 换上新正则后**

命令：

```powershell
& $node --test test/relay.test.js 2>&1 | Select-Object -Last 20
```

真实输出：

```
✔ 正例通过 (1.2588ms)
✔ 反例一：下一步段全是散文没有有序列表 → 拒 (0.297ms)
✔ 反例二：已完成项无证据路径 → 拒 (0.168ms)
✔ 反例三：段标题不是逐字匹配 → 拒 (0.157ms)
✔ 主线名取值序：段1 → 文件名 → null (0.3518ms)
✔ 四类禁写各命中一例 (1.6588ms)
✔ 干净文本通过；回环地址不算内网 (0.2492ms)
✔ 内网地址：公网链接放行、内网主机名拦住 (0.1871ms)
✔ 命中项不回显命中内容 (0.3523ms)
ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 142.8532
EXIT=0
```

全套 `& $node --test` → **`ℹ tests 21 / ℹ pass 21 / ℹ fail 0`，`EXIT=0`**（store 12 + relay 9）。输出干净：只有 `✔` / `ℹ` 行。

### 9.3 补充探针（两个方向都对，且仍未回显）

除 brief 的测试外，我另跑了一次性 `node --input-type=module -e` 探针（未落任何文件到仓库），同时查**误报**（该放行的被拦）与**漏报**（该拦的放行）：

- 应放行 8 例：`https://nodejs.org/api/`、`https://github.com/kira905/ops-handoff-design`、`http://example.com/x`、`https://a.b.example.com/p`、`http://my-nas.example.com/`（公网 FQDN，裸名只是首标签）、`http://127.0.0.1:19387/…`、`http://localhost:3080/`、`http://LOCALHOST:8080/x`（`/i` 生效）
- 应拦住 12 例：`http://my-nas/`、`http://my-nas:8080/x`（带端口）、`http://storage.local/`、`http://box.lan/`、`http://box.home/`、`http://x.corp/`、`http://x.internal/`、`http://x.intranet/`、`http://STORAGE.LOCAL/`（`/i`）、`http://192.168.1.20:3080`、`http://10.0.0.5/`、`http://172.20.1.9/`

真实输出：

```
SHOULD_ALLOW_BUT_BLOCKED = []
SHOULD_BLOCK_BUT_ALLOWED = []
LEAKED = []
SAMPLE = {"ok":false,"hits":[{"kind":"内网地址","line":1}]}
```

`SHOULD_ALLOW_BUT_BLOCKED = []` 即误报清零（`http://my-nas.example.com/` 这种"首标签是裸名的公网 FQDN"也没被误伤）；`SHOULD_BLOCK_BUT_ALLOWED = []` 即新规则没有以漏报换误报；`LEAKED = []` 确认改造后**返回值仍只含 `{kind, line}`**，无回显回归（泄漏样本集含 `sk-…`、`192.168.1.20`、`zhang.san`、`my-nas`、`storage.local`、`user: a`）。

### 9.4 未动的 deferred Minor（按控制器指示留给最终整分支审查）

`\d{1,3}` 允许 >255、`127.0.0.0/8` 只排除了 `127.0.0.1`、会话原文只记阈值行、IPv6 未覆盖、探针 vs 结构证据那条观察——**均未触碰**。

### 9.5 本次修复新观察到的残留边界（仅记录，未改；判定权在控制器）

新正则沿用未改的负向前瞻 `(?!127\.0\.0\.1|localhost\b)`，于是 **`http://localhost.evil.com/x`、`http://127.0.0.1.evil.com/x` 会被放行**——因为这些主机名以 `localhost` / `127.0.0.1` 的**标签前缀**开头，`\b` 在 `.` 处成立。这是**旧模式同样的行为**（该前瞻本次未动），非本次引入；我按 Ruling 19 逐字实现、没有顺手改前瞻。同理，`https://my.local.host/` 会因 `\.local\b` 在中间标签处成立而被拦（偏严一侧，安全侧无害）。这两点都不在 deferred Minor 清单里，故一并上交，由最终审查分诊。
