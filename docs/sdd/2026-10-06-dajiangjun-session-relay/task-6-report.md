# Task 6 报告：`lib/relay.js` — 权限序表与闸门判定

分支：`feat/session-relay`　提交：`7d683e9 feat(relay): 权限序表 + 7 道闸门判定（短路顺序与退出码）`

## 1. 实现了什么

往 `lib/relay.js` **纯追加**最后一块（Task 4/5 之上，零改动）：

| 符号 | 说明 |
| --- | --- |
| `MODE_SEQ` | `{ 'read-only': 0, 'workspace-write': 1, 'danger-full-access': 2 }` |
| `permissionOk(source, target)` | **R-2**：`MODE_SEQ[target] >= MODE_SEQ[source]`；任一侧未知 → `false`（fail-closed） |
| `dedupeKey(sourceSessionId)` | `` `relay|${sourceSessionId}` `` |
| `makeRelayId(sourceSessionId, date)` | `` `relay-${id}-${YYYYMMDDHHmm}` ``（本地时间，月/日/时/分补零） |
| `evaluateGates(input)` | 7 道闸门判定（spec §5 八道中除单飞锁），返回 `{ ok, gate?, reason?, code }` |

内部辅助（未导出）：`real`（过滤 `dryRun === true`）、`lastRealRow`（按 `ts` 取最后一条真实行）、`trailingFailures`（同主线**尾部连续**失败计数，遇非 `failed` 即断）。

短路顺序（实现即代码顺序，逐条 `return` 承重）：

```
配置不可读(5) → 总开关(5) → 调用者(2) → 档(5) → 禁写(5)
→ 去重(0) → 速率(5) → 失败(5) → 权限(5) → ok
```

`dryRun: true` 的审计行在**所有**计数路径上被 `real()` 一律剔除（去重 / 速率 / 失败三处），因此 agent 反复预览不会把自己喂进速率或失败闸。文件仍保持纯逻辑：零 I/O、不碰 `ctx`、无 `import`。

## 2. 写了什么测试

`test/relay.test.js` 追加 brief 里的 **14 条**（逐字转录，含其自带 import 行），无新增、无改动既有 9 条：

1. 序表：字符串比较会反转，序表不会（含未知档位 fail-closed）
2. 全部通过（`deepEqual(..., { ok: true, code: 0 })`）
3. 总开关关 → `total-switch` / code 5
4. 子代理发起 → `caller` / code 2
5. 配置不可读 → `config-unreadable` / code 5
6. 权限降级 → `permission` / code 5
7. 权限未知（`permission: null`）→ `permission`
8. 速率闸 20 分钟内第二次同主线 → `rate`
9. 速率闸忽略 `dryRun` 行 → 放行
10. 失败闸：同主线连续失败 2 次 → `failure`
11. 去重闸：同源会话已 dispatched → `dedupe`
12. 档不合格 → `doc`；禁写不合格 → `forbidden`
13. 闸门顺序：总开关先于一切
14. fail-closed 闸不受速率/失败闸计数影响（`doc` 先于 `rate`）

## 3. TDD 证据

### RED（先写测试，未实现）

命令：`& $node --test test/relay.test.js 2>&1 | Select-Object -Last 25`

