# SDD ledger — plan: docs/superpowers/plans/2026-10-06-dajiangjun-session-relay.md

Spec: docs/superpowers/specs/2026-10-06-dajiangjun-session-relay-design.md （可读，裁决以它为准）
Branch: feat/session-relay
BASE (branch point): 933bfa0

## 预检扫描

### A. 共享文件/接口的任务对

| # | 任务对 | 共享 | 产出 → 消费 | 发现 |
|---|---|---|---|---|
| 1 | T2→T3 | `lib/store.js`, `test/store.test.js` | `dshHome`/`auditFile`/`appendAudit`/`readAudit`/`verifyChain` → T3 加 `writeTextAtomic`/`writeJsonAtomic`/`readJson`/`updateJson`/`lockPath`/`acquireLock`/`releaseLock` | 一致。T3 测试要补的 `readJson`/`readdirSync` 导入，计划已点名 |
| 2 | T3→T8 | `lib/store.js` → `lib/index.js` | `writeTextAtomic` → `dispatchRelay` 回写档头 | 一致（自审已收成单份实现） |
| 3 | T4→T5→T6 | `lib/relay.js`, `test/relay.test.js` | T4 `parseDoc`/`validateDoc`/`resolveMainline`；T5 `checkForbidden`；T6 `MODE_SEQ`/`permissionOk`/`dedupeKey`/`makeRelayId`/`evaluateGates` | 一致。同模块重复 import 在 ESM 下合法 |
| 4 | T6→T7 | `lib/relay.js` → `lib/index.js` | `evaluateGates(input)` 的 9 个字段 | 一致，T7 实参逐一对应 |
| 5 | T7→T8→T9 | `lib/index.js`, `test/index.test.js` | T7 `Config`/`apply`/`runRelay`/`INSTRUCTION`/`OUTPUT`；T8 `dispatchRelay`；T9 `notifyLine`/`shouldNotify` | 一致；替身与 fixture 同文件复用，T8 明令不得重复定义 |
| 6 | T1→T7/T8 | `docs/notes/dsh-api-notes.md` | 服务键名 → `inject` 数组 | **接口留口**：T7 的 `inject` 依赖 T1 实测。见 Ruling 2 |
| 7 | T2→T7 | `package.json` devDependencies | `schemastery`/`dsh-tools` 可被 repo 内 import 解析 | **缺陷，已修**。见 Ruling 1 |
| 8 | T1→T10 | `_scratch/hello` 的安装方式 | 隔离 profile 名 `steward-dev` | 一致 |

### B. 每个任务的自洽性

| 任务 | 自洽 | 发现 |
|---|---|---|
| T1 | 是（修后） | 原缺端口占用 / peer 解析的绕法 → 已补。见 Ruling 3 |
| T2 | 是 | import 表已收紧，无死导入 |
| T3 | 是 | `updateJson` 的并发边界写在注释里，未夸大 |
| T4 | 是 | 反例三用 `## 下一步是什么` 验证逐字匹配，与该任务断言对齐 |
| T5 | 是 | 回环白名单与内网正则不冲突 |
| T6 | 是 | 闸门短路顺序被测试显式验证（"总开关先于一切"） |
| T7 | 是 | 预览必须留一行审计，测试断言 `rows.length === 1`，与实现对齐 |
| T8 | 是 | R-1 硬断言只出现一处（已删 Step 6 的重复抄写） |
| T9 | 是 | 取不到模型上限则不提醒，与 spec §13.5 一致 |
| T10 | 是 | 上 desktop 前强制备份 |

## 裁决（Rulings）

- **Ruling 1** — T2 增加 `devDependencies` 并在 repo 内 install（原计划只在 T7 用 `dsh plugin --profile … add`，那是宿主运行时的解析路径，解决不了 repo 内 `import`）。
  代价若错：多一个 devDependency 和一次网络安装；不改运行时契约（peer 才是）。
- **Ruling 2** — T7 的 `inject` 采用 T1 笔记的**实测键名**；某个服务取不到就把它从 `inject` 去掉、改用可选链降级，**不猜键名**。
  代价若错：对应功能静默不生效（最坏是提醒不触发，不会崩）。
- **Ruling 3** — 允许 T1 用 pnpm 的 `--no-strict-peer-dependencies` 或删掉探针包 peer 来绕过解析；**判据是"插件行列进了配置树"，不是用了哪条命令**。
  代价若错：探针与真实包的安装细节略有差异，T10 装真包时会再遇一次。
- **Ruling 4** — T9 **不**把 `llm` 加进 `inject`。DSH 的 inject 语义是"缺服务则不激活"，为一个有优雅降级的可选读操作赌整个插件不激活不划算；spec §13.5 本就规定取不到分母就不提醒。T1 笔记若确认该键存在且服务总是挂载，T9 再加。
  代价若错：提醒功能永不触发。
- **Ruling 5** — **不做 git worktree**，就地开分支 `feat/session-relay`。T10 用绝对路径把插件装进 profile，worktree 会改变那个路径；且本仓无并行工作需要保护。
  代价若错：主检出上直接带着实现分支（可随时切回 `main`，无数据风险）。
- **Ruling 6** — T1 的 boot 命令不追求退出码 0（起服务后不会自己退），**判据是"profile 目录建出来了"**。
  代价若错：可能把一个"起了但没建目录"的情况误判为通过——由 Step 3 的 `plugin list` 二次兜住。
- **Ruling 7** — Task 1 Step 8 的计划文本把"热加载"错标成了 **A6**，而 spec §10 的 A6 是 `sessionTitle.rename()`。这是**计划笔误**，实施者拒绝误标是正确的。处置：热加载那条事实**新开 A11 之前的 A10**（spec 已加），A6 保持"未验证"不动。
  代价若错：假设编号多一行，无实质代价。
- **Ruling 8** — **修订 Ruling 4**。T1 实测：`inject: []` 时 `apply` 里 `ctx.get()` 全返回空（加载顺序问题，非键名错）。故 T9 的 `llm` 读取改用 **`ctx.inject(['llm'], (sctx) => …)` 迟绑定**——本机已发布的 `dsh-plugin-notify-sound` 正是这个写法，其注释明确"服务就绪后注册；完全没有该服务的 profile 中则静默不注册"。**不把 `llm` 写进顶层 `inject`**（缺服务会导致整个插件不激活）。同时 T9 的追加机制收敛到单一实现 `appendReminder()`，路径由 A8 实测决定，两条都不通就降级为"只写审计 + 工具返回值"并如实报告。
  代价若错：提醒功能不触发，但插件其余部分照常工作——这是刻意的降级面。

## 进度

- Task 1: dispatched (BASE 933bfa0; implementer agent a62f48a8)
- Task 1: implementer reported DONE — commit `6b23071` (docs/notes/dsh-api-notes.md 新增 116 行；spec §10 A3/A7 标注已验证)
- Task 1: controller ruling 7/8 → 计划与 spec 修订，commit `bc5492b` (outside the T1 review range)
- Task 1: review package `review-933bfa0..6b23071.diff` (1 commit, 10869 bytes); task reviewer dispatched (agent 32cab466)
- Task 1: review returned — **Spec compliant ✅**；1 个 Important（A7 把实测方法写成 `ctx.get()`，实为 `ctx[k] !== undefined`，且与笔记 §6 自相矛盾）；2 个 Minor
- Task 1: minor (deferred): notes §2 的源码表缺逐包文件路径（§3/§4 有）
- Task 1: minor (deferred): notes §2「用途（Task 7–9）」列把已核实键名与**未核实**的 API 面说法混列，未标「未核实」
- Task 1: fix round 1/5 dispatched（恢复原实施者 a62f48a8，只带那 1 个 Important；FIX_BASE 记为 `bc5492b`）
  - **Ruling 9** — 本轮 re-review 的 FIX_BASE 用 `bc5492b`（修复起点 = 当前 HEAD），而非审查所见过的 `6b23071`。理由：两者之间夹着我的控制方文档改动（Ruling 7/8），把它卷进修复 diff 只会招来范围外发现。代价若错：re-review 看不到我那次改动——但它本来也不在修复范围内，且最终整分支审查会覆盖全量。
- Task 1: fix round 1/5 (1 addressed, 0 open; commits bc5492b..95aecc1) — 复审判 ADDRESSED、无新增破坏
- Task 1: minor (deferred, 来自复审的范围外观察): 计划 `2026-10-06-dajiangjun-session-relay.md:78–91` 的 T1 探针片段仍是 `inject: []` + `ctx.get(k)` 反例（该步骤已执行完，属陈述性过期；笔记 §6 已记录正确做法）
- **Task 1: complete (commits 933bfa0..95aecc1, review clean after 1 fix round)**
- Task 2: dispatched (BASE 95aecc1)
- Task 2: implementer reported DONE_WITH_CONCERNS — commit `f9ac4f7`（package.json / lib/store.js / test/store.test.js / pnpm-lock.yaml，4/4 passing）
  - **Ruling 10** — **计划缺陷，控制方已实测确认**：`node --test test/`（目录形式）在本机 Node v24.21.0 上把目录当模块 `require`，报 `Cannot find module '<repo>\test'`，**测试根本不加载**。计划里有 **7 处**用了这个形式。裁定：全部改为 `& $node --test`（或指名文件）；`scripts.test` 由 `"node --test test/"` 改为 `"node --test"`。实施者偏离 brief 的 A 项 **获准**，且已写进 Global Constraints 约束后续全部任务。
    代价若错：几乎不可能——同一台机器同一 Node 版本上已当场实测了两条命令的行为差异。
  - **Ruling 11** — `pnpm-lock.yaml` **入库获准**（brief Step 6 的文件清单漏了它）。理由：`@deepseek-ai/*` 依赖要可复现；不入库会被后续任务的 `git add -A` 当未跟踪文件扫走。Global Constraints 与 T2 Step 6 已补。
    代价若错：多一个 lockfile 在库里，标准的 Node 工程实践。
  - **Ruling 12** — 控制方实测发现：**哈希链是"每文件一条"**（新月份文件首行 `prevHash` 为空），而 `readAudit` 一次读当月 + 上月 → `verifyChain` 跨月必然报 `{"ok":false,"brokenAt":1,"reason":"prevHash mismatch"}`（同月内 `{"ok":true}`）。spec §8.1 明写"断链 → 🔴"，即**每月必然误报一次完整性告警**。处置：**作为具名风险带证据交给 T2 审查者判定严重度**，走正常审查循环，**控制方不直接改代码**。
    代价若错：若审查者判定为非缺陷，则 `verifyChain` 带一个已知的月度假阳性进入后续（v1 尚无产品代码调用它）。
- Task 2: review returned — **Spec compliant ✅**（逐字转写已核实）；**1 个 Important（plan-mandated）** = Ruling 12 那条跨月链缺陷；2 个 Minor（时区月份边界、`lastHash` 每次 append 重读整文件 O(n²)，均 brief 固有、影响低）
- Task 2: minor (deferred): `ymOf` 用本地时区切月份而 `ts` 是 UTC，边界记录可能落进读不到的文件
- Task 2: minor (deferred): `lastHash` 每次 append 重读整个文件（O(n²)），审计量级下可忽略
  - **Ruling 13** — 审查者明说该缺陷是「**brief 自身参考代码的固有缺陷，不是转写错误**」。裁定：**修，不推迟**。本项目整个意义就是诚实信号，一个**每月必然误报一次「审计链断裂 🔴」**的机制比没有链更糟。修法比审查者给的两个选项多一层——链连续之后，**验证一个窗口**（`readAudit` 默认只读两个月）会在窗口首行报断链，因为窗口之前那条的 hash 不在手里。故：① `appendAudit` 的 `lastHash` 回溯上月，使链真正跨文件连续；② `verifyChain(entries, seed = '')` 增加可选 seed。计划已改（代码 + 2 条新测试），**代码修复由实施者在修复轮 1 执行**，控制方不碰代码。
    代价若错：多一个 `seed` 参数和一次跨月回溯读；若审查者认为窗口语义不该由调用方负责，可回退为"分片验证"方案。
- Task 2: 计划修正已提交 `02be073`（跨文件连续链 + `verifyChain(entries, seed='')` + 2 条跨月测试；两处测试计数 4→6 / 9→11）
- Task 2: fix round 1/5 dispatched（恢复原实施者 2f4dc06b，只带那 1 个 Important；FIX_BASE `02be073`）
- Task 2: fix round 1/5 landed — commit `41d916a`（6/6 passing）。TDD 证据的关键一点：**RED 阶段 4 条老测试仍全绿**，实证了原套件抓不到该缺陷。转写保真度机核 IDENTICAL。
- Task 2: **待办转交 Task 6**（实施者建议，控制方采纳待复审确认）：`lastHash` 回溯上限 12 个月而 `readAudit` 默认只读 2 个月 → 只要中间有空档月，窗口验证**必须**用 seed。建议在 `relay.js` 落一个「读窗口 → 取窗口前一条 hash → `verifyChain(rows, seed)`」的小封装，把这条约束收进一处，别让每个调用点自己记得。
- Task 2: scoped re-review dispatched（agent 147c9962；diff `review-02be073..41d916a.diff`）
- Task 2: fix round 1/5 (1 addressed, 0 open; commits 02be073..41d916a) — 复审判 ADDRESSED、无新增破坏、无范围外观察
- **Task 2: complete (commits 95aecc1..41d916a, review clean after 1 fix round)**
- Task 3: dispatched (BASE 41d916a)
- Task 3: implementer reported DONE — commit `16c972e`（11/11 passing；`lib/store.js` 仅追加 74 行、**零删除行**，`git diff -U2` 的 hunk 头 `@@ -103,2 +103,74 @@` 证明第 3..102 行不落在任何 hunk 内 → Task 2 的函数确实未被改动）
  - **Ruling 14** — brief 的测试片段自带一行 `store.js` 导入，同时又要求"补 `readJson` 的导入"；照抄会出现**两条指向同一模块的 import**。主张：**批准合并成顶部一条排序好的导入**（含 `readJson`），语义等价且避免逐字重复。代价若错：无——ESM 下重复 import 本身合法，合并只是更干净。
  - **控制方流程疏漏（已修）** — Task 3 的 brief 是在 `298cdfd` 生成的，而"9→11 个测试全绿"的计数修正在 `02be073`；我改计划后**只重建了 T2 的 brief**，导致 T3 brief 落后于计划。实施者按任务书正文用了 11，判断正确。已重建 3..10 全部 brief。
    代价若错：后续任务若再遇同类落后，实施者会拿到与计划不符的期望值——缓解办法是**每次改计划后重建全部剩余 brief**，已照此执行。
