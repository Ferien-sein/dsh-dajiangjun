# Dajiangjun · dsh-dajiangjun

**Hand a context-exhausted session over to a brand-new session — and let the new session start working on its own.**

A DeepSeek Harness host plugin (v1) · registers one tool: `steward_relay`

[中文](README.md) ｜ **English**

> **Not affiliated.** This project is **compatible with / built on DeepSeek Harness**, developed independently by a third party, and is **not endorsed, sponsored, or authorised by DeepSeek**. "DeepSeek Harness" is a registered trademark of DeepSeek; following the [official brand guidelines](https://github.com/deepseek-ai/deepseek-harness/blob/master/BRAND_GUIDELINES.md), this project uses only the recommended `dsh-` abbreviation prefix, never the full trademark.

---

## 0. In three lines

| | |
|---|---|
| **What it is** | The agent in the current session writes a **seven-section handoff document**, then calls `steward_relay`. The plugin validates the doc → runs the gates → creates a new session → renames it `【续】<mainline>` → delivers a "take over" instruction → the new session starts working by itself |
| **Ship state** | `enabled: false`, and `dryRun` defaults to `true`. **Installing it does nothing.** You have to opt in twice, explicitly |
| **Who wrote it** | **100% developed by AI agents.** A human supplied one initial instruction; code, tests, design docs, reviews and fixes were all produced by AI. Full accounting in §3 |

---

## 1. Source & acknowledgements

The **idea and line of thought for this project come from**:

### 👉 https://github.com/kira905/ops-handoff-design

*"Long-running coding agents · an operations design record"* by **kira905** — eleven de-identified methodology documents, v1.11 / released on two platforms 2026-09-28.

The problems and acceptance criteria defined in that work directly determined what this plugin looks like:

| Part used | What it became here |
|---|---|
| Doc **09** (automatic handoff and relay for long sessions), primary | The whole mechanism: seven-section handoff contract, the authority split between the three carriers, gate ordering, `queue`/`steer` delivery, two-stage permission assertion |
| Doc **02** §5.2 / §5.6 (audit medium, concurrency and atomic-write contract) | Audit hash chain, write-temp-file + atomic rename, single-flight lock (`flag: 'wx'` atomic create — never `existsSync` then write) |
| Doc **03** R4 / R9 (four-level circuit breaker, autonomy tiers) | Consecutive-failure breaker, rate limiting, proactive-notification tiers and interruption budget |
| Doc **07** R2 / R3 (deliver after the lock; release means editing the table) | Losing the lock race exits silently (exit code 0); release requires a config change |
| Doc **04 / 08** (review protocol, documentation-consistency audit) | This project's own execution flow (dispatch brief → implement → review → scoped re-review → fix round) and the closing write-back for "the manual no longer matches the machine" |

**On the upstream licence, stated plainly:**

- The upstream **documents** are licensed **CC BY-NC-SA 4.0** (attribution + non-commercial + share-alike). Copyright belongs to the original author, kira905.
- This project is an **independent implementation** of those methodologies: this repository **contains no passage copied from the upstream documents**. Before release we ran a verbatim-overlap check — every document here was normalised and n-gram compared against all 14 upstream files: **zero consecutive overlap of 48 characters or more**; in the 24–48 character band only non-copyrightable elements remain (JSON field names such as `inputTokens`, package names, the repository URL).
- Upstream deliberately splits its licences (documents under one, code under another). **If what you want to reuse is the methodology itself rather than this code, follow the upstream licence.** This repository licenses only its own contents.

---

## 2. Developed entirely by AI

**Every line of this plugin was written by AI.** No human author, no human designer, no human reviewer.

| Metric | Value |
|---|---|
| Development window | 2026-10-06 → 2026-10-07 (~2 days) |
| Commits | 54 |
| Implementation | 641 lines (`lib/`) |
| Tests | 654 lines (`test/`, 64 tests, all green) |
| Design docs / plan / decision ledger | 2,721 lines (`docs/`) |
| Build record (SDD) | 21 files / ~240 KB — see [`docs/sdd/`](docs/sdd/2026-10-06-dajiangjun-session-relay/README.md) |
| AI sessions involved | 1 lead session + 38 subagents (plus 3 side-branch/research top-level sessions, 13 end-to-end test sessions, 2 empty sessions and 1 unrelated session in the same workspace — itemised in §3.3) |
| Human involvement | 1 initial instruction; a few factual clarifications (e.g. "that interruption was the machine powering off, not the agent's fault") |

The development method is itself part of the methodology: the lead session split the work into 10 task cards; each card was dispatched to an **implementer subagent**, then independently reviewed by a separate **reviewer subagent**; any Important finding triggered a **scoped re-review**, and if needed a **fix round** — up to 5 rounds per card.

**The entire paper trail ships with the repository**: dispatch briefs, implementer reports, and the lead's running log (including 41 rulings and the 10 real defects the process caught) → [`docs/sdd/2026-10-06-dajiangjun-session-relay/`](docs/sdd/2026-10-06-dajiangjun-session-relay/README.md). The 21 raw review diffs are not included (they duplicate git history), but the index page maps every review range to this repository's current commits so you can regenerate any of them with `git diff`.

> Note: the Git commit identity is the repository maintainer's account (the AI committed under it). **Commit identity ≠ content authorship** — the author of the content in all 54 commits is an AI agent.

---

## 3. Cost and token accounting

> Source: DeepSeek Harness's own cost ledger, `~/.dsh/storages/cost-meter/ledger.json` (per-session accounting, currency CNY). Tokens are summed from the per-message `usage` events in this workspace's session logs. **Snapshot taken 2026-10-07 19:36 (UTC+8).**

### 3.1 Totals

| Role | Sessions | Model calls | Input tokens | Output tokens | Cache-read tokens | Total tokens | Cost (CNY) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Lead (top-level sessions) | 20 | 613 | 1,905,571 | 815,032 | 173,882,240 | **176,602,843** | **1.2241** |
| Subagents | 38 | 1,287 | 2,673,600 | 1,336,627 | 198,299,136 | **202,309,363** | **1.7979** |
| **v1 development total** | **58** | **1,900** | **4,579,171** | **2,151,659** | **372,181,376** | **378,912,206** | **¥3.0220** |
| Release phase (privacy/legal review + bilingual docs + push prep) | 2 | 107 | 315,078 | 132,535 | 14,840,064 | 15,287,677 | 0.1713 |

**In one sentence**: building this plugin took 1,900 model calls, **379 million tokens**, and **¥3.02**.

The overwhelming majority of those tokens are **cache reads** (372,181,376 / 378,912,206 ≈ 98.2%) — a long session re-reads its context every turn, and cache hits are priced far below fresh input, which is why 379M tokens cost about three yuan.

Model split: `deepseek-v4-pro` for **implementation and final review**; `deepseek-flash` for **routine implementation, scoped re-reviews and document analysis** (plus a handful of calls through `deepseek-official:deepseek-v4-flash`).

### 3.2 Per-subagent breakdown

All 38 subagents, sorted by token count descending. **A `—` in the cost column means that session does not appear in the ledger's per-session detail** (see the caveats in §3.4).

| # | Subagent task | Session ID | Model | Calls | Input | Output | Cache read | Total tokens | Cost (CNY) |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|
| 1 | Implement Task 10 · end-to-end acceptance (incl. final fix round) | `9fdd58e0` | deepseek-v4-pro | 277 | 633,663 | 258,958 | 76,428,416 | 77,321,037 | 0.4797 |
| 2 | Implement Task 9 · field testing + Ruling 47 wording fix | `8e193106` | deepseek-v4-pro | 210 | 424,677 | 213,955 | 53,403,776 | 54,042,408 | 0.3523 |
| 3 | DSH internal API reverse engineering (asar unpack + source tracing) | `76332eb7` | deepseek-flash | 106 | 252,526 | 85,464 | 18,250,880 | 18,588,870 | 0.1439 |
| 4 | Final-review fix round (implementation) | `65fdbbe4` | deepseek-v4-pro | 117 | 123,204 | 88,645 | 16,978,816 | 17,190,665 | 0.1226 |
| 5 | Implement Task 1 · environment gate + DSH API reconnaissance | `a62f48a8` | deepseek-v4-pro | 65 | 92,963 | 44,887 | 5,461,632 | 5,599,482 | 0.0573 |
| 6 | Contradiction investigation (cost ledger vs session logs) | `d66e49fa` | deepseek-v4-pro | 50 | 121,784 | 44,874 | 4,657,280 | 4,823,938 | 0.0592 |
| 7 | Whole-branch final review | `befe36ad` | deepseek-v4-pro | 37 | 121,285 | 53,528 | 3,813,376 | 3,988,189 | 0.0617 |
| 8 | Implement Task 3 · atomic write + file lock | `70ead537` | deepseek-flash | 52 | 35,476 | 35,105 | 2,514,432 | 2,585,013 | 0.0339 |
| 9 | Implement Task 8 · real execution chain (create → assert → rename → queue) | `47dcea7b` | deepseek-v4-pro | 42 | 36,180 | 29,261 | 2,445,056 | 2,510,497 | 0.0303 |
| 10 | Implement Task 5 · four forbidden-content classes | `b5b0fb12` | deepseek-flash | 41 | 43,533 | 25,197 | 2,324,736 | 2,393,466 | 0.0286 |
| 11 | Implement Task 2 · store (audit trail + hash chain) | `2f4dc06b` | deepseek-flash | 52 | 29,970 | 30,315 | 2,267,136 | 2,327,421 | 0.0295 |
| 12 | Review Task 9 | `f85db2bb` | deepseek-v4-pro | 27 | 60,717 | 31,322 | 1,640,064 | 1,732,103 | 0.0328 |
| 13 | Implement Task 7 · tool registration + dryRun preview | `91c34ed5` | deepseek-flash | 28 | 33,048 | 20,036 | 1,272,704 | 1,325,788 | 0.0208 |
| 14 | Implement Task 6 · permission order table + 7 gates | `c9995cec` | deepseek-flash | 20 | 38,940 | 16,778 | 993,280 | 1,048,998 | 0.0189 |
| 15 | Re-review the final fix round | `0a545e34` | deepseek-v4-pro | 13 | 69,351 | 18,390 | 871,424 | 959,165 | 0.0241 |
| 16 | Design-phase review | `0c808cbb` | deepseek-v4-pro | 15 | 29,481 | 31,696 | 702,848 | 764,025 | 0.0255 |
| 17 | Scoped re-review of Ruling 41 | `6f422ac2` | deepseek-v4-pro | 13 | 37,709 | 17,289 | 635,392 | 690,390 | 0.0179 |
| 18 | Implement Task 4 · seven-section handoff contract | `341addaf` | deepseek-flash | 18 | 11,770 | 11,107 | 472,064 | 494,941 | 0.0098 |
| 19 | Scoped re-review | `551cad9f` | deepseek-flash | 10 | 27,679 | 11,158 | 349,184 | 388,021 | 0.0119 |
| 20 | Review Task 1 | `32cab466` | deepseek-v4-pro | 8 | 28,069 | 22,062 | 284,288 | 334,419 | 0.0183 |
| 21 | Scoped re-review (tiny change) | `634c64b0` | deepseek-flash | 10 | 18,327 | 5,146 | 292,608 | 316,081 | 0.0067 |
| 22 | Review Task 7 | `73c17c9e` | deepseek-v4-pro | 6 | 27,776 | 16,445 | 206,720 | 250,941 | 0.0147 |
| 23 | Scoped re-review of Task 8 | `74d5ddc9` | deepseek-v4-pro | 8 | 19,061 | 7,180 | 218,624 | 244,865 | 0.0078 |
| 24 | Scoped re-review of Task 3 | `0b3cafb5` | deepseek-v4-pro | 6 | 25,388 | 8,732 | 200,960 | 235,080 | 0.0097 |
| 25 | Scoped re-review | `7f1b9926` | deepseek-flash | 8 | 15,996 | 2,937 | 205,184 | 224,117 | 0.0048 |
| 26 | Document analysis (distilling ops-handoff-design methodology) | `9efe2d2e` | deepseek-flash | 5 | 38,048 | 16,957 | 161,664 | 216,669 | 0.0164 |
| 27 | Review Task 8 | `b9de0b15` | deepseek-v4-pro | 5 | 25,397 | 20,478 | 164,352 | 210,227 | 0.0166 |
| 28 | Review Task 6 | `a3d4773d` | deepseek-v4-pro | 5 | 19,617 | 15,647 | 167,936 | 203,200 | 0.0128 |
| 29 | Document analysis (distilling ops-handoff-design methodology) | `c514f489` | deepseek-flash | 3 | 48,062 | 29,855 | 111,360 | 189,277 | 0.0255 |
| 30 | Document analysis (distilling ops-handoff-design methodology) | `e14f7be5` | deepseek-flash | 3 | 37,423 | 28,841 | 110,976 | 177,240 | 0.0233 |
| 31 | Review Task 3 | `f3db088e` | deepseek-v4-pro | 4 | 18,221 | 19,970 | 128,128 | 166,319 | 0.0151 |
| 32 | Review Task 4 | `fe96fecf` | deepseek-v4-pro | 4 | 21,173 | 15,978 | 104,960 | 142,111 | 0.0131 |
| 33 | Review Task 5 | `3de91a68` | deepseek-v4-pro | 4 | 13,912 | 12,853 | 111,488 | 138,253 | 0.0101 |
| 34 | Review Task 2 | `0ebec8c6` | deepseek-v4-pro | 3 | 26,707 | 12,881 | 87,424 | 127,012 | 0.0120 |
| 35 | Document analysis (distilling ops-handoff-design methodology) | `0b747a61` | deepseek-flash | 3 | 30,339 | 17,191 | 66,304 | 113,834 | 0.0151 |
| 36 | Scoped re-review of Task 5 | `81bb8398` | deepseek-v4-pro | 3 | 14,616 | 8,746 | 71,296 | 94,658 | 0.0077 |
| 37 | Scoped re-review of Task 2 | `147c9962` | deepseek-v4-pro | 3 | 17,017 | 6,388 | 71,040 | 94,445 | 0.0066 |
| 38 | Small change | `3aa8c454` | deepseek-flash | 3 | 4,495 | 375 | 51,328 | 56,198 | 0.0011 |
| | **Subagent subtotal** | | | **1,287** | **2,673,600** | **1,336,627** | **198,299,136** | **202,309,363** | **1.7979** |

### 3.3 Top-level (lead) sessions

| Nature | Session | Session ID | Calls | Input | Output | Cache read | Total tokens | Cost (CNY) |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| Main development | Dajiangjun plugin development | `4b10a5b6` | 365 | 1,195,851 | 572,184 | 148,694,272 | 150,462,307 | 0.9769 |
| Side branch | Plugin enable/disable failure reported in use → fix | `a5af0f38` | 123 | 173,181 | 173,640 | 18,536,960 | 18,883,781 | 0.1858 |
| Side branch | ops-handoff-design × superpowers compatibility research | `f1f4ea7b` | 24 | 64,980 | 17,780 | 1,168,640 | 1,251,400 | 0.0239 |
| Side branch | 【续】documentation health check (relay test target) | `fd616591` | 20 | 102,129 | 28,866 | 1,609,856 | 1,740,851 | 0.0375 |
| Unrelated | Fixing a DeepSeek index file read (not this plugin) | `2708fd4b` | 19 | 226,800 | 5,358 | 1,930,752 | 2,162,910 | — |
| E2E relay target | 【续】relay-e2e-test4 | `eaf8fa95` | 24 | 83,019 | 7,807 | 1,576,960 | 1,667,786 | — |
| E2E relay target | Session relay end-to-end test | `d4d221be` | 9 | 7,804 | 1,752 | 98,304 | 107,860 | — |
| E2E relay target | Session relay end-to-end test | `52dd0d93` | 5 | 10,672 | 2,047 | 46,592 | 59,311 | — |
| E2E relay target | Session relay end-to-end test | `71d9ce1c` | 5 | 4,596 | 1,207 | 51,200 | 57,003 | — |
| E2E relay target | Session relay end-to-end test | `d30614ef` | 5 | 4,555 | 1,036 | 50,432 | 56,023 | — |
| E2E relay target | Session relay end-to-end test | `ca5f4809` | 5 | 4,504 | 1,063 | 50,432 | 55,999 | — |
| E2E relay target | 【续】relay-e2e-test5 | `ac055382` | 4 | 5,508 | 1,288 | 39,552 | 46,348 | — |
| E2E relay target | "Issue price of 200 digital collectibles" (title auto-generated by the model) | `97c80e8a` | 2 | 9,439 | 834 | 11,264 | 21,537 | — |
| E2E relay target | Testing `steward_relay` error return | `7560f554` | 2 | 3,622 | 167 | 17,024 | 20,813 | — |
| E2E probe | Reply with exactly the single word: PONG | `5178b36e` | 1 | 8,911 | 3 | 0 | 8,914 | — |
| E2E relay target | 【续】relay-e2e-test3 (session created, delivery failed) | `195d49b0` | 0 | 0 | 0 | 0 | 0 | — |
| E2E relay target | Session relay end-to-end test (failure-injection sample) | `64e5df8e` | 0 | 0 | 0 | 0 | 0 | — |
| Empty session | — | `b6c26822` | 0 | 0 | 0 | 0 | 0 | — |
| E2E probe | Reply with exactly the single word: PONG | `e4068d97` | 0 | 0 | 0 | 0 | 0 | — |
| Empty session | — | `e6f24939` | 0 | 0 | 0 | 0 | 0 | — |
| | **Top-level subtotal** | | **613** | **1,905,571** | **815,032** | **173,882,240** | **176,602,843** | **1.2241** |

### 3.4 Measurement caveats (recorded as-is)

1. **Costs come from DSH's own cost ledger** — per-session, currency CNY. That ledger's per-session detail is itself **incomplete**: on 2026-10-06, for example, the day total is ¥3.4669 while the listed sessions add up to ¥2.7250. So the 16 sessions marked `—` in §3.3 have tokens in their logs but no cost line in the ledger detail.
2. **Tokens are summed from per-message `usage` events** in the session logs, and spot-checked against the ledger's per-session figures (Task 10 matches exactly on all three numbers).
3. **The release-phase row is live**: the session writing this README keeps running after the commit, so its numbers keep growing. The table is a snapshot from 2026-10-07 19:36 (UTC+8).
4. **"Total tokens" = input + output + cache read + cache write** (cache write and reasoning are 0 here). Counting only fresh input + output gives 6,730,830 tokens for the v1 phase — but that understates the real context cost, so it is not used.
5. Model prices vary by **peak/off-peak window**, so back-computing a unit price from tokens will not reconcile. Only the ledger's recorded amounts are reported.

---

## 4. Installation

```powershell
git clone https://github.com/Ferien-sein/dsh-dajiangjun
dsh plugin --profile <profile> add '<the cloned directory>'
```

`<profile>` is the DSH profile to install into (e.g. `desktop`). Afterwards the config tree contains a `- id: dajiangjun` entry, but it is **shipped off** — see the next section.

---

## 5. Dependencies and applicability

The plugin **hard-depends** on `ctx.sessionController` in its top-level `inject` (`@deepseek-ai/dsh-api-session-controller` — a web client that talks over the HTTP gateway).

- **web / desktop hosts have it** → the plugin activates normally and registers `steward_relay`.
- **`headless` profiles do not** (headless is a one-shot agent driver with no host, no HTTP, no browser).

So **this plugin does not work under a `headless` profile**. Installed there it **fails silently**: the host prints exactly one line

```
dajiangjun (dsh-dajiangjun): pending (waiting for service: sessionController)
```

and the plugin sits in `pending`. The `steward_relay` tool **never appears** and **no error is raised**. This failure mode has to be called out by name, otherwise you get "it installed but nothing happened" with nothing to debug.

Measured on this machine (2026-10-06): `dsh --profile headless --dump-config` contains **no** `@deepseek-ai/dsh-api-session-controller`; the comparison profile `steward-dev` (created from the web template) **does**. Details in `docs/notes/dsh-api-notes.md` §10.

---

## 6. Config fields (all off by default)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | **`false`** | Master switch. **Off by default**; you must set it to `true` explicitly |
| `softLimitRatio` | number | `0.7` | Soft-limit ratio for proactive notices (0.1–0.95) |
| `rateLimitMinutes` | number | `20` | Minimum minutes between two successful relays on the same mainline |
| `failureLimit` | number | `2` | Consecutive failures on the same mainline before stopping |
| `lockTtlMs` | number | `120000` | Single-flight lock TTL (ms) |
| `forbiddenQuoteLines` | number | `5` | Consecutive quoted lines that count as "session transcript" |
| `notify.enabled` | boolean | **`false`** | Proactive notices. **Off by default** |
| `notify.cooldownMinutes` | number | `20` | Cooldown between two notices in the same session (minutes) |
| `notify.dailyCap` | number | `10` | Global daily notice cap |
| `notify.growthStepPct` | number | `5` | Change-only: re-notify only after usage grows ≥5 more percentage points |
| `notify.quietFrom` / `notify.quietTo` | number | `23` / `7` | Quiet hours |

---

## 7. Tool signature and dryRun semantics

Tool name: `steward_relay`

```ts
steward_relay({
  docPath: string,   // required: absolute path to the handoff document
  mainline?: string, // mainline name; inferred from the doc or filename if omitted
  dryRun?: boolean,  // default true: preview only — no session, no doc edit, no delivery, no lock
})
```

- **`dryRun` defaults to `true`**: returns `kind: 'preview'`, listing what it *would* do, with **zero real side effects**.
- **`dryRun: false`**: runs the full chain — create session → read back and assert permissions → rename to `【续】<mainline>` → deliver the takeover instruction → write back the doc header → append an audit row → return `kind: 'dispatched'`.

Result shape (`output.schema`): `{ kind, exitCode, gate?, relayId?, message }`, with `kind` / `exitCode` / `message` required.

Exit codes: `0` success / preview / lock race lost (silent); `2` bad arguments or unauthorised (subagents may not initiate); `3` partial (session created but a later step failed; state preserved); `5` needs human fail-closed (bad doc / failed gate / degraded permissions / unreadable config); `1` any other unexpected error.

---

## 8. Red lines

- **R-1 (delivery)**: delivery **must** use `mode: 'queue'` or `'steer'`, **never** `inject` — `inject` does not wake the session (`wakeup=false`), so the session is created, the content is delivered, and it simply **never runs**, with no error.
- **R-2**: permission tiers are compared through the order table.
- **R-3**: unreadable config means refuse (fail-closed).
- **R-4**: single-flight lock is created atomically (`flag: 'wx'`; never `existsSync` then write).
- **R-5**: state is written atomically (temp file → atomic rename).

See `docs/superpowers/specs/2026-10-06-dajiangjun-session-relay-design.md` §7.

---

## 9. Tests

```powershell
node --test
```

**64 tests**, covering: audit hash chain / atomic writes / single-flight lock / document contract / forbidden content / gates / permission order table / proactive notices.

---

## 10. Known limitations (recorded as-is)

- **web / desktop hosts only** (see §5).
- **v1 is manual-initiation only**: the agent calls the tool after writing the doc. What the soft context limit triggers is a **notice**, not an automatic relay.
- **End-to-end was only exercised in an isolated profile (`steward-dev`)**, which does not load the billing plugin — so tokens burned by those runs are not in the ledger.
- **The cost ledger's per-session detail is incomplete** (see §3.4).
- Five of the E2E sessions in the isolated profile are **failure-injection samples** (0 calls), used to verify the gate-rejection paths.
- Unverified items and 22 open loose ends are listed in `docs/大管家-v1-裁决与遗留台账.md` (Chinese).

---

## 11. Legal and compliance

- **Not official**: no affiliation, endorsement or partnership with DeepSeek. "DeepSeek Harness" is a DeepSeek registered trademark; this project only uses the `dsh-` abbreviation prefix that the official guidelines recommend.
- **Licence**: this repository is **MIT** (see [LICENSE](LICENSE)). The upstream `ops-handoff-design` documents are **CC BY-NC-SA 4.0** — a different licence that this one neither covers nor overrides. This repository licenses only its own contents; attribution and sources are in §1.
- **No third-party code included**: `lib/` and `test/` are original to this project; `@deepseek-ai/*` packages are declared as `peerDependencies` only, with no host source inlined. DeepSeek Harness itself is MIT-licensed.
- **AI-generated content**: essentially all of this project was generated by AI. Most jurisdictions (including China and the United States) require human creative contribution for copyright to subsist, so this project's copyrightability may be weaker than a purely human work. Released under MIT, that is **more permissive, not less**, for users.
- **Credentials and privacy**: the repository contains **no real credentials, keys, tokens, or session transcripts**. A privacy review covered the whole working tree and the entire Git history, and the maintainer's local paths and username were replaced with placeholders (history was rewritten to remove them completely). The test fixtures `sk-…`, `192.168.1.20` and `zhang.san@example.com` are documented dummies.
- **Automation is at your own risk**: this plugin **creates sessions and delivers instructions into them** — an automation with real side effects. `dryRun: true` + `enabled: false` by default is a deliberate safety path; verify in an isolated profile before enabling it. The authors accept no liability for the consequences of use (MIT warranty disclaimer).

---

## 12. License

[MIT](LICENSE) © 2026 Ferien-sein

Copyright and licence for the upstream methodology belong to the author of [kira905/ops-handoff-design](https://github.com/kira905/ops-handoff-design).
