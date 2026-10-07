# Task 1 报告：环境闸门 — 隔离 profile + 最小插件跑通

## 结论一句话

**通过。** 第三方插件能装进隔离 profile `steward-dev` 并 boot 拉起；`inject` 数组 6 个服务键名全部实测解析成功；`defineTool` 形状与 `ToolRunContext` 字段从 asar 源码核实；新增插件配置树立即生效、代码下次 boot 加载。

## 做了什么

按 brief 的 9 个 Step 执行（探针放 `_scratch/hello/`，已 gitignore，不进库）：

1. **Step 1** 写探针插件 `_scratch/hello/{package.json, cordis.patch.yml, lib/index.js}`。
2. **Step 2** `dsh --profile steward-dev --from-default-profile web --no-open` 建成 `~/.dsh/profiles/steward-dev/package.json`（bundles = `dsh-base` + `dsh-web-app`）。web app 自动落到 **3080**（没撞 19387），`--no-open` 被正常接受。
3. **Step 3** `dsh plugin add` 成功（pnpm v11.7.0，`+ dsh-hello link:...`，peer 依赖未触发拒绝，无需 `--no-strict-peer-dependencies`）；`plugin list --depth 0` 可见 `dsh-hello`。
4. **Step 4** `--dump-config` grep 出插件行。
5. **Step 5** 抓到真实服务键名（见下）。
6. **Step 6** 写 `docs/notes/dsh-api-notes.md`。
7. **Step 7** 记下「新增插件行是否需要重启」结论。
8. **Step 8** spec §10 A3/A7 标已验证。
9. **Step 9** commit `6b23071`。

## 验证与原始证据

### (a) `dsh plugin list` 输出（Step 3）

```
Legend: production dependency, optional only, dev only

dsh-profile-steward-dev C:\Users\<user>\.dsh\profiles\steward-dev (PRIVATE)
│
│   dependencies:
└── dsh-hello@link:<repo>/_scratch/hello

1 package
```

### (b) `--dump-config` grep 结果（Step 4）

```
# == dsh-hello
- id: hello
  name: dsh-hello
```

### (c) `[hello-probe]` 真实服务键名（Step 5）

探针最终以 `inject = ['tools','sessionController','sessionTitle','sessionProjections','settings','llm']` 声明，boot 后 6 键全部解析为 `true`：

```
[hello-probe] {"dshHomeEnv":"C:\\Users\\<user>\\.dsh","cwd":"<repo>","inject":["tools","sessionController","sessionTitle","sessionProjections","settings","llm"],"resolved":[{"tools":true},{"sessionController":true},{"sessionTitle":true},{"sessionProjections":true},{"settings":true},{"llm":true}]}
```

源码级双确认（asar 内各包 `lib/index.js` 的 `super(ctx, "…")`）：

| 键名 | 提供方包 | 源码 |
|---|---|---|
| `tools` | `@deepseek-ai/dsh-tools` | `super(ctx, "tools")` |
| `sessionController` | `@deepseek-ai/dsh-api-session-controller` | `super(ctx, "sessionController", { namespace: "session" })` |
| `sessionTitle` | `@deepseek-ai/dsh-session-title` | `super(ctx, "sessionTitle")` |
| `sessionProjections` | `@deepseek-ai/dsh-session-projection` | `super(ctx, "sessionProjections")` |
| `settings` | `@deepseek-ai/dsh-settings` | `super(ctx, "settings")` |
| `llm` | `@deepseek-ai/dsh-llm` | `super(ctx, "llm")` |

**关键纠偏（重要）**：brief 的探针用 `inject: []` + `apply` 里 `ctx.get(k)`，实测 `services: []`——6 个键全空。不是键名错，是**加载顺序**：`inject: []` 使插件在服务提供者之前启动，此刻 `ctx.get()`（strict 模式要求提供方 fiber 已激活）返回 undefined。改 `inject: [...]` 声明后 6 键全部解析成功。已写进 `docs/notes/dsh-api-notes.md` §6，供 Task 7–9 遵守：**要用的服务一律写进 `inject`，别用 `inject: []` + `ctx.get()`**。