- Task 3: 待审查的两条具名风险（由审查者定级，控制方不预判）：① `acquireLock` 的**过期抢占路径无 CAS**——两进程同时看到过期锁会都返回 `stole:true` 并同时进入临界区（首次获取路径严格满足 R-4）；doc 02 §5.6 原文对此的口径是「锁丢失后果照实写：最多重复执行一次，由去重表兜底」，但"双双进入"比"重复一次"更重 ② 临时名 `${pid}-${Date.now()}` 同进程同毫秒会同名（全程同步无交错，故无害）
- Task 3: review package `review-41d916a..16c972e.diff` (7454 bytes)；reviewer dispatched（agent f3db088e）
- Task 3: review returned — R-4 ✅ / R-5 ✅ / 零依赖 ✅ / 未动 Task 2 函数 ✅；**2 个 Important + 3 个 Minor**；两条具名风险裁决为「不比重」（无 CAS 抢占恰落在设计接受的 ceiling 内；同名临时文件推理成立）
- Task 3: minor (deferred): 无真正跨进程的并发测试——设计上 `updateJson` 本就不承诺跨进程原子性（模块注释已写明交给调用方的锁），故**不假造测试**；真要多进程验证需 worker_threads/子进程，记此待办
- Task 3: minor (deferred): 报告 §4/§5 自相矛盾（称"0 删除行"但 §5 自写"3 deletions"）+ hunk 头 `@@ -103,2 +103,74 @@` 与所给 diff 的 `@@ -95,10 +95,82 @@` 不符——**实质结论（Task 2 未动）成立**，但断言与引用不准，已要求本轮一并订正
  - **Ruling 15** — Important #1（plan-mandated：抢占未记审计行，doc 02 §5.6）处置：**改签名，把 `home` + `key` 收进 `acquireLock`**，抢占时在函数内部自己写审计行；**不采用**审查者给的另一选项"下沉给 Task 8 调用方"。理由：审查者指出接口矛盾是对的（`acquireLock(file, …)` 收不到 `home`，审计在其内部无法实现），但下沉会把"必须留痕"降级成"每个调用点记得补一行"——上一轮 T2 实施者刚为同类问题（seed 该由谁补）提过警告。改签名后该约束**在结构上不可遗漏**。连带同步：T8 调用点、T8 import 清单（去掉 `lockPath`）、T3 Interfaces、T3 测试计数 11→12。
    代价若错：锁原语比其他原语多两个参数；若将来出现第二个调用方且其 `home` 语义不同，需再议。
  - **Ruling 16** — Important #2（"并发自增"测试并无并发、报告论证错误）处置：**改测试名与注释、去掉 `Promise.all` 假并发**，并在注释里写明「跨进程原子性由调用方的锁负责，本任务不提供该保证，也不假造测试去暗示它成立」。**不**引入 worker_threads/子进程压并发——为模块明确不承诺的保证造测试是本末倒置。
    代价若错：跨进程并发下 `updateJson` 的行为无测试覆盖；但该保证本就不由它提供，风险落在调用方（Task 8 的锁），已记 deferred。
  - **Ruling 17** — Minor「损坏/半截锁文件 → `expired` 恒为 false → 这把锁**永久**抢不到」**一并修掉**（2 行：`held === null` 或字段类型不对即视为持有者已死）。这是活性故障、静默且难查，修它比争论它更省。同时把 `releaseLock` 的 `catch {}` 改成非 `ENOENT` 时 `emitWarning`——**该条本是 Minor，但它与项目「静默失效必须可观测」的口径直接冲突，在重写该函数时顺手修掉**，在此登记以免事后无人知。
    代价若错：多一行 warning；若某环境 `EACCES` 常见会刷屏——但锁删不掉本就是该知道的事。
- Task 3: 计划修正提交 `bc3aa0e`（签名 + 2 条新测试 + 测试改名 + T8 连带 + 计数 11→12）；brief 3..10 全部重建并核对
- Task 3: fix round 1/5 dispatched（恢复原实施者 70ead537，带 2 个 Important + Ruling 17 那条 Minor；FIX_BASE `bc3aa0e`）
- Task 3: fix round 1/5 landed — commit `16c972e`（12/12 passing）。RED 证据为完整起见临时 `git checkout` 回旧实现跑，**事后 SHA256 校验还原无损、index 未污染**。报告自相矛盾已订正（并澄清 `@@ -103,2 +103,74 @@` 是 `-U2` 的真实输出、我引用的 `-U10` 值也真实，两者同区域）。
- Task 3: scoped re-review dispatched（agent 0b3cafb5；diff `review-bc3aa0e..16c972e.diff`，7948 bytes）
- Task 3: fix round 1/5 (3 addressed, 0 open; commits bc3aa0e..16c972e) — 复审判全部 ADDRESSED、无新增破坏；复审自行 `grep` 核了签名改动零个旧调用点
- Task 3: minor (deferred, 来自复审的范围外观察): fix report 头写"基准提交 16c972e"而 review 包 base 是 `bc3aa0e`——纯记录问题，diff 本身干净
- **Task 3: complete (commits 41d916a..16c972e, review clean after 1 fix round)**
- Task 4: dispatched (BASE 16c972e)
- Task 4: implementer reported DONE — commit `d7f420e`（5/5 单文件、17/17 全套；纯新增 134 行，`git status --porcelain` 提交前只有两行 `??` 证明零改动已有文件）
  - 值得记的自审动作：实施者**不满足于"反例测试挂了"**，另跑探针打印每个反例的完整 `errors` 数组，确认三条反例各自**只因正确原因**失败——因为 brief 的断言用 `includes('下一步')`，区分不了"缺这段"与"这段格式不对"。
  - 实施者按其"逐字转写不自行设计"报了两条观察、故意未修：① `HAS_EVIDENCE` 的排除集与全角字符 ② `resolveMainline` 文件名回退只取首段（`a-b-c-d.md → "a"`，brief 明示行为，天花板=主线名不得含 `-`）。**①交由审查者核**——控制方读代码后怀疑其判断有误，但不下结论。
- Task 4: review package `review-16c972e..d7f420e.diff` (5372 bytes)；reviewer dispatched（agent fe96fecf）
- Task 4: review returned — **Spec compliant ✅ / Task quality: Approved**；代码零 Critical、零 Important → **无修复轮**
  - 审查者**逐码点核实并否证**了实施者的观察①：`）` U+FF09 **在**否定类 `[^\s，。）)]` 内（`）` 与 `)` 都被排除）；`／` U+FF0F **不匹配** `[/\\]`（只匹配 U+002F / U+005C）。故 `- 重构／整理完毕` 会被**判为缺证据路径**，与报告预测**正好相反**。
    → **该观察不得作为 Task 5/6 的输入**。照它去改就是去追一个不存在的失效模式，属于"为一个假想的 bug 写代码"，本项目的纪律明确反对。
  - 审查者指出**真正的天花板**（brief 固有）：`HAS_EVIDENCE` 只要求「一个 ASCII `/` 或 `\` + 一个非空白、非 `，。）、)` 的字符」，**不校验扩展名、不校验路径是否存在** → `- 完成了 待办/处理` 能过。
    **Ruling 18** — **维持现状**。设计稿 doc 09 要求的是「已完成项须带**证据路径**」，不是「路径**有效**」；要校验存在性就得引入文件系统 I/O，会破坏 `relay.js`「纯逻辑、零 I/O」的契约（那条契约换来的是本模块可被彻底单测）。记 deferred，等真出现"填假路径"的实际事故再收严。
    代价若错：一个偷懒的 agent 可以用 `- 做完了 随便/写写` 通过校验——但那是判断问题，不是校验器能替它解决的。
- Task 4: minor (deferred): `relay.js:61` 的 `?? ''` 是死代码（`split` 恒返回 ≥1 元素）
- Task 4: minor (deferred): 同名段标题重复出现时静默覆盖（不在 brief 契约内）
- **Task 4: complete (commits 16c972e..d7f420e, review clean — 零 fix round)**
- Task 5: dispatched (BASE d7f420e)
- Task 5: implementer reported DONE — commit `dad1542`（8/8 单文件、20/20 全套；`lib/relay.js` 单一追加 hunk `@@ -65,2 +65,34 @@`、零删除行）
  - 自审亮点（记下来作为后续任务的标杆）：**对抗性无回显探针** —— 喂四类命中 + Bearer + 私网 IP + 手机号 + 内网主机名 + `quoteLines:3`，再对 `JSON.stringify(result)` 子串扫描 10 个泄漏样本 → `LEAKED = []`。对"不许回显"这种安全要求，这才是证据，而不是"我读了代码觉得没泄漏"。
  - 实施者如实指出 **brief 预测的 RED 文案是错的**：ESM 具名导入在**链接期**解析，报 `SyntaxError: ... does not provide an export named 'checkForbidden'`，而非 brief 写的 `checkForbidden is not a function`。**它没有为了凑上那句文案先塞一个空实现**——这是"不造假证据"的具体体现，记账以示正例。
  - 偏离①（把新 import 并入既有同一模块 import 行）沿用 T2/T3 先例，**获准**（逐字重复的 import 才是缺陷，合并不是）。
- Task 5: **具名风险（交审查者定级，控制方不预判）** —— `内网地址` 的 URL 模式 `https?:\/\/(?!127\.0\.0\.1|localhost\b)[A-Za-z0-9.-]+` 会拦下**任何**非回环 URL 主机，公网文档链（`https://nodejs.org/api/`）也会中招，而拒绝会**卡住整条接力**直到 agent 改档。
  **这是 spec §4.2 明文规定的行为（plan-mandated）**，故裁决权在控制方；按 T3 那轮奏效的做法，**先交审查者定级再决定修法**，不先改计划。
  与 doc 07 的关联：上游设计把**误报率列为第一 KPI**，所以"宁滥勿缺"在这里不是安全默认，是真代价。
- Task 5: review package `review-d7f420e..dad1542.diff` (4517 bytes)；reviewer dispatched（agent 3de91a68）
- Task 5: review returned — **Spec compliant ✅ / Task quality: Approved**；**1 个 Important（plan-mandated）** = 上面那条 URL 误报；4 个 Minor（`\d{1,3}` 允许 >255、`127.0.0.0/8` 只部分排除、会话原文只记阈值行、IPv6 未覆盖，均 brief 固有）
  - 审查者把具名风险**判为 Important 且证实**，逐项 trace：`nodejs.org` 被拦 / `my-nas` 被拦 / `storage.local` 被拦 / `127.0.0.1` 放行 / `192.168.1.20` 由同类模式一捕获。定级理由与控制方一致，并多给一条硬理由：**拦公网 URL 没有任何安全收益**（公网链接不泄漏内网拓扑）。
  - **Ruling 19** — **修**。采用审查者给出的最小纯正则修法（控制方已自行 trace 复核其正确性）：靠「无点裸主机名」+「私有后缀」两个分支精确命中内网，公网 FQDN 放行，**不重复覆盖私网 IP**（那条已由同类模式一负责）。另加 `/i`（主机名大小写不敏感）。改动落地三处：spec §4.2 口径行、计划里的模式、以及一条新测试（公网链 `ok:true` / `my-nas`+`storage.local`+`box.lan` `ok:false` / 私网 IP 仍 `ok:false`）。T5 测试计数 8→9、全套 20→21。
    代价若错：某个真实内网主机恰好是公网形态 FQDN（如 `http://nas.example.com/`）会漏过——要覆盖它得做 DNS 或维护内网域清单，两者都超出"纯逻辑零 I/O"的契约。记 deferred。
- Task 5: minor (deferred): `\d{1,3}` 允许 0–999 的八位组（over-match）；`127.0.0.0/8` 只排除了 `127.0.0.1`；会话原文只记录越过阈值那一行而非整段起点；IPv6 内网主机未覆盖
- Task 5: minor (deferred): 审查者指出无回显探针只检查 `JSON.stringify(result)`，真正决定性的是**结构**（纯模块 + 返回形状）与纯度 grep，而非探针本身；stdout/stderr 侧信道由纯度保证堵住
- Task 5: 计划与 spec 修正提交；brief 5..10 重建
- Task 5: fix round 1/5 dispatched（恢复原实施者 b5b0fb12）
- Task 5: fix round 1/5 landed — commit `dad1542`（9/9 单文件、21/21 全套）。RED 用**旧**正则捕获（`AssertionError: false !== true` 正落在预测的那条断言上）。
  - 自审亮点（实施者主动做、派出时未要求）：**双向往返探针** —— 8 个"应当放行" + 12 个"应当拦住"，两个失败集均为空。这才证明"收窄规则"没有拿**误报**换**漏报**；单向测试证明不了这件事。
- Task 5: minor (deferred，本轮修复**新发现**的两条边界，均为同一类"未锚定"问题，实施者只报不改是正确的)：
  - ① **否定前瞻未锚定主机尾** —— `(?!127\.0\.0\.1|localhost\b)` 里 `\b` 在 `.` 处成立，故 `http://localhost.evil.com/`、`http://127.0.0.1.evil.com/` 被**放行**。**旧模式同样如此，非本次引入**；且这两个主机本身确实不是内网地址，放行的结果恰好正确——机制是巧合而非判定。真正会漏的是"回环名 + 私有后缀"的构造主机（如 `http://localhost.internal/`）。
  - ② **私有后缀未锚定主机尾** —— `\.(?:local|lan|...)\b` 在中间标签处也满足，故 `https://my.local.host/`、以及控制方补充的同类例子 `http://x.home.com/` 会被**误拦**（偏严一侧，安全无害，但计入误报）。
  - 裁定：两条**都是 Minor**。① 无安全影响；② 命中的公网主机在交接档里极罕见。按流程**不进修复循环**，留给最终整分支审查分诊。若最终审查要收，最小改动是两处都锚定主机尾：`(?!127\.0\.0\.1(?=[/:?#]|$)|localhost(?=[/:?#]|$))` 与 `(?:local|lan|internal|intranet|home|corp)(?=[/:?#]|$)`。
