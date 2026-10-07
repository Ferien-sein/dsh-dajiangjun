# 大管家 v1 · SDD 过程记录

**这份目录是「大管家」插件 v1 的完整施工记录：任务怎么派的、实现者汇报了什么、评审挑出了什么、控制方做了哪些裁决。**

[← 回到仓库首页](../../README.md) ｜ 中文 ｜ [English summary](#english-summary)

> 这些文件**不是事后编写的解说**，而是当时逐条追加的运行日志。文中保留了「这里原先判断错了、后来改成这样」的修订痕迹，也保留了未被采纳的方案——按上游方法论的看法，设计记录的价值往往就在「为什么否决了另一个方案」。

---

## 1. 这是什么

| | |
|---|---|
| 覆盖范围 | 2026-10-06 → 2026-10-07，10 张任务卡 + 全分支终审 |
| 文件数 / 体积 | 22 个文件，约 359 KB |
| 工作方式 | 控制方（Lead）拆卡派发 → **实现者**子智能体 → **评审者**子智能体独立评审 → 定点复审 → 修复轮（同一张卡最多 5 轮） |
| 产出 | `lib/` 641 行、`test/` 654 行、64 个测试；41 条裁决与 22 条遗留见 [裁决台账](../大管家-v1-裁决与遗留台账.md) |
| 谁写的 | 全部由 AI 智能体产出，人类只给了初始指令与少量事实澄清（见仓库 README §2） |

## 2. 发布前做了什么处理（重要）

本目录是原始记录的**脱敏副本**，改动仅限下面四类，正文一字未删：

| 处理 | 说明 |
|---|---|
| 本机路径 → 占位符 | 维护者本机的仓库绝对路径 → `<repo>`；DSH 安装目录 → `<dsh-install>`；git 可执行文件路径 → `<git>` |
| 维护者用户名 → 占位符 | Windows 用户目录下的真实用户名 → `<user>` |
| 会话标识 | 完整 session UUID 的**后半段**已遮蔽为 `<redacted>`；未在仓库 README 成本账里公开的会话前缀一律遮蔽为 `xxxxxxxx`。README 成本账已公开的 8 位前缀保留，以保证账目可对账 |
| commit 短哈希 | **已按提交信息逐条映射为发布后仓库的哈希**，因此文中每一个哈希都能直接在克隆下来的仓库里 `git show`（已逐条校验：可解析为 commit 的引用 44 处，其余 hex token 全部是会话 ID） |

另外：Git 提交身份是仓库维护者的账号（AI 借该身份提交），**提交身份不等于内容作者**。

## 3. 文件索引

| 文件 | 内容 | 体积 |
|---|---|---|
| [`progress.md`](progress.md) | 控制方运行日志：派发、裁决（Ruling 1–47）、抓到的缺陷、未验证项 | 105.8 KB |
| [`task-1-brief.md`](task-1-brief.md) | Task 1 派发词（控制方写给实现者的任务书） | 6.4 KB |
| [`task-1-report.md`](task-1-report.md) | Task 1 实现者报告 — 环境闸门 — 隔离 profile + 最小插件跑通（含 DSH API 侦察） | 6.6 KB |
| [`task-2-brief.md`](task-2-brief.md) | Task 2 派发词（控制方写给实现者的任务书） | 10.9 KB |
| [`task-2-report.md`](task-2-report.md) | Task 2 实现者报告 — `lib/store.js` — 审计流水与哈希链 | 14.3 KB |
| [`task-3-brief.md`](task-3-brief.md) | Task 3 派发词（控制方写给实现者的任务书） | 8.4 KB |
| [`task-3-report.md`](task-3-report.md) | Task 3 实现者报告 — `lib/store.js` — 原子写、单例锁、并发安全 | 23.7 KB |
| [`task-4-brief.md`](task-4-brief.md) | Task 4 派发词（控制方写给实现者的任务书） | 5.7 KB |
| [`task-4-report.md`](task-4-report.md) | Task 4 实现者报告 — `lib/relay.js` — 交接档结构契约与主线名 | 9.6 KB |
| [`task-5-brief.md`](task-5-brief.md) | Task 5 派发词（控制方写给实现者的任务书） | 4.9 KB |
| [`task-5-report.md`](task-5-report.md) | Task 5 实现者报告 — `lib/relay.js` — 四类禁写内容 | 16.9 KB |
| [`task-6-brief.md`](task-6-brief.md) | Task 6 派发词（控制方写给实现者的任务书） | 10.1 KB |
| [`task-6-report.md`](task-6-report.md) | Task 6 实现者报告 — `lib/relay.js` — 权限序表与闸门判定 | 11.1 KB |
| [`task-7-brief.md`](task-7-brief.md) | Task 7 派发词（控制方写给实现者的任务书） | 13.9 KB |
| [`task-7-report.md`](task-7-report.md) | Task 7 实现者报告 — `lib/index.js` — Config、工具注册、dryRun 预览路径 | 11.8 KB |
| [`task-8-brief.md`](task-8-brief.md) | Task 8 派发词（控制方写给实现者的任务书） | 11.2 KB |
| [`task-8-report.md`](task-8-report.md) | Task 8 实现者报告 — `lib/index.js` — 真执行路径 | 6.4 KB |
| [`task-9-brief.md`](task-9-brief.md) | Task 9 派发词（控制方写给实现者的任务书） | 13.7 KB |
| [`task-9-report.md`](task-9-report.md) | Task 9 实现者报告 — 主动提醒（阈值感知） | 22.9 KB |
| [`task-10-brief.md`](task-10-brief.md) | Task 10 派发词（控制方写给实现者的任务书） | 5.6 KB |
| [`task-10-report.md`](task-10-report.md) | Task 10 实现者报告 — 端到端（隔离 profile，含失败注入）+ 上 desktop | 29.4 KB |

## 4. 评审包索引

21 个评审包**没有收录原文件**：它们是本仓库代码的 diff，与 git 历史重复，且其中一个就占 215 KB。下表给出映射到**当前仓库**的提交区间，任何人都可以自己重现：

```powershell
git diff <区间左端> <区间右端>      # 例：git diff 933bfa0..6b23071
```

| # | 评审包（当前哈希） | 覆盖 | 原始体积 |
|---:|---|---|---:|
| 1 | `review-02be073..41d916a.diff` | — | 6.0 KB |
| 2 | `review-0862bf5..f15b832.diff` | — | 19.7 KB |
| 3 | `review-16c972e..d7f420e.diff` | — | 5.2 KB |
| 4 | `review-27c7fa1..e14f7ca.diff` | — | 15.4 KB |
| 5 | `review-41d916a..16c972e.diff` | — | 7.3 KB |
| 6 | `review-472f9f5..03bd6c3.diff` | — | 3.5 KB |
| 7 | `review-622bb54..bb197e7.diff` | — | 6.7 KB |
| 8 | `review-7d683e9..0eaf5da.diff` | — | 12.9 KB |
| 9 | `review-933bfa0..6b23071.diff` | — | 10.6 KB |
| 10 | `review-933bfa0..d5bb5ad.diff` | — | 210.6 KB |
| 11 | `review-95aecc1..f9ac4f7.diff` | — | 27.6 KB |
| 12 | `review-bc3aa0e..16c972e.diff` | — | 7.8 KB |
| 13 | `review-bc5492b..95aecc1.diff` | — | 4.2 KB |
| 14 | `review-bcfc99b..637b1b3.diff` | — | 6.9 KB |
| 15 | `review-c498f61..c69ad06.diff` | — | 22.8 KB |
| 16 | `review-c5fb71b..c498f61.diff` | — | 3.6 KB |
| 17 | `review-d4ffe8b..f7de8a2.diff` | — | 10.0 KB |
| 18 | `review-d51953b..0eaf5da.diff` | — | 11.1 KB |
| 19 | `review-d7f420e..dad1542.diff` | — | 4.4 KB |
| 20 | `review-dad1542..7d683e9.diff` | — | 9.2 KB |
| 21 | `review-edfdea1..dad1542.diff` | — | 3.9 KB |

## 5. 未收录什么，为什么

| 未收录 | 原因 |
|---|---|
| 21 个 `review-*.diff` 原始评审包 | 内容是仓库自身代码的 diff，与 git 历史重复（合计约 409 KB）。区间已在上表给出，可随时重现 |
| 控制方下发给实现者的完整 prompt 原文 | 派发词的**骨架**已在各 `task-N-brief.md` 里；完整 prompt 还包含大段本机上下文，公开收益低于噪声 |
| 会话原始日志 | 含个人内容与无关会话，不属于本项目 |

## 6. 怎么读

- **只想知道这套东西怎么运转** → 读 `progress.md`。它按时间顺序记录每一次派发、每一条裁决与每处「判断错了再改回来」。
- **想知道任务书怎么写才不返工** → 对比 `task-N-brief.md` 与同号 `task-N-report.md`；报告里的「范围外观察」与「未验证项」两节尤其值得看。
- **想知道评审到底能不能抓到东西** → 看 `progress.md` 里记录的那 10 个被流程抓出的真实缺陷，以及每张卡的往返轮数。
- **想知道哪些结论还没被证实** → 读 `task-N-report.md` 的「未验证」小节与 [裁决台账](../大管家-v1-裁决与遗留台账.md) §3。

---

## English summary

This directory is the **complete build record** of dsh-dajiangjun v1: how work was split into 10 task cards, what each implementer subagent reported, what each reviewer subagent found, and every ruling the lead session made. The files are running logs appended at the time, not a retrospective write-up — including the decisions that were later overturned.

- `progress.md` — the lead's chronological log (dispatches, Rulings 1–47, defects caught, unverified items).
- `task-N-brief.md` — the dispatch brief handed to the implementer of task N.
- `task-N-report.md` — the implementer's report for task N.
- Review packages (`review-<from>..<to>.diff`, 21 of them) are **not** included: they are diffs of this repository and duplicate git history. §4 lists every range remapped to **current** commit hashes, so you can reproduce any of them with `git diff <from> <to>`.

**Pre-publication processing.** Only four kinds of change were made; no prose was removed: local paths → placeholders (`<repo>`, `<dsh-install>`, `<git>`); the maintainer's username → `<user>`; session identifiers → the tail of every full session UUID redacted and any session prefix not already published in the repository README's cost ledger masked as `xxxxxxxx`; and every **commit short hash remapped to this repository's current hashes**, so each one resolves with `git show` (verified: 44 commit-resolvable references, all remaining hex tokens are session IDs).

The Git commit identity is the repository maintainer's account (the AI committed under it). **Commit identity is not authorship** — every line of content was produced by an AI agent.

Record language is Chinese, which is the authoritative version; this English summary exists so you can decide whether the material is relevant before investing time in it.