### (d) 新增插件是否需要重启（Step 7）

- 配置树：`dsh plugin add` 后**不重启**直接 `--dump-config` 即见插件行 → 立即生效。
- 插件代码：`apply` 只在下一次 boot 才执行 → 对已在跑的宿主需重启（或走 `dsh-hmr`）。

## 文件变更

- 新增 `docs/notes/dsh-api-notes.md`（隔离 profile 名、6 个真实 `inject` 键名、`defineTool` 形状、`ToolRunContext` 字段、重启结论、`inject:[]` 坑）。
- 修改 `docs/superpowers/specs/2026-10-06-dajiangjun-session-relay-design.md`：A3、A7 标已验证并附结论。
- `_scratch/hello/*`（探针，gitignore，未提交——刻意）。

## 自审发现

- **A6 编号错位（已照实处理，未掩盖）**：brief Step 8 说「A6（热加载）按 Step 7 结论标注」，但 spec §10 的 **A6 实际是 `sessionTitle.rename()` 在新会话上生效且不被自动刷新覆盖**，与「热加载」无关。本任务没有实测 `sessionTitle.rename()`（需要真实会话 + rename），故**未**把它标为已验证（避免造假）。Step 7 的「新增插件是否需要重启」结论已按最贴合的位置记入 **A3**（「装进隔离 profile 并拉起」）的验证方式栏 + `dsh-api-notes.md` §5。若评审认为 A6 需另作处理（比如把热加载单列为一行），请明示，我再补。
- 其余步骤与 brief 逐一对应，无遗漏；无过度构建（探针最小化、笔记聚焦、未写任何产品代码）。

## 顾虑

1. 上面那条 A6 编号错位——brief/plan 的「A6（热加载）」与 spec 实际 A6（sessionTitle.rename）不符，我已按「不造假」处理并在此明示。
2. `sessionController` 是 Typert remote 服务（`{ namespace: "session" }`），虽实测在 root 作用域 `ctx.get('sessionController')` 可解析，但其 `create()/prompt()` 的具体签名/语义留待 Task 7 实现时再按方法清单核实（不在本闸门范围）。

---

## Fix report（审查 1 Important 发现）

**改了什么**：`docs/superpowers/specs/2026-10-06-dajiangjun-session-relay-design.md` A7 行，把「6 键实测 `ctx.get()` 非 undefined」改成「6 键 inject 声明后 `ctx[k] !== undefined`」。只改这一处；A6 未动，A3/A7 其余内容未动（控制方 bc5492b 已把热加载单列为 A10、新增 A11，非我返工对象）。

**覆盖检查**：重读改后的行，确认措辞与实际运行时检查（探针 `_scratch/hello/lib/index.js` 里 `ctx[k] !== undefined`）一致，且与笔记 §2（resolved 用 `ctx[k]`）、§6（`inject:[]` 时 `ctx.get()` 返回 undefined）不再矛盾——读 A7 的人不会被误导去调 `ctx.get()`。

命令与输出（重读 A7 行）：

```powershell
Get-Content '<repo>\docs\superpowers\specs\2026-10-06-dajiangjun-session-relay-design.md' | Select-Object -Skip 285 -First 1
```

```
| A7 | `inject` 数组的服务键名 | **已验证**（2026-10-06）：真名 = `tools` / `sessionController` / `sessionTitle` / `sessionProjections`（**复数**）/ `settings` / `llm`，6 键 inject 声明后 `ctx[k] !== undefined` 且源码 `super(ctx,"…")` 双确认（详见 `docs/notes/dsh-api-notes.md` §2） | 已完成 | — |
```

自检确认：改后行不再出现 `ctx.get()`，改用 `ctx[k] !== undefined`，与 §2/§6 口径一致。✅