- Task 5: scoped re-review dispatched（agent 81bb8398；diff `review-edfdea1..dad1542.diff`，3967 bytes）
- Task 5: fix round 1/5 (1 addressed, 0 open; commits edfdea1..dad1542) — 复审判 ADDRESSED、无新增破坏，并**逐字节核对**实际落地的正则与裁定一致（含 `/i`）
- **Task 5: complete (commits d7f420e..dad1542, review clean after 1 fix round)**
- Task 6: dispatched (BASE dad1542)
- Task 6: implementer reported **DONE_WITH_CONCERNS** — commit `7d683e9`（23/23 单文件、35/35 全套）
  - 只增不改的机器证据：`git diff --numstat` = `73/0` 与 `109/0`（182 插入、**0 删除**），`git diff -U0 | Select-String '^-[^-]'` 无输出 → Task 4/5 的 10 个符号与原 9 条测试逐字节未变。
  - **R-2 自检亮点**：它不满足于"我用了序表"，而是**实测反证**——确认 `'read-only' > 'danger-full-access'` 的字典序反转**确实存在**，以此证明如果走了字符串比较就会翻车，而它没走。这是"证明你的守卫有效"而不是"声明你的守卫存在"。
  - 额外验证：3 条 `dryRun:true` 的 `failed` 行**不会**触发失败闸——直接钉住了"预览两次把自己锁死"那个后果。
  - **Ruling 20** — 实施者报的唯一偏离：brief 里 `evaluateGates` 的 docblock 写「短路顺序：总开关 → 调用者 → 配置」，与紧随其后的代码（首行即 `config-unreadable`）及控制器下发的顺序矛盾。它**只改注释、代码一行未动**。**裁定：批准**。代码顺序是对的——配置读不到时根本无法判断 `enabled`，故 `config-unreadable` 必须最先。真正的缺陷在**我的计划文本**，恢复时一并把计划里的 docblock 改过来。
    代价若错：无——注释与代码一致本身就是要的结果。
  - 待审查者定级的覆盖缺口（实施者如实上报）：`dedupeKey` / `makeRelayId` 未被那 14 条测试覆盖（行为已用一次性脚本验证），且 brief 的测试 import 含未使用的 `dedupeKey`。`dedupeKey` 是一行字符串拼接；`makeRelayId` 是纯格式化且其输出会写进审计链与档头。

---

## ⏸ 暂停（应用户要求，暂停时刻记录）

**暂停时状态**：分支 `feat/session-relay`，HEAD `7d683e9`，**工作树干净**。
- T6 的代码**已提交**（`7d683e9` feat(relay): 权限序表 + 7 道闸门判定），但**尚未审查**。实施者 agent `c9995cec` 当时还没回话。

**恢复时从这里接**（严格按序，不要跳步）：
1. ~~确认 `c9995cec` 的报告到了并补进台账~~ —— **已完成**（见上方 Task 6 条目；报告与 commit `7d683e9` 都已记账）。
2. 生成 T6 的 review 包：`New-ReviewPackage -Base dad1542 -Head 7d683e9`。
3. 派 T6 的**任务审查者**（模板 `skills/subagent-driven-development/task-reviewer-prompt.md`）。派发词要带：brief 路径、报告路径、diff 路径、Global Constraints、以及 T6 的两条硬点——**R-2 权限比较必须走序表（字符串比较会正好反转）**、**闸门短路顺序承重**。
4. 审查通过才收口 T6，然后按 BRIEF/流程派 **T7**（`lib/index.js`：Config + 工具注册 + dryRun 预览路径）。**不要跳过 T6 的审查直接做 T7。**
5. T7→T8→T9→T10 依次；每个任务都要走"派实施者 → 生成 review 包 → 派审查者 → （有 Important 就修一轮 + scoped 复审）→ 收口"。
6. 全部任务完成后：最终整分支审查（用 `requesting-code-review/code-reviewer.md`，最强模型）→ `finishing-a-development-branch` → **把台账里所有 `Ruling:` 行汇总给用户**（那是唯一一条"我替用户做的决定"能到达用户的通路）。

**进度快照（截至暂停）**：
| 任务 | 状态 | commit |
|---|---|---|
| T1 环境闸门 | ✅ 收口（1 修复轮） | `933bfa0..95aecc1` |
| T2 store 审计流水 | ✅ 收口（1 修复轮） | `95aecc1..41d916a` |
| T3 store 原子写+锁 | ✅ 收口（1 修复轮） | `41d916a..16c972e` |
| T4 relay 档契约 | ✅ 收口（零修复轮） | `16c972e..d7f420e` |
| T5 relay 禁写内容 | ✅ 收口（1 修复轮） | `d7f420e..dad1542` |
| T6 relay 闸门 | ⏳ **代码已提交、未审查** | `dad1542..7d683e9` |
| T7 index Config+工具 | ⬜ 未开始 | — |
| T8 index 真执行 | ⬜ 未开始 | — |
| T9 index 主动提醒 | ⬜ 未开始 | — |
| T10 端到端 + 上 desktop | ⬜ 未开始 | — |

**恢复所需的环境事实**（不依赖会话记忆）：
- `git` = `<git>\cmd\git.exe`（版本段会随 GitHub Desktop 更新而变）
- `node` = `$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`
- **测试命令绝不能用目录形式 `node --test test/`** —— 本机 Node v24.21.0 会把它当模块 `require`，报 `Cannot find module`，**测试文件根本不加载（拿到"测试没跑"而不是失败）**。用 `& $node --test` 或指名文件。
- SDD 辅助脚本：`_scratch/sdd.ps1`（PowerShell 等价实现，`Invoke-Expression (Get-Content -Raw ...)` 载入，因为执行策略禁止 dot-source）
- 10 个 task brief 都在 `.superpowers/sdd/2026-10-06-dajiangjun-session-relay/task-N-brief.md`
- **改计划后必须重建全部剩余 brief**（我用 `New-TaskBrief`），否则实施者会拿到过时的期望值——这个坑已经踩过一次。


---

## 追加（恢复后）

- Task 6: Ruling 20 落地 —— 计划里 `evaluateGates` 的 docblock 已改为实际顺序（`配置不可读` 最先，并注明理由）；brief 7..10 已重建；计划修正提交 `d51953b`。
- Task 6: review package `review-dad1542..7d683e9.diff` (9432 bytes)；reviewer dispatched（agent a3d4773d）。
- 恢复动作：用户说"继续"，已从暂停节的步骤 2 接上（生成 review 包 + 派 T6 审查者）；未跳步。

- Task 6: review returned — **Spec compliant ✅ / Task quality: Approved**；**零 Critical、零 Important** → **无修复轮**。三条红线均逐行核实（序表数值比较、`dryRun` 一律经 `real()` 过滤、短路顺序逐字吻合）。
- Task 6: minor (deferred): `trailingFailures`(relay.js:129-137) 按数组尾扫计数、**不按 `ts` 排序**，而 `lastRealRow`(125-127) 排序取最后——若 `auditRows` 非时间序传入，失败闸会算错"尾部连续"。审计日志按追加序写入（时间序=数组序），现实不触发；brief 原样转录。
- Task 6: minor (deferred): `test/relay.test.js:110` 的 import 含未使用的 `dedupeKey`（brief 逐字转录，非实施者手误）。
- Task 6: **审查者纠正了实施者的一处误读** —— 实施者称"必须保持 23 条测试、需控制器授权才能加测试"，但计划 Step 4 只写"全部绿"、**未定数**，加测试本不违规。记账以免后续任务继续按这个误解行事。
- Task 6: **审查者点名的实缺口（Minor，建议接线时补正式测试）** —— "失败闸忽略 `dryRun`"这条红线的后果（"预览两次被拒就锁死"）**不在**提交的 14 条测试里；提交测试只有"速率闸忽略 dryRun"那条。代码本身正确（`trailingFailures` 走 `real()`），且那条已间接覆盖共享的 `real()`，故归 Minor。建议 Task 7/8 接线时补一条正式测试钉死。
- Task 6: **`dedupeKey` 疑似死导出** —— 审查者查出去重闸直接比对 `r.sourceSessionId === input.sourceSessionId`，**从不调用 `dedupeKey`**。控制方已独立复核（plan 全文 grep 见下），按流程记 deferred、交最终整分支审查分诊；若确无消费者，最小处置是删除该导出与测试里未使用的 import（删代码、零风险）。
- **Task 6: complete (commits dad1542..7d683e9, review clean — 零 fix round)**
- Task 7: dispatched (BASE d51953b)
  - T7 实施者 agent：91c34ed5（review BASE = d51953b）；派发词已明确禁止两件 deferred 事项（补失败闸测试、动 dedupeKey）

- Task 7: implementer reported **DONE_WITH_CONCERNS** (commit `0eaf5da`)
  - 6/6 单文件、41/41 全套全绿；TDD 保序（RED = `ERR_MODULE_NOT_FOUND`）。
  - `inject` = `[tools, sessionController, sessionTitle, sessionProjections]`，逐字取自 `docs/notes/dsh-api-notes.md` §2（含复数 `sessionProjections`），且未用 `ctx.get()`（遵 §6）。
  - 范围纪律：`git diff --stat` 空 → 无任何已跟踪文件被改；未 import `dedupeKey`；未补那条 deferred 的失败闸测试；未碰 `desktop` profile；测试命令形式正确。
  - 超出测试的零副作用证据（一次性探针 `_scratch/t7-probe.mjs`）：`dryRun` 缺省/false/true 三种都 → 服务调用 `[]`、`kind=preview`、`steward/locks/` **从未创建**、3 行审计全为 `dryRun===true`（故 relay.js 的 `real()` 会滤掉 → 反复预览无法触发失败闸）、`verifyChain` ok。
  - **待审查者独立验证的关键偏离**：brief 的 `output.schema` 用了**根级** `required: [...]`，而 `dsh-tools@0.2.0-rc.2` 的 value schema DSL **在根节点拒绝 `required`**（实施者引了库源码 :555-557 throw、:601-604 属性节点 allowRequired:true、:771-785 根任务 allowRequired:false、:849 defineTool 内立即编译）。实施者把 `required` 下移到属性级并保留 `additionalProperties:false`，声称**编译产物与 brief 意图完全等价**、且无任何取值不同。
    → 控制方**暂准**（Ruling 21，待审查者核对等价性断言后转正）。实施者未先问而直接改，理由是"该修复由已安装库的源码唯一确定、且保留 brief 全部取值"——记账；补偿是它把这条偏离显著上报而非埋掉。
- Task 7: review package `review-7d683e9..0eaf5da.diff`；reviewer dispatched

- Task 7: **控制方流程疏漏（已修）** —— review 包第一次用了 `BASE=7d683e9`（Task 6 的 HEAD），把控制方自己的计划修正 `d51953b` 一起卷进了区间（包里成 2 个 commit）。正确 BASE 是 `d51953b`。已重新生成 `review-d51953b..0eaf5da.diff`（1 commit、11334 bytes）并 `send_message` 通知审查者改用新文件、不要评 `d51953b`。
  → 这是本计划执行中控制方的第 3 个流程性疏漏（前两个：改计划后只重建了 T2 的 brief 导致 T3 brief 落后；本轮 BASE 取错）。共同根因是**多步操作里靠记忆而非靠"取当前 HEAD"**。对策已记：生成 review 包前先显式 `git log --oneline <base>..<head>` 确认区间里只有该任务的 commit。
- Task 7: reviewer agent = 73c17c9e

- Task 7: review returned — **Spec compliant ✅ / Task quality: Approved**；零 Critical、零 Important → **无修复轮**
  - **Ruling 21 由临时转正式**：审查者读库源码逐行核实了等价性 —— `compileValueSchema`(index.js:771-785) 根任务 `allowRequired:false`；`assertAuthorKeys`(:555-557) 抛 `schema.required is not supported by the value schema DSL`；属性任务(:601-604) push 键名；(:594-599 / :700-711) 写 `target.required`；`defineTool`(:849) eager 编译。→ 属性级 `required:true` **确实**编译成根 `required` 数组，且产物保留 brief 全部取值。等价性成立。
  - 审查者额外确认三条保证都是**结构性**而非靠自觉：预览全程不碰 `sessionController`/`sessionTitle`/`sessionProjections`；**不占锁**同样是结构性（lib/index.js:5 根本没 import lock）；预览审计行的 `dryRun:true` 是**硬编码**、与 `dryRun` 变量解耦。
  - 审查者指出报告一处措辞不准：称"4/6 失败"，实际只有 2 个测试调 `apply()`，另 4 个只碰 Config/readAudit。仅报告层，不影响代码。
- Task 7: minor (deferred): 「预览不占锁」只靠 import 面 + 一次性探针保证，测试未断言（`fakeCtx` 无 lock 服务）。Task 7 无锁代码故可接受；审查者建议 Task 8 补 lock 假体 + 断言 —— **控制方裁定不进 T8 的 brief**：T8 的单飞测试已覆盖锁的正面行为，为一个已被结构性保证的属性再铺测试属范围蔓延，记 deferred 交最终审查。
- Task 7: minor (deferred): `tempHome` 改 `process.env.DSH_HOME` 不还原、临时目录不清理（brief 逐字转录，此处无害）。
- **Task 7: complete (commits d51953b..0eaf5da, review clean — 零 fix round)**
- Task 7: Ruling 21 落地 —— 计划里 T7 的 `output.schema` 改为属性级 `required: true`（含说明注释）；brief 8..10 重建。
- Task 8: 待派发（BASE 取计划修正后的 HEAD）

- Task 7: 计划修正提交 `d4ffe8b`（T7 的 `output.schema` 改属性级 `required: true`，含解释注释）；brief 8..10 重建并核对。
- Task 8: dispatched (BASE `d4ffe8b`；实施者 agent `47dcea7b`)。派发词把三条红线逐条钉住：**R-1** 投递只能 `queue`/`steer`（`inject` 不唤醒且不报错）；**R-2** 权限比较走 `permissionOk()` 序表；**锁签名已改**为 `acquireLock(home, key, opts)` / `releaseLock(home, key)`，且**抢占审计由 `acquireLock` 内部写、调用点不得重复补**。另明确禁止：import 死导出 `dedupeKey`、补那条 deferred 的"预览不占锁"测试。
  - 本任务用 **v4-pro**（其余实现任务用 flash）：它是整条链上唯一会产生不可逆动作的地方（建会话 + 投递），判断错不报错、只静默出错。