```
file:///<repo>/test/relay.test.js:110
import { MODE_SEQ, dedupeKey, evaluateGates, permissionOk } from '../lib/relay.js'
         ^^^^^^^^
SyntaxError: The requested module '../lib/relay.js' does not provide an export named 'MODE_SEQ'
    at #asyncInstantiate (node:internal/modules/esm/module_job:455:21)
    ...
Node.js v24.21.0
✖ test\relay.test.js (113.902ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

为什么符合预期：追加的 14 条测试引用了尚未存在的四个导出。brief 预期文案是 `evaluateGates is not a function`（运行时 TypeError）；实测是**更早**的链接期报错 —— ESM 具名导入在模块实例化阶段就解析导出表，`MODE_SEQ` 缺失直接抛 `SyntaxError`，整个文件 0 条测试执行。两者都是「测试因缺实现而失败」，方向一致；此处如实记录差异，未为了让报错文案对上而改写测试。

### GREEN（实现后）

命令（单文件）：`& $node --test test/relay.test.js 2>&1 | Select-Object -Last 25`

```
✔ 干净文本通过；回环地址不算内网 (0.1352ms)
✔ 内网地址：公网链接放行、内网主机名拦住 (0.152ms)
✔ 命中项不回显命中内容 (0.2128ms)
✔ 序表：字符串比较会反转，序表不会 (0.2327ms)
✔ 全部通过 (0.9259ms)
✔ 总开关关 → 拒且零副作用 (0.1026ms)
✔ 子代理发起 → 拒，退出码 2 (0.7309ms)
✔ 配置不可读 → 拒（不许当全放行） (0.11ms)
✔ 权限降级 → 拒，退出码 5 (0.1095ms)
✔ 权限未知 → 拒 (0.079ms)
✔ 速率闸：20 分钟内第二次同主线 → 拒 (0.1351ms)
✔ 速率闸忽略 dryRun 行 (0.0926ms)
✔ 失败闸：同主线连续失败 2 次 → 拒 (0.1255ms)
✔ 去重闸：同一源会话已交接 → 拒 (0.0924ms)
✔ 档不合格 → 拒，退出码 5 (0.0837ms)
✔ 闸门顺序：总开关先于一切 (0.0668ms)
✔ fail-closed 闸不受速率/失败闸计数影响 (0.0707ms)
ℹ tests 23
ℹ suites 0
ℹ pass 23
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 150.2935ms
```

命令（全套）：`& $node --test 2>&1 | Select-Object -Last 18`

```
✔ updateJson 连续 100 次读-改-写不丢更新（进程内串行） (218.2655ms)
✔ writeJsonAtomic 留下完整 JSON，不留临时文件 (4.6591ms)
✔ 锁：抢不到返回 null (4.259ms)
✔ 锁：过期可抢占，且抢占必须留下审计行 (8.0855ms)
✔ 锁：损坏/半截的锁文件视为持有者已死，可被抢占（否则这把锁永久卡死） (10.8843ms)
✔ 锁：release 后可再抢 (3.9743ms)
ℹ tests 35
ℹ suites 0
ℹ pass 35
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1025.8438ms
```

**23/23（relay 单文件）与 35/35（全套）全绿，输出干净**：无 `Warning`、无 `ℹ cancelled`、无未处理拒绝、无跳过项。（按要求用单文件/默认形式，未用 `node --test test/` 目录形式。）

### 额外自检（未入库，跑完即删）

一次性脚本 `_scratch/tmp-relay-extra-check.mjs`（`_scratch/` 是 .gitignore 目录，跑完已 `Remove-Item`），覆盖 brief 14 条之外的边界，全部通过：

- `'read-only' > 'danger-full-access'` 在字典序下确实为真 —— 证明字符串比较会反转，而 `permissionOk` 不依赖它；`permissionOk('read-only','READ-ONLY') === false`（大小写不归一，未知即拒）。
- `dedupeKey('session-src') === 'relay|session-src'`；`makeRelayId('session-src', new Date(2026,0,5,3,7)) === 'relay-session-src-202601050307'`（补零正确）。
- 3 条 `dryRun: true` 的 `failed` 行**不**触发失败闸（返回 `{ ok: true, code: 0 }`）—— 直接钉“预览把自己锁死”那条后果。
- 失败游程被非 `failed` 行打断：`failed / preview / failed` → 只算 1 次，放行。
- `dryRun: true` 的 `dispatched` 行不触发去重闸。
- 别的 `actionId`（`other`）的失败行不计入。
- `config: undefined` → `config-unreadable`（先于一切）；`config: { enabled: 'true' }` → `total-switch`（只认字面 `true`）。
- 速率边界：恰好 20 分钟整 → 放行（`gapMin < limit` 才拒）。
- 去重闸 `code: 0`、reason 文案与 brief 逐字一致；同一行既满足去重又满足速率时报 `dedupe`（去重在前）。
- 失败闸先于权限闸：速率不干扰（30 分钟前）时两闸同挂，报 `failure`。

## 4. 未改动 Task 4/5 的确认（怎么查的）

- `& $git diff --numstat` → `73  0  lib/relay.js`、`109  0  test/relay.test.js`：**182 行插入，0 行删除**。
- `& $git diff -U0 | Select-String '^-[^-]'` → **无输出**，即 diff 里不存在任何被移除的内容行。
- 结论：`lib/relay.js` 原 101 行与 `test/relay.test.js` 原 108 行**逐字节未变**，新增内容一律在文件尾。`SECTIONS` / `HEADING` / `ORDERED` / `HAS_EVIDENCE` / `parseDoc` / `sectionText` / `validateDoc` / `resolveMainline` / `FORBIDDEN` / `checkForbidden` 十个符号全部原样；既有 9 条测试原样。`lib/store.js`、`test/store.test.js`、`package.json` 未进入本次提交（工作区最终 `git status` 干净）。未碰 `~/.dsh/profiles/desktop/`。

## 5. `permissionOk` 用序表的确认

```js
export const MODE_SEQ = { 'read-only': 0, 'workspace-write': 1, 'danger-full-access': 2 }
export function permissionOk(sourceMode, targetMode) {
  const a = MODE_SEQ[sourceMode]
  const b = MODE_SEQ[targetMode]
  if (a === undefined || b === undefined) return false
  return b >= a
}
```

- 全函数**没有一处字符串比较**：比较对象是 `MODE_SEQ[...]` 取出的 number，`undefined` 提前 `return false`（fail-closed）。
- 测试 1 同时钉了两侧：`MODE_SEQ['danger-full-access'] > MODE_SEQ['read-only']`（序表方向正确）与 `permissionOk('danger-full-access','read-only') === false`（降级被拒）。若换成字典序 `'read-only' > 'danger-full-access'` 会成立，只读就被当最高档放行 —— 额外自检第 1 条实测了这个反转确实存在，反证当前实现没有走它。
- `permissionOk('workspace-write','unknown-mode') === false` 与 `(undefined, ...)` / `(..., undefined)` / 大小写不符均 `false`。

## 6. 变更文件

| 文件 | 变更 |
| --- | --- |
| `lib/relay.js` | +73 行（纯追加） |
| `test/relay.test.js` | +109 行（纯追加 14 条测试 + 其 import/夹具） |

提交：`7d683e9`（`feat/session-relay`），`git status` 干净。

## 7. 自审发现

1. **唯一一处对 brief 的有意偏离：docblock 里的顺序注释。** brief 原文注释写 `短路顺序：总开关 → 调用者 → 配置 → 档 → …`，但紧接的代码第一行就是 `config === null || undefined → config-unreadable`，控制器下发的顺序也是「配置不可读 → 总开关 → 调用者 → …」。注释与承重代码矛盾，属实质性误导（未来有人按注释重排就会踩到 fail-open）。我把注释改成实际顺序 `配置不可读 → 总开关 → 调用者 → 档 → 禁写 → 去重 → 速率 → 失败 → 权限`，**代码一行未动**，其余全部逐字照抄 brief。若审查认为应严格照抄注释，那条注释回退即可，不影响任何测试。
2. 追加的测试 import 里含未使用的 `dedupeKey`（brief 逐字如此），14 条测试也确实没有覆盖 `dedupeKey` / `makeRelayId`。按「逐字转录、测试数必须为 23」的要求保留原样，未自行加测试；这两者的行为由上面的额外自检确认。若希望它们进正式测试，需要控制器授权加测试（会变成 23 → 25）。
3. 未发现死代码：`real` / `lastRealRow` / `trailingFailures` 三个辅助函数都被 `evaluateGates` 用到；`MODE_SEQ`、`dedupeKey`、`makeRelayId` 是本任务契约要产出的对外 API（Task 7/8 才接线），当前文件内无人调用属预期，不算死代码。
4. 拒绝理由文案均可行动：`rate` 带实际间隔分钟数与阈值、`failure` 带连续失败次数、`permission` 带源→新档位、`dedupe` 明说「退出码 0 静默返回」。测试只断言 `gate` 与 `code`，`reason` 不是断言目标，措辞微调不会挂测试。
5. 单飞锁不在本文件（由 Task 3 的锁 + Task 8 的调用负责），故 8 道闸门这里只有 7 道 —— 与契约一致，不是遗漏。

## 8. 问题与顾虑

- 无阻塞。唯一需要审查者裁定的点是上面第 1 条的注释偏离（改注释 vs 照抄注释）。
- 环境备注（供后续任务参考）：`& $node --test test/relay.test.js` 是有效形式；目录形式会把测试文件当模块 `require` 而 0 条执行，本任务未使用。RED 阶段的实际报错是 ESM 链接期 `SyntaxError`（比 brief 预期的 `TypeError` 更早），已在第 3 节如实记录。
