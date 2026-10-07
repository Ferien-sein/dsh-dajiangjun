### Task 10: 端到端（隔离 profile，含失败注入）+ 上 desktop

**Files:**
- Create: `README.md`
- Create: `lib/types/index.d.ts`
- Modify: `docs/superpowers/specs/2026-10-06-dajiangjun-session-relay-design.md`（§10 假设表标注实测结果）

**Interfaces:**
- Consumes: 全部
- Produces: 一份可复跑的端到端记录（写进 spec 的验证小节）

- [ ] **Step 1: 写 `README.md` 与类型声明**

`README.md` 必含：一句话是什么、怎么装（`dsh plugin --profile <p> add <path>`）、`Config` 字段表（含"出厂全关"）、工具签名与 dryRun 语义、**红线 R-1**、以及一条明确声明：**"兼容 DeepSeek Harness / 构建于 DeepSeek Harness 之上"，不代表官方背书**。

`lib/types/index.d.ts`：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { Schema } from '@deepseek-ai/schemastery'

export declare const name: 'dajiangjun'
export declare const inject: string[]
export declare const Config: Schema<any>
export declare function apply(ctx: Context, config: any): void
```

- [ ] **Step 2: 装进隔离 profile 并跑真链**

**优先走非交互路线。本步骤必须尽量不依赖人肉点 GUI。**

先试 headless（`dsh headless "<task>"` 会答一个任务、打印结果、然后退出）：

```powershell
dsh plugin --profile headless add '<repo>'
dsh headless "先写一份合格的七段交接档到 <临时路径>，然后调用 steward_relay 工具：先不带 dryRun 参数预览，再带 dryRun:false 真执行。把两次的工具返回原文打印出来。"
```

若 `headless` profile 存在且能装上本插件，**这条就能无人值守地把真链跑完并打印结果——这是首选路线。**

**若 headless 不可用**（profile 不存在 / 装不进 / 驱动不了工具 / 拿不到可观测输出），**不要**改用"打开 GUI 点点看"去凑证据，**也不要**用别的间接信号代替。**停下来报 BLOCKED**，说清卡在哪一步、试了什么、需要什么。端到端验证需要人肉介入时，协调它是控制方与使用者的事，不是你硬凑的范围。

**绝不允许**（任一违反即视为伪造证据）：
- 把没跑过的链写成跑过了
- 把单元测试通过当成端到端通过
- 把"预览返回了 `preview`"当成"新会话真的自己开工了"

Expected（能跑到哪条就报哪条，跑不到的照实写"未验证"）：
- 预览返回 `kind: 'preview'`，且**没有**新会话出现
- 真执行返回 `kind: 'dispatched'`
- 出现一个标题为 `【续】<主线名>` 的新会话
- 该新会话**自己开始跑**（状态 `running`，随后有 assistant 产出）← **这是 v1 的存在理由，必须真的看到**
- `~/.dsh/steward/audit/<当月>.jsonl` 多出一行 `result: 'dispatched'`
- 若插件在 profile 里起不来：先看宿主日志；**装在隔离 profile 里起不来不算阻塞**，是 Step 1 该查清的东西，照实报告即可

- [ ] **Step 3: 失败注入三例**

| # | 注入 | 期望 | 无人值守可复现？ |
|---|---|---|---|
| 1 | 投递前杀进程（新会话已建、未投递） | 审计无 `dispatched`；退出码 3 或 5；档头无回写；重跑因去重键未命中而**允许**再试 | 难——要精确掐在 create 与 prompt 之间 |
| 2 | `docPath` 指向不存在的文件 | `kind: 'rejected'`、`exitCode: 5`、`gate: 'doc'`、**零新会话** | **容易**，且完全不产生副作用 |
| 3 | 在只读档位的会话里调用 | `gate: 'permission'`、`exitCode: 5`、**未投递**、已建会话留痕待人工处置 | 需能指定沙箱档位起会话 |

**#2 必做**（走 rejection 分支、零副作用，无人值守最容易复现）。#1 与 #3 能通过 headless/脚本复现就做；**做不到就如实写"未能验证"，并说明缺什么条件**——**不要**用改代码、打桩或手工构造返回值来伪造这三条。

这一节的价值不是"三条都绿"，而是**如实说清哪几条在无人值守下复现得了**。

- [ ] **Step 4: 记下实测结论并更新 spec**

把三条注入的实际结果、以及 A1/A2/A4/A5/A6/A8/A9 的实测结论写进 spec §10，**未验证的照实写"未验证"**。

- [ ] **Step 5: 上 `desktop` profile（先备份）**

```powershell
Copy-Item "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml" "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml.bak-dajiangjun"
dsh plugin --profile desktop add '<repo>'
```
然后把下面这段**追加**到 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾（**不是覆盖**）：

```yaml
- insert:
    - id: dajiangjun
      name: dsh-dajiangjun
      config:
        enabled: false
        notify:
          enabled: false
```

刷新 GUI 验证工具出现。**出厂全关**——要真用必须先显式打开 `enabled`。

**若宿主起不来**（DSH 启动全有或全无）：用备份还原 `cordis.patch.yml`，或把那行改成 `disabled: true`，**不要删文件**。

- [ ] **Step 6: Commit**

```powershell
& $git -C '<repo>' add README.md lib/types/index.d.ts docs/superpowers/specs
& $git -C '<repo>' commit -m "docs: README + 类型声明 + 端到端实测结论（含三条失败注入）"
```

---

## 观测期（计划之后，不是任务）

上 desktop 后 **≥3 个自然日**：只开 `notify.enabled`，**不开** `enabled`（即只提醒、不真交接）。第一 KPI = 误报率（标记误报数 / 总提醒数），逐日记。

放行门槛（spec 引文档 07）：误报率 <5% **且**累计样本 ≥25 条才允许打开 `enabled`；样本不足不得放行。达标后放行当天只做"改 `cordis.patch.yml` 里的开关 + 留痕"，不改代码。