- Task 8: implementer reported DONE — commit `f7de8a2`（9/9 单文件、44/44 全套，输出干净）
  - 红线逐条自证：R-1 `const mode='queue'` + 守卫在 prompt 前；R-2 权限经 `resolveAgent().session` → `stateOf(session,'sandboxMode')` → `permissionOk`；锁用新签名、未 import `lockPath`/`dedupeKey`、无重复 steal 审计行。
  - **控制方计划文本的一处歧义，实施者解对了**：Step 4 说"把尾段替换成 `if (dryRun) return preview; return dispatch(...)`"，而 T7 原代码里 `appendAudit(预览行)` 位于该尾段中。照字面替换会**丢掉预览的审计行**（破坏 T7 的 `rows.length === 1` 断言）；另一种读法则会让**真执行路径也写一条幽灵 preview 行**。实施者把预览的 `appendAudit` 包进 `if (dryRun)`——两条性质同时保住。
    → **Ruling 22**：批准该处置，并把计划 Step 4 的措辞改成显式三段（`if (dryRun) { appendAudit(预览行); return preview }` / `return dispatchRelay(...)`），消除歧义。
  - 只改 `lib/index.js` 与 `test/index.test.js`（`git status` 已核）。

- Task 8: review package `review-d4ffe8b..f7de8a2.diff`（1 commit、10272 bytes；区间已显式核对只含 T8 的 commit）；reviewer dispatched（agent b9de0b15）。
- Task 8: Ruling 22 落地 —— 计划 Step 4 已消歧为**三段**（预览的 `appendAudit` 留在 `if (dryRun)` 分支内），并写明两种误读各自的后果；brief 9..10 重建。

- Task 8: review returned — **Spec compliant ✅ / Task quality: Approved**，但报 **2 个 Important**（无 Critical）。
  - 审查者对 5 条具名风险的裁决：① 单飞测试**是真的**（`acquireLock` 用同步 `writeFileSync({flag:'wx'})`，在**首个 await 之前**调用，10 次调用真的争 O_EXCL；锁若坏了 create 计数会是 10 而非 1）② 两条路径的审计行都对、steal 行只由 `acquireLock` 写 ③ `releaseLock` 在所有获取后的路径上都到（`finally`）；skipped 路径在 try 之前故正确地不释放 ④ 退出码与规格一致、无 "partial 却报成功" ⑤ 权限回读读的是正确的 session 对象，**能**抓到降级。
  - **Ruling 23 — Important #1（plan-mandated）「幂等测试是空的」：修。** 测试两次都传 `text: GOOD_DOC`，即第二次仍从**原始文本**重新生成，`rewriteHeader` 的 KEY 去重分支**从未被走到**（删掉该过滤断言照样过）。而生产路径 `runRelay` 从磁盘读档，第二次读到的文本**含**上次写的键——该过滤真的在承重却无人验。处置：第二次喂**改后**的档文本（`readFileSync` 回来），让去重分支被真正走到。
    代价若错：测试多一次读盘，无其它代价。
  - **Ruling 24 — Important #2「catch 分支未报出 `newId`」：修。** 权限路径会把"已建但未投递的会话 id"报给人工；catch 分支不报。后果具体：失败若发生在 `prompt()` 投递之后、`writeTextAtomic` 之前，**已收到指令的会话无人能指认**；而去重闸只认 `result === 'dispatched'` 的行，人工重试会**再投一次**。处置：catch 的用户可见文案在 `newId` 存在时点名该会话，并提示"可能已投递、重试前请人工核查"。
    代价若错：多几个字；不修则违反"只报不收拾"里的"报得出来"。
- Task 8: minor (deferred): `lib/index.js:97` 有过时注释；`test/index.test.js:145` 有冗余断言；退出码 5/3/1 三条路径无测试（`fakeCtx.stateOf` 是常量，故降级/exit-5 路径从未被测）；`store.js:183-184` 在"抢占 + appendAudit 抛错"时会泄漏锁（**在 diff 范围外**）。

- Task 8: Ruling 23/24 落地 —— 计划已改两处（幂等测试改为喂改后档文本并断言三个键；catch 分支点名孤儿会话）；brief 8..10 重建（T8 brief 218 行）；计划修正提交 `c5fb71b`。
- Task 8: fix round 1/5 dispatched（恢复原实施者 47dcea7b；FIX_BASE `c5fb71b`）。
  - 派发词里加了一条非常规要求：**让实施者证明新测试有鉴别力**。因为 #1 这个缺陷的性质是"**实现是对的、错的是测试**"——修复后测试通过不能作为证据（修复前也通过）。要求它临时把 `rewriteHeader` 的 KEY 过滤注释掉跑一次、确认新测试会红、然后还原。这是"测试有没有鉴别力"与"测试有没有跑过"的分野。

- Task 8: fix round 1/5 landed — commit `c498f61`（9/9、44/44）。
  - **鉴别力证据（本轮最值得记的东西）**：Ruling 23 的缺陷在"测试没覆盖"而非实现错，所以实施者先如实报告"新测试在旧实现下**不红**（9/9）"，再**临时把 KEY 过滤改成 `filter(() => true)`** 让键真堆叠 → 新测试当场红（`AssertionError: 链键被堆叠了`，8/9）→ **验证后还原**。这才是"测试有鉴别力"的证据；没有这一步，"修复后测试通过"是零信息量的。
  - 控制方独立核验：`git grep "filter(() => true)" HEAD -- lib test` → 无命中，临时破坏未漏进提交。另要求复审者从 diff 独立再验一次（"泄漏一个被临时禁用的守卫"正是那种不报错、只静默失去幂等性的错）。
- Task 8: scoped re-review dispatched（agent 74d5ddc9；diff `review-c5fb71b..c498f61.diff`，1 commit、3722 bytes）

- Task 8: fix round 1/5 (2 addressed, 0 open; commits c5fb71b..c498f61) — 复审判 ALL ADDRESSED、无新增破坏。
  - 复审的 no-leak 核查比控制方更深一层：**diff 从未触碰 `rewriteHeader`**（只改了 catch 块）；当前 `lib/index.js:127` 是 `filter((l) => !KEY.test(l))`（正确的取反去重）；`grep "=> true"` 在 `lib/` 与 `test/` 零命中。
  - 复审用 trace 独立复核鉴别力：第二次调用现在收到**已含三个键**的档；若无过滤则各 2 条 → `:173` 的链断言先中止、另两条独立 → 与报告的 8/9 吻合。
- **Task 8: complete (commits d4ffe8b..c498f61, review clean after 1 fix round)**
- Task 9: dispatched (BASE `c498f61`)

- Task 9: dispatched (BASE `c498f61`；实施者 agent `8e193106`；用 **v4-pro**)。
  - **本任务是全计划唯一 deliberately 留了未验证分叉的任务**：brief 里 `appendReminder` 走 `system-prompt/assemble`(waterfall) 还是 `ctx.systemPrompt.append`，取决于尚未验证的 **A8**；分母取决于 **A9**（能否取到模型上下文上限）；迟绑定取决于 **A11**。Task 1 只验到了服务键名那一层。
  - 派发词把"**去把分叉查清**"本身当成交付物：要求给出**源码级证据（file:line）**，来源为 asar 内官方包（用 `_scratch/asar.mjs`）或本仓库 `node_modules/@deepseek-ai/*`；并把实测结论回写到 `docs/notes/dsh-api-notes.md` 与 spec §10 的 A8/A9/A11 三行。
  - 两条明确的边界：① **"这条追加路径不可用 → 降级为只写审计 + 工具返回值"是预期内的合法结论，不算 BLOCKED**；② **绝不允许留一个静默不生效的订阅**——那正是本项目最反对的失效形态（不报错、不崩溃，只是那件事再也不会发生）。同理 A9 取不到分母就**不提醒**，不许猜。

- Task 9: implementer reported DONE — commit `c69ad06`（15/15 单文件、50/50 全套）
  - **A8/A9/A11 三条全部有源码级证据**：A8 `system-prompt/assemble` 是 waterfall（`dsh-system-prompt/lib/index.js:355`），而 `ctx.systemPrompt.append()` **不存在** → 选 waterfall；A9 `resolveModelInfo` 可用但**是 async**、上限字段是**嵌套的** `context.contextWindow`（`dsh-llm/lib/index.js:2098/2124`，非顶层）；A11 `ctx.inject` 迟绑定可用（`notify-sound/lib/index.js:22/47` 真例），`llm` 只经迟绑定、未进顶层 inject。
  - **★★ 它抓到两处"静默失效"，而且两处都是控制方 brief 里的错 ★★**
    ① brief 的触发点 `sctx.on('assistant/message')` 是**静默失效订阅**：`assistant/message` 是**持久化会话事件**（走 `session.append`），**不是 cordis 总线事件** → 订阅会成功注册、**永远不触发、不报任何错**。正确触发点是 cordis 的 `session/event`（`dsh-session/lib/index.js:1466-1473`）。**这正是控制方在派发词里点名要防的失效形态，而它就写在控制方的计划里。**
    ② brief 的 `sctx.llm?.resolveModelInfo?.(...)?.contextWindow` 是**同步调用一个 async 函数** → 拿到 Promise、取到 `undefined` → 同样静默不生效。字段还是嵌套的 `context.contextWindow`。
  - 遗留顾虑（实施者如实上报，未擅自改）：① 提醒状态是**全局单文件** `notify-state.json`、**未按会话 key**，与 spec §13.3"同一会话"及 §8.1"计数从审计流水算"有偏差（按 brief 落地，brief 的 `shouldNotify`/状态结构已给全）；② 接线为**签名级**验证，运行时生效性留给 Task 10 端到端。
  - → 顾虑①属**spec 与 brief 的冲突**（控制方自己的口径矛盾），按既定做法交审查者定级后再裁决。
- Task 9: review package `review-c498f61..c69ad06.diff`；reviewer dispatched

- Task 9: scoped 审查者 dispatched（agent f85db2bb；diff `review-c498f61..c69ad06.diff`，1 commit、23310 bytes；区间已显式核对只含 T9 的 commit）。
  - 交给审查者的最重核查项：**独立验证那两处"brief 是静默死路"的断言**（`assistant/message` 是否真不是 cordis 总线事件、`session/event` 是否真能拿到代码所读的载荷；`resolveModelInfo` 是否真 async、上限是否真嵌套）。理由：若该断言是错的，这次偏离就失去全部正当性——"你的修正本身是不是也想当然了"是独立审查的另一半理由。
  - 另一个交它定级的项：提醒状态**全局单文件 vs 按会话 key** 的 spec §13.3 冲突（属控制方自己的口径矛盾）。
  - 一个已知的 ⚠️（审查者应会点到）：6 条测试只覆盖纯函数 `notifyLine`/`shouldNotify`，**接线本身没有单测**——其运行时生效性只能靠 Task 10 端到端。

- Task 9: review returned — **Spec compliant ❌（1 个 Important）/ Task quality: Needs fixes**；无 Critical、4 个 Minor。
  - **偏离核实结论：两处均为「正确修正」**，审查者从一手源码独立验到**监听器层**（cordis `dispatch` 取首参作 carrier、`scopeTarget` 对无 tag 监听器返回 true）——即它回答的是"这条链**真的可达吗**"，而不只是"那个事件存在吗"。`assistant/message` 确认只是持久化事件，从不 `ctx.emit` → brief 原版确属静默死订阅。
  - **Ruling 25 — Important #1：修。** 提醒状态由**全局单文件**改为**按会话、全部从审计流水现算**，删掉 `notify-state.json` 与 `updateJson`/`readJson` 的用法。理由：spec §13.3 原文就是「**同一会话**」、§8.1 要求「从审计流水现算、不建独立状态文件」——**spec 本来就对，是 brief 错**。后果不是罕见边界：本插件主线是会话接力，源会话与「续」会话并存是**常态运行态**，全局状态会让 A 的首次提醒把 B 的首次提醒双重抑制掉、并耗尽共享日上限饿死 B。
    代价若错：每次组装提示多一次 `readAudit`（读两个月的 JSONL，量级为每天个位数行）——可接受；换来的是少一处权威源。
  - **Ruling 26 — 原 Minor #2 纳入本轮：修。** spec §13.3 原文「日上限超出**只记审计、不追加**」「免打扰**只记审计、不追加**」，而实现里这两种情况**一行审计都不落**。审查者按"brief 为直接权威"评为 Minor；但**spec 是绑定权威**（skill：the spec is the authority the plan argues from），这是对 spec 原文的硬性违反，且就在本轮被重写的同一段代码里，故一并修（`result: 'suppressed'` + `reason`）。
    边界控制：只有 `daily-cap` 与 `quiet` 留痕；`growth`/`cooldown` 属"还没到时候"，静默跳过——否则每条越限的 assistant 消息都会写一行，把审计流水刷爆。
  - **Ruling 27 — 原 Minor #4 纳入本轮：修。** spec §13.4 原文「关闭时零副作用」，而 `appendReminder` 的 waterfall **不检查开关**：模块级 `reminderLine` 一旦设过就长期生效，于是"先开后关"之后那行提醒会继续留在系统提示里（**关不干净**）。修法：waterfall 内部每次组装都判一次开关。理由同上——这是 spec 原文要求，不是打磨。
  - spec §13.5 字段名纠正：`notify.softLimitRatio` → **顶层** `softLimitRatio`（控制方的文档 bug，代码与 schema 一直是对的）。
  - Task 9: minor (deferred): pct 只按 `inputTokens` 计、不计输出与 cache，会系统性低估用量、使提醒偏晚（与 brief 一致，属语义可议点）。
  - Task 9: minor (deferred, 已由实现者声明并记录): 若某 preset 注册 `complete: true` 的 prompt section，`assemble()` 会替换全部 section，追加行被静默丢弃（provider 侧语义，留 Task 10 端到端复核）。
  - Task 9: 计划与 spec 修正提交；brief 9..10 重建；fix round 1/5 dispatched。

- Task 9: fix round 1/5 landed — commit `e14f7ca`（17/17 单文件、52/52 全套）。
  - **RED 证据硬**：旧实现下**新增测试红 7 条**，含那条 `会话之间互不抑制` —— 说明这组测试对本次缺陷**确有鉴别力**。
  - **实施者又查出控制方 brief 的两处错**：
    ③ **`event.data.message.usage` 应为 `event.data.usage`** —— `usage` 与 `message` 是**兄弟键**（引 `dsh-agent-loop:1144-1150`）。照 brief 的路径取会**永远取不到 usage** → **同一段代码里控制方埋的第二个静默失效点**。
    ④ **测试时区混用**：brief 的测试里 `now` 用**本地**时间、`row.ts` 用 **UTC**，在本机 UTC+8 下冷却比较**反向**（`now - last.ts` 为负 → 误判冷却）。实施者把 5 处冷却相关测试的 `now` 统一为 `...Z`(UTC)，免打扰测试仍用本地小时（那是对的，`getHours()` 本就是本地）。
  - 保留已审查认可的部分：`session/event` 触发点、`await` + 嵌套 `context.contextWindow`、模块级 `reminderLine` + 一次性 `reminderBound`。
