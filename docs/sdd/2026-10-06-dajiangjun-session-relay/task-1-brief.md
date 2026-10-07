### Task 1: 环境闸门 — 隔离 profile + 最小插件跑通

这一步不通过，后面全部白做。同时清掉 spec §10 的 A3 / A6 / A7 三个假设。

**Files:**
- Create: `_scratch/hello/package.json`（一次性探针，`_scratch/` 已被 gitignore）
- Create: `_scratch/hello/cordis.patch.yml`
- Create: `_scratch/hello/lib/index.js`
- Create: `docs/notes/dsh-api-notes.md`
- Modify: `docs/superpowers/specs/2026-10-06-dajiangjun-session-relay-design.md`（§10 假设表）

**Interfaces:**
- Consumes: 无
- Produces: `docs/notes/dsh-api-notes.md` —— 记录**实测**得到的：隔离 profile 名、`inject` 数组的确切服务键名（`sessionController` / `sessionTitle` / `sessionProjections` 的真实拼写）、`defineTool` 实测形状、以及"新增插件行是否需要重启宿主"。Task 7–9 依赖该文件的 `inject` 键名。

- [ ] **Step 1: 写探针插件**

`_scratch/hello/package.json`：

```json
{
  "name": "dsh-hello",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./lib/index.js",
  "exports": { ".": { "default": "./lib/index.js" }, "./package.json": "./package.json" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "files": ["lib", "cordis.patch.yml"],
  "peerDependencies": { "@deepseek-ai/cordis": "~4.0.4" }
}
```

`_scratch/hello/cordis.patch.yml`：

```yaml
- insert:
    - id: hello
      name: dsh-hello
```

`_scratch/hello/lib/index.js`：

```js
export const name = 'hello'
export const inject = []

export function apply(ctx) {
  const info = {
    dshHomeEnv: process.env.DSH_HOME ?? null,
    cwd: process.cwd(),
    services: ['tools', 'sessionController', 'sessionTitle', 'sessionProjections', 'settings', 'llm']
      .filter((k) => ctx.get(k) !== undefined),
  }
  ctx.logger?.info?.('hello probe: %o', info)
  process.stderr.write(`[hello-probe] ${JSON.stringify(info)}\n`)
}
```

- [ ] **Step 2: 建隔离 profile**

Run（PowerShell）：
```powershell
dsh --profile steward-dev --from-default-profile web --no-open
```
它会建 profile 并启动服务。等到 stderr 出现 `[hello-probe]` 或启动日志稳定后 `Ctrl+C`。
Expected: `~/.dsh/profiles/steward-dev/package.json` 存在。

**两个已知坑，按需绕**：
- **端口冲突**：正在跑的桌面宿主占着 19387。若这次 boot 报端口占用，给 app 传自己的端口（`--port 19399` 之类）——launcher 之后的参数会透传给 app。
- **`--no-open` 不被接受**：去掉它，手动关掉弹出的浏览器标签。

**判据是"目录建出来了"，不是"命令以 0 退出"**：这个 app 起服务后不会自己退，`Ctrl+C` 中断是预期终点。

- [ ] **Step 3: 装探针插件**

```powershell
dsh plugin --profile steward-dev add '<repo>\_scratch\hello'
dsh plugin --profile steward-dev list --depth 0
```
Expected: 列表里出现 `dsh-hello`。

**若 pnpm 因 peer 依赖解析失败而拒绝**（这个探针包声明了 `@deepseek-ai/cordis` peer）：加 pnpm 的 `--no-strict-peer-dependencies` 重试，或干脆把探针包的 `peerDependencies` 删掉（它只是个探针，不 import 任何东西）。**判据是"插件行列进了配置树"，不是"用了哪条 pnpm 命令"。**

- [ ] **Step 4: 验证插件行进了配置树**

```powershell
dsh --profile steward-dev --dump-config 2>&1 | Select-String -Pattern 'hello'
```
Expected: 出现 `- id: hello` / `name: dsh-hello`。

**若这一步失败**：说明 `dsh.bundle.patch` 没被解析。检查 `package.json` 里 `dsh.bundle.patch` 的路径是否相对包根、文件是否存在。此处不通就停下报告，不要继续。

- [ ] **Step 5: 跑起来，收集服务键名**

```powershell
dsh --profile steward-dev
```
从 stderr 抓 `[hello-probe]` 那行。

Expected: `services` 数组里至少出现 `tools`。把**实际出现**的键名原样记下来——**这一步的产出就是真名**，后续任务用真名，不用下面任何猜测。

**若某个键名不出现**：说明该服务的 `inject` 名与我预期的不同。用下面这条找出真名：
```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node '<repo>\_scratch\asar.mjs' cat '<dsh-install>\resources\app.asar' 'dsh/node_modules/@deepseek-ai/dsh-session-title/package.json' 2>$null
```
看 `package.json` 里声明的服务名（`cordis` 的 `Service` 声明或 `inject` 约定），记进笔记。

- [ ] **Step 6: 写 API 笔记**

Create `docs/notes/dsh-api-notes.md`，把 Step 5 的实测结果、以及下面这段**已核实**的 `defineTool` 形状写进去（来源：asar 内 `dsh-tools/README.zh.md:34-58`）：

```ts
ctx.tools.register(defineTool({
  name: 'read_file',
  description: 'Read a file from disk.',
  parameters: {
    path: { type: 'string', required: true, description: 'Absolute file path' },
    offset: { type: 'number' },
  },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args, exec) {
    return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
  },
}))
```

并记下 `exec`（`ToolRunContext`）的字段：`{ token, callId, rootCallId, name, signal, agent?, parent?, schema?, arguments, deferContext(msg), concludeTurn() }`。

- [ ] **Step 7: 记下新增插件行是否需要重启**

在笔记里明确回答：`dsh plugin add` 之后，**不重启**能否让新插件行生效？做法：Task 1 Step 4 之后不重启直接 `--dump-config` 看是否已生效；再在 Step 5 启动一次看是否加载。把结论写成一句话。

- [ ] **Step 8: 更新 spec 的假设表**

把 §10 的 **A3**（最小插件能装进隔离 profile 并拉起）、**A7**（`inject` 服务键名）、**A10**（新增插件行的生效时机：配置树立即生效、插件代码下次 boot 才加载）标为**已验证**并附结论。

**A6**（`sessionTitle.rename()` 在新会话上生效）本任务**没有**实测，保持原状不要动它。新增的 A10 是热加载那条事实的归属，不是 A6。

- [ ] **Step 9: Commit**

```powershell
$git = '<git>\cmd\git.exe'
& $git -C '<repo>' add docs/notes/dsh-api-notes.md docs/superpowers/specs
& $git -C '<repo>' commit -m "docs: 环境闸门通过 — 隔离 profile、插件挂载、defineTool 实测形状"
```

---

