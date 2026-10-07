# Task 8 报告：`lib/index.js` — 真执行路径

## 实现内容

按 brief 的 7 个 Step 完成：

1. **`test/index.test.js`**：追加 3 条测试（`投递必须用 queue`、`单飞并发 10 次只有 1 次真执行`、`回写档头不堆叠`），并补 `readFileSync` / `dispatchRelay` 导入。
2. **`lib/index.js`**：
   - 导入补 `permissionOk`（relay.js）、`acquireLock` / `releaseLock` / `writeTextAtomic`（store.js）。`readFileSync` 原本已在顶部，无需再补。
   - 新增 `rewriteHeader()`（幂等回写档头）与 `dispatchRelay()`（§3 的 ⑦–⑫ 步）。
   - 把 `runRelay` 尾段替换为 `if (dryRun) return preview; return dispatchRelay(...)`，并把预览审计行包进 `dryRun` 分支（否则真执行路径会多写一行幽灵 `preview` 审计）。

## 测试与结果

- 单文件 `& $node --test test/index.test.js` → **9 pass / 0 fail**
- 全套 `& $node --test` → **44 pass / 0 fail**（store 12 + relay 23 + index 9）
- 输出干净：无 warning / ExperimentalWarning / deprecation。

## TDD 证据

### RED（实现前）

命令：`& $node --test test/index.test.js 2>&1 | Select-Object -First 30`

```
file:///<repo>/test/index.test.js:6
import { Config, apply, dispatchRelay } from '../lib/index.js'
                        ^^^^^^^^^^^^^
SyntaxError: The requested module '../lib/index.js' does not provide an export named 'dispatchRelay'
...
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

预期失败：`dispatchRelay` 尚未导出，模块加载即抛（与 brief 预期 "dispatchRelay is not a function" 同一根因——导出不存在）。

### GREEN（实现后）

命令：`& $node --test test/index.test.js 2>&1 | Select-Object -Last 25`

```
✔ 投递必须用 queue，绝不能用 inject
✔ 单飞：同一源会话并发 10 次，只有 1 次真执行
✔ 回写档头：三个键进「头部」段，且重复执行不堆叠
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

全套 `& $node --test`：`ℹ tests 44 / pass 44 / fail 0`。

## 三条红线确认

- **R-1**：`const mode = 'queue'`（`lib/index.js` 第 173 行），后跟 `if (mode !== 'queue' && mode !== 'steer') throw`（第 174 行），位于 `prompt` 调用之前；无任何 `'inject'`。测试 `投递必须用 queue` 用 `assert.equal(mode,'queue')` + `assert.notEqual(mode,'inject')` 钉死。
- **R-2**：权限回读两侧均经 `ctx.sessionController.resolveAgent(id)` 取 `.session`，再 `ctx.sessionProjections.stateOf(session, 'sandboxMode')`，比较走 `permissionOk(sourceMode, targetMode)`（`relay.js` 序表）。无字符串比较。
- **锁签名**：`acquireLock(home, lockKey, { ttlMs: config.lockTtlMs ?? 120000 })` 与 `releaseLock(home, lockKey)`——传 `home` + `key`。**未 import `lockPath`**，也**未 import `dedupeKey`**。抢占审计行由 `acquireLock` 自己写（`actionId: 'lock-steal'`），调用点没有补第二行（仅有一句注释说明）。

## 未改越界文件

`git status --short` 仅 `M lib/index.js`、`M test/index.test.js`；`git diff --stat` 共 2 文件 139 增 15 删。未触碰 `lib/store.js`、`lib/relay.js`、`test/store.test.js`、`test/relay.test.js`、`package.json`，也未触碰 `~/.dsh/profiles/desktop/`。

## 变更文件

- `lib/index.js`（+101/-8）
- `test/index.test.js`（+53/-2）

## 自审发现

- 无死代码、无重复 lock-steal 审计行。
- `runRelay` 尾段我把预览审计包进 `if (dryRun)`：brief Step 4 只给了两行替换，若照字面把 `appendAudit` 一起删掉，会破坏 Task 7 已过的 `dryRun 缺省为 true`（断言预览留一行审计）。包进分支既保住该审计、又避免真执行路径多写幽灵 preview 行。
- 遗留一条无害的历史注释（第 97 行「真执行分支由 Task 8 补上」），语义仍成立，未改动以最小化 diff。

## 提交

- `f7de8a2` feat: 真执行路径（create → 权限断言 → rename → queue 投递 → 审计）

## 问题/顾虑

无阻塞问题。唯一需要 reviewer 留意的点即上面第 2 条自审发现（`appendAudit` 包进 `if (dryRun)` 是对 brief 两行替换的最小必要修正，否则破坏既有测试）。

---

## Fix Report（审查 Ruling 23 / Ruling 24）

审查结论 Spec compliant ✅ / Task quality Approved，无 Critical；另下 2 个 Important（均为 brief 自身问题，非我返工对象）。按修订后的 brief 修复如下。

### Ruling 23（幂等测试是空的）—— 修

`test/index.test.js` 的「回写档头」测试：第二次改为喂**改后**的档文本 `text: readFileSync(docPath, 'utf8')`，并对 `链` / `接手会话` / `已交接` 三键各断言一次 `length === 1`（原来只断言 `链` 一键、且两次都喂原始 `GOOD_DOC`，`rewriteHeader` 的 KEY 去重分支从未被走到）。

### Ruling 24（catch 不点名可能已投递的会话）—— 修

`lib/index.js` 的 `dispatchRelay` catch 分支：`newId` 存在时在用户可见文案里点名该会话，并提示「失败可能发生在其收到投递之后，请人工核查该会话再决定是否重试」；`newId` 不存在时维持原样。`exitCode` 逻辑（`newId ? 3 : 1`）不变。

### 覆盖的测试与输出

命令：`& $node --test test/index.test.js` → **9 pass / 0 fail**
命令：`& $node --test` → **44 pass / 0 fail**（store 12 + relay 23 + index 9），输出干净。

### RED / 鉴别力证据

Ruling 23 的缺陷在「测试没覆盖」而非「实现有错」，所以修复后的测试在旧实现下**照常通过**（不红）——先只改测试后跑一次，确认 `回写档头` 仍 ✔、`tests 9 / pass 9`：

```
✔ 回写档头：三个键进「头部」段，且重复执行不堆叠
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

为证明新测试**真的有鉴别力**，临时把 `rewriteHeader` 的 KEY 过滤注释掉（`filter((l) => true)`），再跑一次——新测试当场变红：

```
✖ 回写档头：三个键进「头部」段，且重复执行不堆叠
  AssertionError [ERR_ASSERTION]: 链键被堆叠了
ℹ tests 9
ℹ pass 8
ℹ fail 1
```

验证完已**还原**过滤（`filter((l) => !KEY.test(l))`），随后恢复全绿。

### 本轮变更文件

- `lib/index.js`（+6/-1，仅 catch 分支）
- `test/index.test.js`（+5/-1，仅「回写档头」测试）

### 本轮提交

- `c498f61` fix: 幂等测试真覆盖去重分支 + catch 点名可能已投递的会话（Ruling 23/24）

（注：`c5fb71b`、`f166d79` 是控制方对计划的修正提交，非本次返工对象。）