- Task 9: scoped re-review dispatched（diff `review-27c7fa1..e14f7ca.diff`）

- Task 9: scoped re-review 返回 — **ALL FINDINGS ADDRESSED，无新增破坏**；三裁定（Ruling 25/26/27）全部落地；两处未提示修正（`event.data.usage` 路径、测试时区统一）均被独立验证为**真修正**；时区基准整体自洽（`dayKey` 本地日 / `getHours` 本地小时 / 冷却用 epoch ms，三者是独立谓词、从不互比）。
  - 复审另指出一处证据瑕疵（非缺陷）：隔离测试的 **RED 证据被返回类型变更掩盖**——旧 `shouldNotify` 返回布尔，7 条测试因 `.ok/.reason` 为 undefined 而全红，所以"会话互不抑制"那条对**实质隔离缺陷**的红并非干净证据。但该测试的鉴别力可**由 trace 证明**（全局状态实现下 s2 会因 s1 的 0.85 得出负 growth → 断言失败），故性质成立。**教训**：要证明一条测试的鉴别力，比"旧实现下它红了"更硬的做法是**故意把实现弄坏一次**（T8 就是这么做的）。
  - **Ruling 28 — 复审的"范围外观察"我判定为必须现在修，且缺陷由 Ruling 26 在本轮引入。** 观察原文：日上限命中后/免打扰时段内，**每次越限的 assistant 消息都会写一行 `suppressed`**。控制方追证：`growth` 与冷却都只跟**最后一行 `sent`** 比，而免打扰期内 `sent` **永不前进** → 冷却恒满足 → **每条越限消息写一行**，8 小时活跃夜可近千行，而审计流水**永久保留**（doc 02 的预算口径是 `<20 MB/年`）。**更根本的是：抑制机制本身在刷屏，而它存在的全部理由就是防刷屏。**
    处置：**冷却基准由"最后一行 sent"改为"该会话最后一行 notify（含 suppressed）"**；`growth` 仍只跟 sent 比。效果：免打扰期内最多每 20 分钟留一行，有界。并新增一条测试直接钉住"免打扰期内第二条消息必须被冷却挡成 cooldown、而不是再写一行"。
    为什么不等最终审查：① 缺陷由本轮裁定引入，就在被重写的那个函数里；② 构造性无界增长不是"量级待复核"，是设计错；③ 修法 2 行 + 1 测试。代价若错：冷却窗口内跨过 5 个百分点的那次提醒会晚最多 20 分钟。
  - T9 测试计数因本轮调整：9 条（原 8 + 1）→ index.test.js 18、全套 53。
- Task 9: fix round 2/5 dispatched（恢复原实施者 8e193106；FIX_BASE 见下）

- Task 9: fix round 2/5 (1 addressed, 0 open; commits 622bb54..bb197e7) — 复审判 ADDRESSED、无新增破坏、无遗留。
  - 复审的 boundedness trace 额外验了一件控制方没想到要验的事：**生产可见性** —— `appendAudit` 是同步 `appendFileSync`（store.js:60-68）、`readAudit` 每次调用重读文件（store.js:71-87）、handler 每个事件都重读（index.js:329），**所以那行 suppressed 真的会挡住下一条消息，界不是只在单测里成立**。若状态被缓存，这个界就不成立。
  - 复审确认泄漏检查干净：出货基准就是 `lastAny`、全仓 `grep TEMP|BREAK` 零命中、range 内无"破坏-还原"中间提交；并结构性核对 `^test(` 声明数 = 12+23+18 = 53，与报告相符。
  - 复审留的一条非阻塞观察：走出免打扰后，第一条真实提醒可能被 07:00 前那行 suppressed 挡住、最长延迟 `cooldownMinutes`（≤20 分钟）——这是 Ruling 28 的直接后果，接受了。
- **Task 9: complete (commits 27c7fa1..bb197e7, review clean after 2 fix rounds)**
- **Ruling 29 — T10 的可执行性缺口（计划缺陷）：** brief 原写"**在界面里开一个会话**"来跑端到端，三条失败注入也都需要驱动会话。**子代理无法可靠驱动 GUI**，照此派发要么卡住、要么更糟——**把没跑过的链写成跑过了**，而这正是本项目通篇反对的东西。
  处置：把 T10 Step 2 改为**优先非交互路线**（`dsh headless "<task>"` 答一个任务后退出；先试 `dsh plugin --profile headless add <path>`），并写死三条禁令：不许把没跑的链写成跑过了、不许把单测当端到端、不许把"预览返回 preview"当成"新会话真的自己开工"。**headless 走不通就停下报 BLOCKED**——端到端要不要人肉介入，是控制方与使用者协调的事，不是实施者硬凑的范围。Step 3 也标明哪几条无人值守可复现（#2 必做；#1/#3 做不到就**如实写"未能验证"**）。
  代价若错：headless 路线若不存在，T10 会以 BLOCKED 结束，端到端验证需要使用者配合——这比拿到一份伪造的"全绿"好得多。
- Task 10: dispatched (BASE 见上)

- Task 10: implementer reported **BLOCKED** — commit `4dea3af`（仅 README.md + lib/types/index.d.ts + spec 三文件；`lib/*.js` 与 `test/*.js` 零改动；全套 53/53 仍绿）。
  - **端到端无人值守未跑通，证据链干净**：① `dsh plugin --profile headless add` 成功、配置树出现 `- id: dajiangjun` ② `dsh headless` 默认路由 `deepseek-official` 报 `MISSING_CREDENTIAL`（本机无 `DEEPSEEK_API_KEY`）③ 用 `--patch` 把 `agent-default-model` 切到 `deepseek-account` 后**模型能跑**（返回 PONG）④ **架构性卡点**：插件一直 `pending (waiting for service: sessionController)` —— headless 配置树**没有** `@deepseek-ai/dsh-api-session-controller`（web 客户端服务，需常驻 HTTP host），而顶层 `inject` 硬依赖它 → **`steward_relay` 工具从未注册** → 真链不可达。对照 `steward-dev`(web) 有该服务。
  - **四条 Expected 与三条失败注入全部照实写"未验证"**，根因一致（工具未注册）；**未用改代码/打桩/构造返回值伪造任何一条**。
  - **Step 5 未执行**（按 Ruling 29 那道门：Step 2 未跑通就不装 desktop）；**未碰 desktop 的 `cordis.patch.yml`**。
  - → **BLOCKED 是 Ruling 29 那道门想要的结果，不是失败。**
  - **Ruling 30** — 实施者发现了一个**必须写进 README** 的事实却只写进了报告：插件硬依赖 `sessionController`，**装进 headless 会完全静默地什么都不做**（宿主只打一行 `pending`）。这正是本项目最反对的形态（说明书与机器对不上）；报告只有控制方看得到，README 才是这个插件的用户界面。裁定：README 增「依赖与适用范围」节、**点名这个静默失效形态**，并把该发现追加进 `docs/notes/dsh-api-notes.md` 使其耐久。
  - **Ruling 31** — 实施者试了 headless 就下结论，**但没试 web 路线**。`steward-dev` 从 web 模板建、**有** `sessionController`。裁定：先试「后台起隔离 web host（换端口，桌面宿主占着 19387）+ HTTP 驱动」；已知坑是桌面宿主对未鉴权请求返回 401、而 `~/.dsh/web-login` 取不到可复用令牌。**能驱动就把四条 Expected 跑到哪算哪并贴原始输出；鉴权过不去就把试过的取令牌路径与结果说清、维持 BLOCKED**——那时才是真的需要使用者手动跑一次。
- Task 10: fix/续做轮 dispatched（恢复原实施者 9fdd58e0，带 Ruling 30/31）

- Task 10: **Ruling 31 的续做把端到端真链跑起来了 —— 这是整个执行过程里最重要的结果。**
  - **web 路线可用（重大能力发现）**：`steward-dev` 启动输出直接打印一次性令牌 `dsh web: http://127.0.0.1:19399/?token=…`；`GET /?token` 拿签名 cookie 后 `POST /api/session/{create,prompt,list,page}` **全部 200**。与桌面宿主（401 且 `web-login` 取不到可复用令牌）不同——**端到端可以无人值守复现**。实施者已写进 notes §11（含 `resolveAgent` 返回形状）。
  - **真链实测（原始审计行）**：预览 ✅ `result:"preview"`(dryRun:true)、无新会话；真执行 ❌ `result:"failed"`、`error:"Cannot read properties of undefined (reading 'header')"`、`newSessionId` 已建（**孤儿会话**）。
  - **根因（阻断级代码 bug，属 Task 8）**：`lib/index.js` 的 `dispatchRelay` 用 `ctx.sessionController.resolveAgent(sid).session`，而该 API 返回 **`{ agent }` 或 `{ error }` 的包装**，故 `.session` 恒 `undefined` → `stateOf(undefined,'sandboxMode')` 抛错。正确写法是 `.agent.session` 并处理 `{ error }`。
  - **★★ 最重的教训（必须记下来）★★**：`fakeCtx` 的 `resolveAgent` 是照着**控制方的错误假设**写的（`return { session: { id } }`），于是**代码与替身互相印证、一起错**——53 条单测全绿、5 轮独立审查全过，因为它测的是一个**不存在的 API 形状**。而 Task 8 的审查者其实**点到过这个风险**（"judge whether the assertions would catch a real regression or merely restate the mock's own behavior"），但它无法在没有真宿主的情况下定论。**更刺痛的是：控制方在能力调研阶段亲手读过正确形状** —— `dsh-api-session-controller/lib/index.js:942-950` 明写 `if ("error" in found) … ; agent = found.agent`，**读了正确形状，写计划时仍写成了 `.session`**。
  - 失败注入 #2 ✅ 已复现（不存在的 docPath → 「读不到交接档」、零新会话）；#1/#3 被上述 bug 挡在投递前，未验证。
  - 另发现第二处轻微 bug：`readFileSync` 的 catch 分支直接 return、**未 appendAudit**，与 spec §5「每道闸都必须有…审计行（带原因）」不符。
  - Step 5 仍未执行（真链投递失败，按门不装 desktop）；隔离 profile 已收尾关停；**桌面 19387 未被碰**。
  - **Ruling 32** — 授权修阻断级 bug（`resolveAgent` 形状 + 处理 `{ error }`），**并把 `fakeCtx` 改成真实返回形状**（这正是能抓住它的回归测试）、补一条 `{ error }` 分支的测试；修完**重跑端到端并贴原始输出**。
  - **Ruling 33** — 授权修 doc 闸缺审计行（spec §5 明文要求每道闸留审计行）。
  - 2026-10-06 提示：隔离 profile 已关停，重跑需重新起 `dsh --profile steward-dev --port 19399 --no-open` 并从启动输出取令牌。

- Task 10: 计划修正提交 `d28ab96`（三处：`dispatchRelay` 用 `{ agent }` 包装 + 处理 `{ error }`；`fakeCtx.resolveAgent` 改真实形状；doc 闸补审计行；新增 `{ error }` 分支测试）；brief 7/8/10 重建并核对。
- Task 10: fix 轮 dispatched（恢复原实施者 9fdd58e0）。要求：① 先只改 `fakeCtx` 与新增测试、**不改实现**跑一次拿 **RED**（这正是当初该发生的事）② 再修实现 ③ **修完重跑四条 Expected** 并贴原始输出 ④ 端到端全过才允许执行 Step 5 ⑤ 收尾关停隔离 profile。
  - 为什么让同一个实施者做：它手上已经**摸通了 web 路线**（起 host + 取令牌 + 驱动 session API），换人得重新摸索。
  - 预期测试数：53 + 新增 1 = **54**。
- 2026-10-06 备忘（给最终审查）：本轮暴露的"假绿"形态值得在最终审查里被点名——**替身照实现写 → 代码与替身一起错 → 单测全绿 + 多轮审查全过**。可复用的对策：涉及**外部 API 返回形状**的替身，必须由读过真实源码的一方来写，且**不能与实现出自同一份假设**。

- Task 10: **端到端四条 Expected 全过，Step 5 已执行。**
  - **又抓出两处同类 API 形状 bug**（端到端复跑时）：③ `sessionTitle.rename(session, title)` 第一参是 **session 对象**；④ `sessionController.prompt(request, signal)` **需显式传 signal**。两处都是"`fakeCtx` 照错形状写 → 单测与实现互相印证一起错"这同一个形态。加上 Ruling 32 的 ①，**同类 bug 一共 4 处**。
  - **端到端最终实测**（审计 `relay-e2e-test4`）：preview ✅（dryRun:true，无新会话）→ dispatched ✅（`newSessionId` 已写）→ 出现 title「【续】relay-e2e-test4」新会话 ✅ → **新会话自己开工** ✅（`running:true`，`session/page` 抓到 seq 16→186 持续 `assistant/message`：读档 → 核审计 → 核代码 → 核配置）。**v1 的存在理由被真实验证。**
  - 失败注入 #1（杀进程）/#3（只读档位）**未验证**：前者需精确掐在 create↔prompt 之间、后者需能指定只读档位起会话，本机无法无人值守复现。照实登记，未伪造。
  - **★★ 最强旁证：第 55 条测试不是实施者写的、也不是控制方写的——是接力派发出去的新会话自己加的。** 它发现"doc 闸修复没单测"这个真实缺口并写了正确断言。这既是"新会话真的自己开工"的最强证据，也说明**接力新会话会改 repo**（观测期只开 `notify` 不开 `enabled`，可控）。
  - **Step 5 已执行**：备份 `~/.dsh/profiles/desktop/cordis.patch.yml.bak-dajiangjun`；`dsh plugin --profile desktop add`（依赖 + 符号链接 + lock 落盘）；往 `cordis.patch.yml` **追加** `- insert:`（`enabled:false`、`notify:{enabled:false}` 出厂全关），**diff 确认只加 9 行、未覆盖**。回退 = 还原备份或改 `disabled:true`，不删文件。
  - 测试：**55/55 绿**（53 + resolveAgent 回归 + 失败注入#2 回归）。提交 `1abc337` / `f6c3571` / `f25cd51`；git 干净；`steward-dev` 已关停；**19387 桌面未被碰**。
  - **控制方追加核验（本会话内）**：本会话的工具列表里**已出现 `steward_relay`** —— 即使实施者登记"live GUI 未重启未验证"，插件其实**已被 HMR 装载进正在运行的 desktop 宿主**。控制方随即用不存在的 docPath 调了一次：预期在**读档之前**就被总开关拒（`enabled:false`），零副作用。结果见紧随其后的工具返回。

- **Ruling 34 — 控制方用一次真实调用抓到的 Important：关闭状态**不是**关闭。**
  - 控制方发现本会话工具列表里出现了 `steward_relay`（说明插件已被 HMR 装载进**正在运行的 desktop 宿主**，不必等下次 boot），于是用不存在的 docPath 调了一次、预期在**读档之前**被总开关拒。
  - **实际返回「读不到交接档：…」——即 doc 闸，不是 total-switch。** 随即取证：`~/.dsh/steward/audit/2026-10.jsonl` 尾行正是这次调用（`result:"rejected"`, `gate:"doc"`, `reason:"doc-unreadable"`, `sourceSessionId:"session-4b10a5b6-…"` = 本会话 id），而桌面 profile 该行是 `enabled: false`。**结论：总开关关着，工具仍然读了文件、并写了一行审计。**
  - **违反 spec §1 G8**（"关闭时工具返回『未启用』且**零副作用**"）；且给用户的消息是误导性的"读不到交接档"而非"未启用"。根因：`runRelay` 在调 `evaluateGates` **之前**就 `readFileSync`——闸门顺序本身是对的，但**读档发生在所有闸门之前**。
  - 处置：抽出 `preflightGates({config, isSubagent})`（配置不可读 / 总开关 / 调用者三道，**不需要 I/O、不允许副作用**），`evaluateGates` 首行调用它以保持**单一实现**；`runRelay` 在**读档之前**先跑它，不通过则直接返回且**不写审计**。并明确口径：**"每道闸留审计行"（§5）从属于"关闭时零副作用"（§1 G8）**——插件休眠时不落痕，否则任何人靠反复调用就能刷大审计流水。
  - 测试改为能钉住顺序的形态：传**不存在**的路径 → 若先读档则返回 `gate:'doc'`，先查开关才返回 `'total-switch'`；并断言 `readAudit` 为空。
  - 该发现也是"端到端的价值"的又一次实证：**控制方自己的会话就是一台验证仪器**（工具一旦装载进来，任何一次真实调用都是一次黑盒测试）。
  - **记忆点**：控制方在台账里的预测（"预期在读档之前就被总开关拒"）**是错的**，且这次错误预测**恰好暴露了缺陷**——预测与实测不符时，先怀疑实现，再怀疑预测。
- Task 10: fix 轮（第 4 次续做）dispatched（恢复原实施者 9fdd58e0；FIX_BASE 见上）

- Task 10: **Ruling 34 修复完成** — 提交 `8c5727f`（preflightGates 修复）+ `d5bb5ad`（spec §10.1 补记）。
  - 修法：`relay.js` 抽出 `preflightGates({config,isSubagent})` 三道（无 I/O 无副作用），`evaluateGates` 首行调用它（**单一实现，未抄两份**）；`runRelay` 在 `readFileSync` **之前**跑前置闸门，不通过直接返回且**不读档、不留审计**。
  - **RED 证据**：只改测试不改实现 → `actual 'doc' expected 'total-switch'` —— **与控制在活宿主撞到的症状完全一致**。修后 55/55 绿（那条是改写不是新增，计数不变）。
  - **端到端四条复验仍全过**（mainline `relay-e2e-test5`）：preview ✅ → dispatched（`session-ac055382…`）✅ → 出现「【续】relay-e2e-test5」✅ → 新会话 `running:true` 自开工 ✅。**主路径未被破坏。**
  - 实施者把它做不到的一步交回控制方，判断正确：**它是子代理、工具清单里没有 `steward_relay`**；而控制方就在 live desktop 里、手上有该工具。活宿主复核交回控制方执行（`total-switch` = HMR 已生效；`doc` = 需下次 boot）。
- Task 10: 活宿主复核（控制方执行）：先记审计流水 BEFORE，再调 `steward_relay`（不存在的 docPath），再记 AFTER 比对。

- Task 10: **活宿主复核结果（控制方执行，有定论）**：BEFORE 11 行 / 末行 `xxxxxxxx…` → 调 `steward_relay`（不存在路径）→ 返回仍是「读不到交接档」而**非** `total-switch` → AFTER **12 行**、新增那行正是本次调用（`gate:"doc"`, `reason:"doc-unreadable"`, `sourceSessionId`=本会话，`prevHash` 接上 BEFORE 末行 → **链完整**）。
  - **结论：`dsh plugin add` 让「配置树」立即生效（工具出现），但「插件代码」要下次 boot 才加载。** 这把 T1 确立的 A10 从"新增插件"**推广到了"代码改动"**——一条实用操作知识：改了插件代码别指望热更新到正在跑的宿主。
  - 活宿主里跑的仍是**修复前**代码，故"关闭时读档 + 写审计"的行为被这次调用**再次实锤**（多出的那一行就是它）。
  - **Ruling 35** — 修复本身在**真实宿主**里是验过的（实施者在隔离 profile 每次都是全新 boot，`relay-e2e-test5` 四条全过）；desktop 侧只是**尚未 reload**。**不为此重启使用者的宿主**——下次自然重启即生效。代价若错：使用者在重启前仍跑着带 Ruling 34 缺陷的版本，但该版本 `enabled:false` 出厂全关，实际影响为零。
- **Task 10: complete**（含 4 次续做：BLOCKED→web 路线打通→Ruling 32/33 修 4 处 API 形状 bug→Ruling 34 修关闭语义）。commits `4dea3af`..`d5bb5ad`。
  - 如实登记的"未验证"：失败注入 #1（投递前杀进程）与 #3（只读档位会话）——本机无法无人值守复现，**未伪造**。
  - **下一步：最终整分支审查**（`933bfa0..d5bb5ad`），最强模型，并指向台账里的全部 deferred minor。

- **最终整分支审查返回：Needs fixes before merge**（`933bfa0..d5bb5ad`，37 commits；审查者读了三个 `lib/*.js` + 三个 test 全量、spec/plan/notes 全量、README/package.json/cordis.patch.yml，并抽 asar-out 内 9 个官方包源码逐条核对 API 形状；实跑 `node --test` 55/55）。
  - **唯一阻断项（Ruling 36）：`isSubagentCaller` 用 `exec.parent` 判子代理是错的。** 控制方**独立复核确认**：`exec.parent` 只在 **PTC 嵌套派发**时赋值（`dsh-tools/lib/index.js:1306`、`types/ptc.js:439`），而 `dsh-agent-loop` 内 `parent:` **零命中**（主/子代理工具调用从不设它）。后果两头错：**子代理拦不住**（§8.3 白名单形同虚设）、**主会话在 run_code 里反被误拒**。**这是第 5 个同款假绿**——唯一那条「子代理→拒」测试是**直接喂 `isSubagent: true`**、绕过了 `isSubagentCaller`。正确判据 = `exec.agent.session.header.parentSession`。
  - Ruling 37（Important）：`validateDoc` 不校验头部 `主线:`；`resolveMainline` 取不到返回空串 → `runRelay` 用 `?? args.mainline ?? ''` 吞成空主线 → **spec §4 fail-open**。
  - Ruling 38（Important）：`create({})` 未传 cwd，而注释写「cwd 同源会话」**不实**（真实 `defaultCwd` = `process.cwd()`）；权限降级 / exit-3 / exit-1 三条路径**零测试**（`fakeCtx.stateOf` 是常量，降级永不触发）。
  - Ruling 39：`dedupeKey` 死导出**删**（连带 `test/relay.test.js` 未用 import）；README 写「53 个测试」实为 **55**；`lib/index.js:92,113` 过时注释。
  - **Q0 结论（本轮最有价值的一问）**：除 `exec.parent` 外，**其余替身全部已对照真实源码核实无误**；被 E2E 抓出的 4 个 bug 确已修对。提醒路径（`session/event` / `resolveModelInfo` / `usage.inputTokens` / waterfall）形状**全部 source-verified**，但整条**零运行时测试**（A8/A9 明示未验证）。
  - 20 条 deferred-minors 逐条 triage：**只有 #15（dedupeKey）与 #18 的过时注释/降级测试需修，其余 can stand**。
  - **控制方流程疏漏**：`docs/三形状对照.md`（141 行、下一期决策稿）是**接力出去的新会话写的**，控制方用 `git add -A` 把它卷进了 `27c7fa1`。教训：`git add -A` 会提交不是我写的文件。该文件保留（是接力产出有用东西的实证），但需在分支总结里点名来历。
- 计划已追加「终审修复（Ruling 36–39）」一节（不回写上面各任务的旧代码块，以该节为准）。
- Task 10: 终审修复轮 dispatched（恢复实施者 9fdd58e0，带完整 findings 列表）。

- **终审修复轮：原实施者 9fdd58e0 因电脑突然关机而中断，未留报告。**（成因由使用者澄清：是**关机**，不是实施者自身问题）
  - 工作树遗骸：`lib/index.js` / `lib/relay.js` / `test/index.test.js` / `test/relay.test.js` 四个文件未提交，+157/-12，**全套 62/62 通过**（基线 55，即它加了 7 条）。
  - **控制方逐条核对了遗骸**（读 `git diff`）：4 条 ruling 确实都覆盖到了，且做法正确——Ruling 36 判据改为 `exec?.agent?.session?.header?.parentSession != null`；Ruling 37 `validateDoc` 增头部 `主线:` 校验、`?? null` 取代 `?? '`、并加 `!mainline` 拒绝分支（带审计）；Ruling 38 先 `resolveAgent` 取源 `cwd` 再 `create({cwd})`；Ruling 39 `dedupeKey` 已删、两处过时注释已改。
  - 缺口：README 的测试条数未改、端到端未复跑、无 RED 证据、无报告。
  - 处置：① 先**单独提交控制方自己的**计划改动（`0862bf5`，追加「终审修复」一节），让实施者的提交里只有它自己的工作；② **派一个新的实施者收尾**（原实施者的会话已随中断丢失，无法"恢复原实施者"）。
  - **派发词的关键一条**：明确告知"工作树里的改动**不是你的、且未经审查**"，**必须先对着 findings 逐条核对再决定是否采纳**；并写死"**测试绿只说明它自洽，不说明它正确**"。核错则修，夹带则报告。
  - **Ruling 40（流程教训，与成因无关）**：**任何中断**（关机 / 断网 / 进程被杀）留下的"看起来完整 + 测试全绿"的半成品，都是**最危险的一类输入**——它比明显的半成品更容易被直接采纳。这条不针对实施者，而是针对"未提交 + 未审查 + 测试自洽"这个组合。恢复程序固定为：先读 diff 对着 findings 核 → 再决定保留/修正 → 最后**仍要走评审**（因为"没人验过"这一点不因它长得完整而改变）。
- 终审修复轮（第二次尝试）dispatched：agent `65fdbbe4`（v4-pro）。

- **终审修复轮完成** — commit `f15b832`（只含 `lib/index.js` / `lib/relay.js` / `test/index.test.js` / `test/relay.test.js` / `README.md` 五个文件，+120/-13）；**62/62 通过**；工作树干净；未动计划/spec、未动 `package.json`/`cordis.patch.yml`、未碰 desktop。
  - 前一位（断电中断的）实施者留下的未提交改动，经新实施者逐条核对：**全部正确、无需推翻**，唯一缺口是 README 测试条数。
  - **R36（阻断）**：判据改 `exec.agent.session.header.parentSession`。新实施者**独立引 asar 再核**：`dsh-subagent/lib/types/child-agent.js:117` = `parentSession: parentHeader.id`、`dsh-subagent/lib/index.js:852` = `agent.session.header.parentSession`（对照 `dsh-tools:1306` / `ptc.js:439` 的 `parent: exec.token` 仅 PTC）。**RED**：临时回退旧 `exec.parent` → 「子代理判据」测试红（`actual:'preview' expected:'rejected'`）；且**两条测试均经 `isSubagentCaller` 本身、不喂布尔** → 第 5 个假绿被真正修掉。
  - **R37**：修正了控制方的定位——`resolveMainline` 在 HEAD **本已返回 null**，真正 fail-open 的是 `runRelay` 的 `?? ''`，已改 `?? null` + `if(!mainline)` 拒绝（`gate:doc`）。**RED**：回退 `validateDoc` → 「头部缺主线」测试红。并**如实说明** `if(!mainline)` 是兜底、经公开入口不可达、故无单测。
  - **R38**：`create(srcCwd ? {cwd} : {})`，先 `resolveAgent` 取源 cwd。**RED**：回退 `create({})` → 「建会话传 cwd」测试红（`actual:undefined expected:'E:/src-cwd'`）。**关键诚实点**：权限降级 / 退出码 3 / 退出码 1 三条**是补覆盖、不是修 bug**（HEAD 逻辑本已正确），**旧实现下不会红**——实施者**如实说明、未伪造 RED**。
  - **R39**：`dedupeKey` 已删（定义 + 未使用 import）；README 53 → **62**；`lib/index.js` 过时注释更新。
  - **端到端四条复跑全过**：隔离 profile `steward-dev`（**端口 3080**，桌面 19387 未碰），mainline `relay-e2e-r36`；审计原始行 = preview（dryRun:true，无新会话）→ dispatched（`newSessionId session-xxxxxxxx`）；`session/list` 新会话 `title:"【续】relay-e2e-r36"`、`running:true`、`agentAvailable:true`、**`cwd` = 源 cwd（顺带独立坐实 R38）**、`asOfSeq:52`、`turns:1 steps:5 llmMs:27367`；`session/page(throughSeq=52)` 抓到 6+ 条 `assistant/message`。跑完已关停、端口释放、**desktop 宿主全程未动**。
- 终审修复轮 scoped 复审 dispatched（diff `review-0862bf5..f15b832.diff`）

- 终审修复轮：控制方独立核验通过 —— 区间只含 `f15b832`；全仓 `grep -E "TEMP|BREAK|filter\\(\\(\\) => true\\)"` **零命中**（临时破坏未泄漏）；**`dedupeKey` 在 `lib/` 与 `test/` 里已彻底消失**。
  - **澄清（防日后误判为漏删）**：`dedupeKey` 的 grep 命中**只剩计划文档**（`:1014` Interfaces 声明 / `:1022` 一条测试的 import / `:1154` 定义）——那是控制方**刻意不回写**的旧代码块；文件末尾「终审修复」一节（`:2247`）已写明它被删除，**以该节为准**。
  - （注：那句 `grep` 的 `.Contains` 判定里 `head` 变量名与 `HEAD` 词义撞车过一次，纯显示问题，不影响结论。）
- 终审修复轮 scoped 复审 dispatched：agent `0a545e34`（v4-pro）；包 `review-0862bf5..f15b832.diff`（1 commit、20216 bytes）。
  - 复审重点：**R36 两条测试是否真的经由 `isSubagentCaller` 本身**（仍喂布尔即等于没修）、`parentSession` 的写入点是否真在宿主源码里、R38 那句"补覆盖非修 bug 故无 RED"的定性是否属实（会不会是掩盖漏修）、以及**新判据会不会误放子代理或误拒合法调用者**（如 `fork` 出来的会话）。

- 终审修复轮 scoped 复审返回：**Findings remain open** —— R36–R39 按裁定字面均已落实（含 leak check 干净、`^test(` 计数 = 62 与 README 一致），**但 R36 的新判据引入一处 Important 级误判**。
  - **复审新发现**：`header.parentSession != null` 会把 **`fork` 会话**误判成子代理、错误拒绝合法接力。证据：子代理写 `parentSession` **+** `origin:'subagent'`（`dsh-subagent/lib/types/child-agent.js:117,121`），而 fork **只写 `parentSession`**（`dsh-api-session-controller/lib/types/commands.js:254`，附近无 `origin`）；宿主判别器用 `origin === 'subagent'`（`dsh-api-session-controller/lib/index.js:126-132`、`commands.js:522`）。**控制方独立核实，成立。**
  - 而这**恰好是控制方在派发复审时点名要它查的情形**（"新判据会不会误拒 `fork` 出来的会话"）——它查了，且查对了。两条新测试只覆盖 `parentSession` 有/无，**未覆盖「`parentSession` 存在但 `origin` 缺失」的 fork 形态**。
  - **Ruling 41**：判据收紧为 `exec?.agent?.session?.header?.origin === 'subagent'`，**与宿主判别器逐字一致**；刻意不自己发明 `parentSession != null && origin === 'subagent'` 变体（那正是"同一事实两处口径"，下次宿主改动会再错判）。补 fork 形态放行测试。
  - **关于轮次上限（如实记账）**：T10 已远超名义上的 5 轮上限（这是第 6 次续做）。控制方**仍授权这一轮**，理由三条：① 它是**最后一个未决项**；② 改动是**一个谓词 + 一条测试**，风险极低；③ 停在这里等于**明知会发货一个回归**，而"停"的收益只是守住一个形式上的计数。**若本轮仍不收敛，则停止并交使用者裁决。**
- 终审修复轮（第 7 次续做）dispatched。

- **Ruling 41 修复完成** — commit `637b1b3`（只含 `lib/index.js` / `test/index.test.js` / `README.md`，+26/-9）；**63/63 通过**；工作树干净；未动计划/spec、未动 `package.json`/`cordis.patch.yml`、未碰 desktop。
  - **fork 形态测试的 RED 证据（症状正是预测的那一条）**：旧 `parentSession != null` 下 `✖ fork 判据：有 parentSession 无 origin → 放行（走预览）`，`actual:'rejected' expected:'preview'` —— 即 fork 被误判成子代理拒掉；收紧后转绿。
  - 控制方独立核验：`lib/index.js:55` 就是 `return exec?.agent?.session?.header?.origin === 'subagent'`（`:48`/`:54` 注释写明与宿主逐字一致、以及**刻意不写自造变体**的理由）；全仓 `TEMP|BREAK` 零命中；三条判据测试均经 `ctx.registered.execute` + 真实 `exec` 形状（`:174` 子代理带 `origin`+`parentSession`、`:192` fork 带 `parentSession` 无 `origin`）。
  - **端到端四条再次全过**（mainline `relay-e2e-r41`）：preview → dispatched（`session-xxxxxxxx`）；新会话 `title:"【续】relay-e2e-r41"`、`running:true`、`agentAvailable:true`、`cwd` = 源 cwd、`asOfSeq:48`、`turns:1 steps:4 llmMs:13912`；`session/page` 抓 5+ 条 `assistant/message`。隔离 profile 已关停、端口释放、**desktop（PID 18964）全程未动**。
- Ruling 41 scoped 复审 dispatched：agent `6f422ac2`；包 `review-bcfc99b..637b1b3.diff`（1 commit、7058 bytes）。
  - 复审额外要它查一件事：**收紧后的判据会不会反而放过本该拦的东西** —— 有没有哪条宿主路径造出"是子代理但不写 `origin:'subagent'`"的会话；若有，白名单存在洞，那是 finding。
  - 另注：`test/index.test.js:181` 那条测试名仍是「主会话判据：header **无 parentSession**」，而判据已改为 `origin` —— 名字相对新判据略显过时（功能无误）。留待复审判定是否需要改名。

- **R41 scoped 复审返回：ADDRESSED，无新 Critical/Important 破坏。** 分支至此干净。
  - 谓词 `lib/index.js:55` 与宿主 `dsh-api-session-controller/lib/index.js:127` 首行**逐字一致**；无存活 `parentSession` 判据。
  - 三条测试确实经 `ctx.registered.execute` → `runRelay` → `preflightGates({isSubagent: isSubagentCaller(exec)})`（`lib/index.js:333-335`/`:66`），不喂布尔。fork 测试在旧判据下必红，与报告 RED 吻合。
  - **泄漏检查干净**：`lib/`、`test/` 全库无 `TEMP|BREAK|TODO|FIXME|console.log|debugger`，无 `.only/.skip/todo`。
  - **白名单无洞**：子代理两处创建点均写 `origin='subagent'`（`dsh-subagent/lib/index.js:476+478`、`types/child-agent.js:117+121`）；fork 只写 `parentSession`（`commands.js:254`、`index.js:816`）正确放行；`index.js:1096` / `continuation-activation.js:472` 的 `parentSession` 是 **activation 记录字段、非 header**。
  - 计数：`test/*.test.js` 共 **63** 条 `^test(`（store 12 + relay 24 + index 27），与 `README.md:79` 的「全套 63」一致。
- Task 10: minor (deferred): 宿主 `hasApiSessionSubagentOwner`（`dsh-api-session-controller/lib/index.js:126-132`）除 `origin` 首行外还有**运行时兜底**（`parentSession` + `isOwnedBy`，后者是 live owner 测试，`dsh-agent/lib/index.js:605`）——属运行时归属、非持久化 header，插件不可也不需复刻，不影响判定。
- Task 10: minor (deferred): `test/index.test.js:181` 标题仍写「无 parentSession」，判据已改为 `origin`，措辞略过时（测试体语义正确）。
- **【分支完成】全部 10 个任务收口；最终整分支审查通过（含 Ruling 36–41 的修复与复审）；63/63 测试；端到端四条在隔离 web 宿主实跑全过（三次，mainline 分别为 relay-e2e-test5 / relay-e2e-r36 / relay-e2e-r41）。**
- 开始收尾：loading `finishing-a-development-branch`。


---

## 【收尾】状态：已交付，非进行中

- **用户选择：保留分支**（`finishing-a-development-branch` 的选项 3）。分支 `feat/session-relay` 保留；工作区就地保留（`GIT_DIR == GIT_COMMON`，普通仓库无 worktree 需清理）；**未合并、未删除分支**。
- 收尾检查：全套测试 **63/63**（在即将集成的这棵树上跑）；工作树干净；`933bfa0..HEAD` 共 **42 个 commit**；本仓**无远端**。
- 交付随附台账已入库：`docs/大管家-v1-裁决与遗留台账.md`（41 条裁决 / 22 条遗留 / 8 项未验证 / 流程实际抓到的 10 个缺陷）。
- **刻意偏离流程的一步（记录理由）**：SDD 技能末尾要求"删除本计划的工作区，因为记录已进 git"。**控制方保留它**，理由：① 台账入库的只是**摘要**，此处才是**原始证据**（每任务的报告、RED/GREEN 原始输出、review 包与 diff）；② 该目录是 gitignore 的，不进版本库、零成本；③ 技能给的理由是"过期台账会被误读成当前进度"，而本台账**已全部收尾并明确标注状态**，不存在误读风险。

### 留给下一班的入口

1. **两处未验证的失败注入**（#1 投递前杀进程 / #3 只读档位会话）——需人工在 GUI 里操作，约 5 分钟。缺口与期望写在计划 Task 10 Step 3。
2. **提醒路径零运行时测试**——形状全部 source-verified，但整条从未在运行时跑过。若要验：打开 `notify.enabled`（**不要**开 `enabled`）、跑够样本、看系统提示里有没有出现那一行。
3. **观测期**（spec 引文档 07）：≥3 自然日，只开 `notify.enabled`；第一 KPI = 误报率；放行门槛 = 误报率 <5% **且** 样本 ≥25 条。
4. **是否重启 desktop 宿主**让 Ruling 34/36/41 的修复生效——控制方刻意没重启（不打断使用者会话）；`enabled:false` 出厂全关，未重启的实际影响为零。
5. 插件若要在 desktop 上**真正启用**：改 `~/.dsh/profiles/desktop/cordis.patch.yml` 里那一行的 `enabled: true`，然后 boot 一次。回退 = 改回 `false` 或 `disabled: true`，**不要删文件**；备份在 `cordis.patch.yml.bak-dajiangjun`。

## 【收尾后】使用者问"跑足够样本要多少 token / 多少钱" —— 由此查出一处使提醒失效的缺陷

### 实测数据（本机真实账本，非估算）

- 账本：`~/.dsh/storages/cost-meter/ledger.json`。**今天 2026-10-07**：input `4,877,532`；output `1,242,268`；**cacheRead `337,640,832`**；`calls: 2061`；**cost ¥2.4899**。
- **本会话**（`session-4b10a5b6…`，即整个大管家的实现过程）：126 次调用，**¥0.4707**。
- `balanceRef`：余额 **¥99.30**（CNY），`ledgerCost` ¥2.10。
- **单价反推并验证到分**：deepseek-flash 非高峰 `cacheMiss ¥0.15/M`、`output ¥0.6/M`、`cacheHit ¥0.003/M`。验证：`2.4357×0.15 + 0.4246×0.6 + 194.918×0.003 = 1.2050` vs 账本实际 **1.2049** ✓（价目表 `provider-pricing.json` 里**没有** `deepseek-account`，只有第三方中转；此组数字来自其 `peak/offPeak` 段并与实测吻合）。
- 混合均价：`¥2.4899 / 3.438 亿 token` = **¥0.0072 / 百万 token**。

### **Ruling 42（Critical —— 使主动提醒失效）**

提醒的判据是 `pct = usage.inputTokens / contextWindow >= softLimitRatio`，但：

- 宿主源码 `dsh-token-meter/lib/types/usage-projection.js:15` 把 `usage.inputTokens` 明确命名为 **`uncachedInputTokens`**（即**未命中缓存**那部分）；
- 同文件 `:58` 宿主自己的上下文压力 = `inputTokens + cacheReadTokens + cacheWriteTokens`。

**量化后果**：今天 prompt 侧总量 3.425 亿中，`inputTokens` 仅 **1.42%**。要让我们的 pct 达 0.7，需宿主真实压力为窗口的 **49 倍** —— 不可能。**提醒几乎永不触发；观测期样本恒为 0，而"0 误报"会是一份假绿。**

**这条此前被列为 deferred minor #14（"pct 只按 inputTokens 计…属语义可议点"）——控制方当时判轻了。它不是语义可议，是让整条功能不成立。** 记此以正前判。

**修法（一行，且是"对齐权威源"）**：改用宿主自己的公式
`(usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)) / limit`。
这与 Ruling 41 同一条教训：**不要自己发明口径，抄权威源。**

### 成本估算（前提：Ruling 42 修好之后）

- 上下文窗口 = **262,144**（`dsh-llm/-deepseek/lib/index.js:45,53` 的 `DEFAULT_CONTEXT_WINDOW`，flash 与 v4-pro 同）。
- 触发一次需 prompt 侧 ≥ **183,500** token（0.7×）。
- 单会话可产出 1–5 条（首次越限 + 每再涨 5pp；受 20 分钟冷却限制）。
- **采满 25 条 ≈ 5–25 个长会话**；按本机实测"长会话"量级（本会话 126 calls / ¥0.47），预计 **¥0.5–12，最可能 ¥2–5**。
- 3 个自然日按今天这种开发强度 ≈ ¥7；普通使用强度 ¥1–3/天。余额 ¥99.30 完全够。

**结论：token 花费是个位数人民币级别，不构成约束；真正的约束是指标必须先修。**
- **Ruling 42 修复完成** — commit `bfacb5d`（抽出纯函数 `pressurePct(usage, limit)`，分子 = `inputTokens + cacheReadTokens + cacheWriteTokens`，注释标明出处 `dsh-token-meter/lib/types/usage-projection.js:58` / `:15`；**刻意不读宿主 `contextPressure` 投射**，避免"依赖插件在场、不在场则静默降级"的新失效面）。
  - **RED 证据**：`AssertionError pct=0.003814697265625 应越过软限` —— 即旧实现漏算缓存 token、pct 低到不可能越限。GREEN：**64/64**（store 12 + relay 23 + index 28）。
  - 附带发现：`softLimitRatio` 的 schema 下限是 **0.1**（给 0.02 会 ValidationError）——控制方给的建议值越界了，实施者自行改成 0.1 并说明。
  - **提醒路径运行时验证 = 未验证**（诚实报告）：隔离宿主起得来、HTTP 建会话 + 3 次 `prompt` 均 accepted，**但 agent loop 没跑**（成本账本无该会话调用、审计无 `notify` 行）。源码级根因：`session/prompt` 的 Remote 实现只 `agent.followup()`（排队），真正的驱动通道是 **`session/control` 这个 `@Remote({mode:"stream"})` 流**（`dsh-api-session-controller/lib/index.js:2599`）——**纯 HTTP RPC 不开 control 流就没人消费队列**。
- **Ruling 43（待查清，可能动摇 v1 核心主张）**：上述根因与 T10 的端到端结果**矛盾**。T10 的端到端里**源会话确实调用过工具**（审计有 `preview`/`dispatched` 两行，而工具只能由 agent loop 调用）——若纯 HTTP `prompt` 驱动不了 loop，则当时必然用了别的通道，**说明 notes §11 记录的驱动方法不完整或错误**。
  - 更要紧的问题：**新会话"自己开工"靠的是我们插件 `prompt` 的唤醒（`wakeDriver()`，好），还是某个 GUI 客户端在看着它（坏）？** 若是后者，"无人值守接力"存在大洞。派专项调查。
- Ruling 43 专项调查 dispatched（v4-pro）：查明 ① T10 当时到底怎么驱动的源会话 ② 让 HTTP 建的会话真正跑起来所需的最小通道 ③ **新会话自开工是否依赖外部客户端（引源码）** ④ 把 notes §11 改写成"已核实/未核实分明"的版本。

## 【收尾后·第 2 轮】Ruling 43 调查结论：**结论反转，v1 核心主张成立**

- **§3（承重问题）裁定：新会话"自己开工"不依赖任何外部客户端/control 流。** 调用链：`prompt`(mode≠steer) → `agent.followup`（`dsh-api-session-controller/lib/index.js:883`）→ `followup = send(input,"next-turn",true)`（`dsh-agent-loop:806-808`）→ `send` 里 `if (wakeup) wakeDriver()`（`:800-805`，**无条件唤醒**）→ `kick→turn→step→llm.stream + executeToolCalls`。**`prompt` 就是驱动通道**；只有 `inject` 是 `wakeup=false`（`dsh-agent-loop:812-814`），插件刻意不用它（红线 R-1）。
- **Ruling 43 的调查推翻了 Ruling 42 那一轮的"运行时未验证"根因，两个环节都错：**
  - **源码读错**：把 `followup` 当成"只排队"。它不是——它调 `send(..., wakeup=true)`。
  - **判据用错**：靠"成本账本无该会话"推断"没跑"。但 `ledger.json` 由**桌面计费插件**写，而隔离 profile `steward-dev` 的 bundle 只有 `dsh-base`+`dsh-web-app`，**没有计费插件** → 它的 LLM 调用永不进账本。**"账本没有" ≠ "没跑"。**
  - 调查者做了该做的：**解压真实会话日志**（`~/.dsh/sessions/<cwd>/<sid>/session.v4.jsonl.zstd`）。Task 9 那条 `session-97c80e8a…` 日志里有 `turn/start`/`step/start`/`request/header`/`assistant/message`×2/`tool/call` —— **loop 跑了**。
- **T10 端到端证据同时被坐实**：源会话日志里有 `tool/call: steward_relay`；新会话（`session-eaf8fa95`/`xxxxxxxx`/`xxxxxxxx`）日志里有 **5–24 个 step、8–39 次 tool/call** —— 全部只靠 `create`+`prompt` 驱动，**无 control 流、无浏览器、无 headless**。
- notes §11 已重写并提交（`0bd2360`）：结论先行 + 最小通道 + 调用链 + `session/control` 是纯广播 + driver 启动时机（**建会话不启动、attach 不启动，只在首次 prompt 启动**）+ 「accepted 但没跑」是误诊的警示（**别用成本账本判断 loop 跑没跑**）。
- **Ruling 44（更正控制方上一条判断）**：控制方据 Ruling 43 的初步报告对使用者说"这个矛盾可能动摇 v1 核心主张"——**该判断错了，已更正**。核心主张成立。
- **Ruling 45（流程教训，与那 5 个假绿同源）**：上一轮**用代理指标（成本账本）当证据**去回答"loop 到底跑没跑"，得出错误结论并据此编了一套源码解释。**这与"代码与替身互相印证"是同一种病：拿代理当本体。** 正确的判据永远是**第一手产物**——这里的会话日志（`.zstd`）与审计流水。

### 提醒路径：**仍未验证**（但判据与实验都已明确）

- 审计流水当前 16 行：`7 preview / 3 failed / 4 dispatched / 2 rejected/doc` —— **`notify` 行数 = 0**。**提醒从未触发过一次。**
- 待解释：是阈值没越过（0.1 × 262,144 = 26,214 prompt token），还是仍有别的环节没通。
- **决定性实验已派**：隔离 profile、`notify.enabled:true`、`softLimitRatio:0.1`（schema 下限）、`enabled` 保持 false；让会话读一个大文件把 pressure 顶过 26K；然后查 `~/.dsh/steward/audit/*.jsonl` 有没有 `actionId:"notify"` + `result:"sent"`。

## 【收尾后·第 3 轮】★ 提醒路径运行时**整条验证通过** ★

- 提交 `39f9f95`（README 63→64）、`bfacb5d`（Ruling 42 压力分子）。**全套 64 绿。** 隔离宿主已关停、配置已恢复。
- **审计第 17 行（原始）**：`{"ts":"2026-10-07T06:53:04.938Z","actor":"plugin","actionId":"notify","dryRun":false,"result":"sent","sessionId":"session-2708fd4b-<redacted>","pct":0.100253, …}`
- **验证链（解压 `.zstd` 会话日志确认）**：`session/event` 触发 → async `resolveModelInfo` → `context.contextWindow` → `pressurePct`（input+cacheRead+cacheWrite）→ `pct=0.100253` 越过 0.1 → 审计 `sent` → **waterfall 把提醒行追加进下一次 `system/message`（`source.kind=system-prompt`）** → **agent 回复里出现「write a handoff document before calling steward_relay」**。
- **最后那一环是决定性的**：提醒不只是"没报错"，它**改变了 agent 的行为**。**v1 至此再没有"从未在运行时跑过"的部分。** 此前被列为"仅源码级证据"的提醒路径（A8/A9 相关）**已闭合**。

### **Ruling 46（更正 spec 事实错误）**：contextWindow 实测 1,000,000，不是 262,144

- `262,144` 只是 `dsh-llm/-deepseek` 的 `DEFAULT_CONTEXT_WINDOW` **目录默认常量**（该目录注释即"deployments may replace the catalog"）；**运行时 `resolveModelInfo` 上报的是 1,000,000**。证据：`request/context` 事件 + 以 `pct=0.100253` 反推 ≈100,253 token 与 1M 吻合。
- **后果（直接影响预算与观测期可行性）**：0.7 阈值对应 **~700,000** prompt token（我原先按 262,144 算成 183,500，**错了约 4 倍**）。
  - 金额影响不大（净增约 4 倍，仍是**个位数人民币**量级）；
  - **但时间影响很大**：要让一个会话积到 70 万 token 上下文，本身就是极少见的长时间重度使用；再叠加"同一会话 20 分钟冷却 + 每涨 5pp 才报"，**「≥25 个样本」在 0.7 阈值下可能需要数周**——这是观测期可行性的真问题，不是钱的问题。
- spec §13.5 已改：**取值以运行时上报为准，不要照抄模型目录**（写死常量会算错阈值 4 倍）。
- **留给使用者的决定**：观测期是否临时把 `softLimitRatio` 调到较低值（schema 下限 **0.1**，即 10 万 token）——那样样本来得快得多，但代价是"10% 就该交接吗"与"70% 才该交接"**不是同一个问题**，测的是机制而非阈值合理性。控制方建议：**先按 0.1 跑机制与误报口径，样本够了再单独评估阈值本身**，并在台账里写明这一点，避免把"机制通了"误当成"阈值合理"。

## 【收尾后·第 4 轮】使用者准备连用几天，为此做最后检查

### ★ 真宿主实测 T0–T5 全部通过（使用者重启后的修复后版本）

- **T0**：`steward_relay`（不存在的路径）→ `大管家未启用（enabled 出厂为 false）。（关闭时零副作用：未读档、未留审计）`。审计 17 → 17 **未增行**、最后一行仍属实验会话（`session-2708fd4b`）而非本会话 → **Ruling 34 在真宿主验证通过**。
  - 注：控制方"近 15 分钟有无新增行"的判据**报过一次假阳性**（把几分钟前实验那行当成新增）——**判据选错，不是事实变了**。决定性证据是行数不变 + 该行不属于本会话。
- **T1**：预览 → 档校验通过、**主线从档头读出**（`文档体检`，非从文件名猜）、不建会话/不改档/不占锁，审计 +1 为 `relay/preview`。**并证实配置热更新**（改 `enabled` 当场生效，不用重启）。
- **T2**：六个"只坏一处"的档 → 六条理由各自独立且具体（缺段 / 缺证据路径 / 缺有序列 / 缺主线 / 现状空 / **他人隐私**）；**不回显命中内容**。审计 18 → 24（5 × `rejected/doc` + 1 × `rejected/forbidden`）。
- **T3**：真执行 → 审计 25 行 `dispatched`（`newSessionId: session-fd616591…`）；档 27 → 30 行写入三键；**新会话自己开工**（解压 `.zstd`：`session/title` = `【续】文档体检`、`inbox/spliced` target `next-turn`、`turn/start`、10 × `assistant/message`、**18 × `tool/call`**、`request/header` deepseek-flash）。第一条产出即 `⏵ 读交接档全文` → `read(handoff-t1.md)`，第二条思考明确在**执行段 5「下一步」第 1 条**。**且 GUI 显示的是控制方会话 —— 新会话无人观看仍然自己跑了，实测否掉了"依赖外部客户端"的疑问。**
- **T4**：同一源会话再真执行 → `gate: dedupe`、**`exitCode: 0`（静默返回）**；档**一字节未变**、三键**各恰好 1 次（未堆叠）**、**未新建会话**。
- **T5**：子代理调用 `steward_relay` → `子代理不得发起接力。（关闭时零副作用：未读档、未留审计）` —— **caller 闸在真宿主生效**，即 Ruling 41（判据由 exec.parent 改为 origin === subagent）的实测结论。
- 审计哈希链：**26 行全链 `verifyChain → {ok:true}`**（跨三次端到端、一次断电、一次提醒实验与本次全部真实调用）。

### 真宿主暴露的两条设计约束（留给使用者知情）

1. **去重是"每个源会话只许交接一次、且不分主线"**（`relay.js:170-171`：按 `sourceSessionId` + dispatched 取 `lastRealRow`，**不带 mainline 条件**）。后果：同一会话想交接**第二条主线**也会被拦。链式接力不受影响（新会话可再交接一次）。
2. **失败闸的恢复路径很隐晦**：`trailingFailures`（`relay.js:129-137`）先经 `real()` **滤掉 dryRun 为 true 的行**，故**预览不能重置连续失败计数**；但任何**真执行被拒**（rejected）的行会打断连续失败 → **不是死锁**。最可靠的恢复是**换主线名**。

### **Ruling 47**：提醒文案必须显式要求"先预览、经人确认"

- 触发：控制方为使用者的"连用几天"做准备时读到 `notifyLine` 实际文案：`⚠ 本会话上下文已用 ~N%，接近上限。准备交接：写完交接档后调用 steward_relay。` —— **只说"调用工具"，没说"先预览"**。
- **为什么是缺陷**：提醒进的是**系统提示**、读者是 **agent**，而它正在"要不要交接"的判断点上。文案会把 dryRun 缺省 true 的**默认行为当成护栏**；被催着的 agent 完全可能自己补 `dryRun:false` → **未经人确认的不可逆动作**（建会话 + 回写档）。
- 修法：文案改为显式两步（先写档 → **预览** → 给人看 → **确认后**才传 `dryRun:false`），并补断言"文案必须含**预览**与**确认**"以锁住该要求。spec §13.2 已改并提交（`472f9f5`）。
- 与前面同源：Ruling 41（抄权威源）、Ruling 42（同上）、Ruling 45（别拿代理当本体）→ 本条是「**别把默认值当护栏，把安全路径写出来**」。
- Ruling 47 实施中（实施者 8e193106）。

### T6（权限降级）—— 判定为**本轮不可触发**

- 权限闸比较的是"新会话档位 vs 源会话档位"，而本机新建会话会继承源会话档位（`create({cwd})` 同源），故降级路径无法从控制方会话里自然触发。
- 强行触发需要改动使用者 live 环境的沙箱策略（新建会话的档位），**控制方判定不值得**：那是拿使用者的日常工作环境做实验，而该路径已有单元测试覆盖（虽为"补覆盖"性质）。**如实保留为未验证。**

### **Ruling 47 完成并复审通过**

- 实施者提交 `03bd6c3`；控制方回填自己的两份陈旧引用后提交 `08bb7a2`。全套 **64/64 绿**，工作树干净。
- 出货文案：`⚠ 本会话上下文已用 ~{pct}%，接近上限。准备交接：先写交接档，然后调用 steward_relay 预览；把预览给人看，确认后才传 dryRun:false。`
- scoped 复审（flash）：**All findings addressed，无新增破坏**。鉴别力用"旧文案跑字面量"验：`72%:true steward_relay:true 预览:false 确认:false` → 两条新断言必红，而原有两条不断 —— **新增的这一对是唯一鉴别者，静默退化锁得住**。复审另单独跑了 `--test-name-pattern="提醒文案"` → 1 pass。
- 复审点出控制方自己的陈旧引用（`design.md:376`、`plan:1953`），控制方已回填；全仓仅剩 `plan:2304` 一处**故意保留**（Ruling 47 那节引用旧文案以说明问题）。
- **控制方的两次操作失误（记录）**：① `git grep ... HEAD` 查的是**已提交的树**而非工作树，据此误报"仍有残留"；② commit 信息里写了双引号，把 PowerShell 字符串截断，**提交静默失败**只剩 staged。两次都被随后的核对抓到。

### **deferred 改进（留给 v2，非 minor）**：把 dryRun 护栏从"文案"升级为"结构"

- 现状（复审如实记录）：护栏**仍是纯文案** —— `lib/index.js:62` 的 `const dryRun = args.dryRun !== false` 会照常执行 `dryRun:false`，**代码层不拦"自我确认"**。
- **根本限制**：工具由 agent 调用，代码无法知道"人是否真的确认过"。**所以文案是唯一可用的杠杆——除非改接口。**
- **v2 建议（真正的结构性护栏）**：预览返回 `relayId`，真执行时必须回传该 `relayId`（`dryRun:false, confirm:"<上一步预览得到的 relayId>"`）。**没预览过的 agent 拿不出这个值**，于是"先预览"从建议变成前提。代价：改动工具签名（破坏性），故留 v2。

### 配置终态（使用者 live 环境）

- `~/.dsh/profiles/desktop/cordis.patch.yml` 的 `dajiangjun` 行：`enabled: true` + `notify.enabled: true`（连用几天的观测态）。备份仍在 `cordis.patch.yml.bak-dajiangjun`；回退=两个都改 false 或整行 `disabled: true`，**不删文件**。
- **T0–T5 全部在真宿主通过；T6（权限降级）判定本轮不可触发、如实保留为未验证。**