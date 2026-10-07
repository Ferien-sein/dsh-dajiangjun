### Task 8: `lib/index.js` — 真执行路径

**Files:**
- Modify: `lib/index.js`
- Modify: `test/index.test.js`

**Interfaces:**
- Consumes: Task 3 的 `acquireLock(home, key, opts)` / `releaseLock(home, key)`（抢占的审计行由 `acquireLock` 自己写，调用点不必补）；Task 1 笔记里的服务键名
- Produces: `dispatchRelay(ctx, config, { mainline, relayId, docPath, sourceSessionId, text })` —— 执行 §3 的 ⑦–⑫ 步

- [ ] **Step 1: 写失败的测试**

追加到 `test/index.test.js`。`fakeCtx` / `tempHome` / `GOOD_DOC` 已在 Task 7 定义，**不要重复定义**：

```js
import { dispatchRelay } from '../lib/index.js'

const CFG = Config({ enabled: true, lockTtlMs: 30000 })

const callArgs = (docPath, i = 0) => ({
  mainline: '大管家',
  relayId: `relay-session-src-20261006120${i}`,
  docPath,
  sourceSessionId: 'session-src',
  text: GOOD_DOC,
})

test('投递必须用 queue，绝不能用 inject', async () => {
  const { home, docPath } = tempHome()
  const ctx = fakeCtx()
  const res = await dispatchRelay(ctx, CFG, callArgs(docPath))

  assert.equal(res.kind, 'dispatched')
  const promptCall = ctx.calls.find((c) => c[0] === 'prompt')
  assert.ok(promptCall, '没有发起投递')
  assert.equal(promptCall[1].mode, 'queue')
  assert.notEqual(promptCall[1].mode, 'inject')
  assert.equal(readAudit(home, 2, new Date()).some((r) => r.result === 'dispatched'), true)
})

test('单飞：同一源会话并发 10 次，只有 1 次真执行', async () => {
  const { docPath } = tempHome()
  const ctx = fakeCtx()
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => dispatchRelay(ctx, CFG, callArgs(docPath, i))),
  )
  assert.equal(results.filter((r) => r.kind === 'dispatched').length, 1)
  assert.equal(results.filter((r) => r.exitCode === 0).length, 10, '抢不到锁的必须静默退出码 0')
  assert.equal(ctx.calls.filter((c) => c[0] === 'create').length, 1, '只许建一个会话')
})

test('回写档头：三个键进「头部」段，且重复执行不堆叠', async () => {
  const { docPath } = tempHome()
  const ctx = fakeCtx()
  await dispatchRelay(ctx, CFG, callArgs(docPath))
  const first = readFileSync(docPath, 'utf8')
  assert.ok(/^\s*链:\s*relay-session-src-/m.test(first))
  assert.ok(/^\s*接手会话:\s*session-new\s*$/m.test(first))

  // 第二次必须喂**改后**的档文本（从磁盘读回来），否则 rewriteHeader 的去重分支根本没被走到：
  // 喂原始 GOOD_DOC 的话结果是从原文本重新生成，永远只有一条链键 → 断言恒真、删掉过滤也能过。
  // 生产路径 runRelay 正是从磁盘读档，所以第二次读到的文本**含**上次写的键——那条过滤真的在承重。
  await dispatchRelay(ctx, CFG, { ...callArgs(docPath, 1), text: readFileSync(docPath, 'utf8') })
  const second = readFileSync(docPath, 'utf8')
  assert.equal((second.match(/^\s*链:/gm) ?? []).length, 1, '链键被堆叠了')
  assert.equal((second.match(/^\s*接手会话:/gm) ?? []).length, 1, '接手会话键被堆叠了')
  assert.equal((second.match(/^\s*已交接:/gm) ?? []).length, 1, '已交接键被堆叠了')
})

test('权限投影读不到（resolveAgent 返回 { error }）→ 拒、退出码 5、不投递', async () => {
  const { home, docPath } = tempHome()
  const calls = []
  const ctx = fakeCtx({
    sessionController: {
      create: async () => { calls.push('create'); return { sessionId: 'session-new' } },
      resolveAgent: async () => { calls.push('resolveAgent'); return { error: { code: 'session/not-found' } } },
      prompt: async () => { calls.push('prompt'); return { accepted: true } },
    },
  })
  const res = await dispatchRelay(ctx, CFG, callArgs(docPath))
  assert.equal(res.kind, 'partial')
  assert.equal(res.exitCode, 5)
  assert.equal(res.gate, 'permission')
  assert.equal(calls.includes('prompt'), false, '权限读不到却仍然投递了')
  assert.equal(readAudit(home, 2, new Date()).some((r) => r.gate === 'permission'), true, '权限闸没留审计行')
})
```

在 `test/index.test.js` 顶部的导入里补上 `readFileSync`：

```js
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
```


- [ ] **Step 2: 跑测试确认失败**

```powershell
& $node --test test/index.test.js 2>&1 | Select-Object -Last 20
```
Expected: FAIL — `dispatchRelay is not a function`

- [ ] **Step 3: 实现 `dispatchRelay`**

追加到 `lib/index.js`（把 `acquireLock`、`releaseLock`、`writeTextAtomic` 加进 `./store.js` 的导入，把 `permissionOk` 加进 `./relay.js` 的导入，并在顶部补 `import { readFileSync } from 'node:fs'`）：

```js
/** 把接力元信息回写到档的「头部」段末尾（spec §3 步骤 ⑪）。先剔除旧键再插入 → 幂等。 */
function rewriteHeader(text, { relayId, sessionId, at }) {
  const KEY = /^\s*(链|已交接|接手会话)\s*[:：]/
  const lines = String(text).split(/\r?\n/).filter((l) => !KEY.test(l))
  const headIdx = lines.findIndex((l) => /^\s*#{1,6}\s+头部\s*$/.test(l))
  let insertAt = lines.length
  if (headIdx >= 0) {
    for (let i = headIdx + 1; i < lines.length; i++) {
      if (/^\s*#{1,6}\s+\S/.test(lines[i])) { insertAt = i; break }
    }
  }
  lines.splice(insertAt, 0, `链: ${relayId}`, `已交接: ${at}`, `接手会话: ${sessionId}`)
  return lines.join('\n')
}

export async function dispatchRelay(ctx, config, { mainline, relayId, docPath, sourceSessionId, text }) {
  const home = dshHome()
  const lockKey = `relay-${sourceSessionId}`
  const audit = (row) =>
    appendAudit(home, { ts: new Date().toISOString(), actor: 'agent', actionId: 'relay', dryRun: false, mainline, sourceSessionId, relayId, ...row })

  // 抢占的审计行由 acquireLock 自己写（doc 02 §5.6），调用点不需要补
  const got = acquireLock(home, lockKey, { ttlMs: config.lockTtlMs ?? 120000 })
  if (!got) {
    audit({ result: 'skipped', gate: 'single-flight' })
    return { kind: 'skipped', exitCode: 0, relayId, gate: 'single-flight', message: '已有同源会话的接力在进行，本次静默退出。' }
  }

  let newId
  try {
    // ⑦ 建会话（cwd 缺省与源会话同源；字段以 Task 1 笔记为准）
    const created = await ctx.sessionController.create({})
    newId = created.sessionId

    // ⑧ 权限回读断言（R-2：走序表）
    // ⚠️ `resolveAgent()` 返回 `{ agent }` 或 `{ error }` 的包装，**不是 agent 本身**。
    // 端到端实测：写成 `.session` 会得到 undefined → `stateOf` 抛 "reading 'header'"，
    // 而单测因为 fakeCtx 也照错的形状写，全程绿。见 docs/notes/dsh-api-notes.md §11。
    const srcFound = await ctx.sessionController.resolveAgent(sourceSessionId)
    const dstFound = await ctx.sessionController.resolveAgent(newId)
    const modeOf = (found) =>
      found?.agent ? ctx.sessionProjections.stateOf(found.agent.session, 'sandboxMode') : undefined
    const sourceMode = modeOf(srcFound)
    const targetMode = modeOf(dstFound)
    if (!sourceMode || !targetMode || !permissionOk(sourceMode, targetMode)) {
      audit({ result: 'failed', gate: 'permission', newSessionId: newId, sourceMode, targetMode })
      // 只报不收拾：归档不可逆（spec §1 N9）
      return { kind: 'partial', exitCode: 5, relayId, gate: 'permission', message: `权限读取失败或降级（源 ${sourceMode ?? '读不到'} → 新 ${targetMode ?? '读不到'}），已建会话 ${newId} 但未投递。请人工处置该空会话。` }
    }

    // ⑨ 命名
    await ctx.sessionTitle.rename(newId, `\u3010\u7eed\u3011${mainline}`)

    // ⑩ 投递 —— R-1：只能 queue 或 steer，inject 不唤醒
    const mode = 'queue'
    if (mode !== 'queue' && mode !== 'steer') throw new Error('R-1 违反：投递模式只能是 queue 或 steer')
    await ctx.sessionController.prompt({
      requestId: `${relayId}-prompt`,
      sessionId: newId,
      mode,
      content: [{ type: 'text', text: INSTRUCTION(docPath, relayId, mainline) }],
    })

    // ⑪ 回写档头（原子重写原文，不是旁挂文件）
    writeTextAtomic(docPath, rewriteHeader(text, { relayId, sessionId: newId, at: new Date().toISOString() }))

    // ⑫ 审计
    audit({ result: 'dispatched', newSessionId: newId })
    return { kind: 'dispatched', exitCode: 0, relayId, message: `已派发。新会话 ${newId}，链标识 ${relayId}。` }
  } catch (error) {
    audit({ result: 'failed', newSessionId: newId, error: String(error?.message ?? error) })
    // 失败发生在 create() 之后就**必须点名那个会话**：它可能已经收到投递。
    // 不点名的后果是具体且危险的——去重闸只认 result === 'dispatched' 的行，
    // 所以人工在不知情下重试会**再投一次**，而那个已投递的会话没人能指认（Ruling 24）。
    const orphan = newId
      ? `已建会话 ${newId}（失败可能发生在其收到投递之后），请人工核查该会话再决定是否重试；`
      : ''
    return { kind: 'partial', exitCode: newId ? 3 : 1, relayId, message: `接力中断：${String(error?.message ?? error)}。${orphan}链标识 ${relayId}。` }
  } finally {
    releaseLock(home, lockKey)
  }
}
```

> `stateOf` 的第一个参数是 **session 对象**，所以两边都经 `resolveAgent()` 取 `.session`——这是已核实存在的服务方法（`dsh-api-session-controller`），不要另造 helper。


- [ ] **Step 4: 把 `dispatchRelay` 接进 `runRelay`**

把 Task 7 里 `runRelay` 的尾段替换为下面**三段**（不是两行——预览的审计行必须留在预览分支**内**）：

```js
  if (dryRun) {
    appendAudit(home, {
      ts: new Date().toISOString(),
      actor: 'agent',
      actionId: 'relay',
      dryRun: true,
      result: 'preview',
      mainline,
      sourceSessionId,
      relayId,
    })
    return { ...base, kind: 'preview', exitCode: 0, message: preview }
  }
  return dispatchRelay(ctx, config, { mainline, relayId, docPath: args.docPath, sourceSessionId, text })
```

**为什么不能照字面只写两行**（Ruling 22）：Task 7 的原代码里，那条预览行的 `appendAudit` 就落在这段尾段中。
- 把它一并删掉 → 预览不再留审计行，**Task 7 的 `rows.length === 1` 断言当场挂**；
- 把它留在 `if (dryRun)` 之外 → **真执行路径也会写一条幽灵 `preview` 行**，污染审计流水与闸门计数。

所以必须是这样三段：预览分支内写预览行并返回；否则才走 dispatch。`preview` 变量本身的构造保持不变，**预览路径不得触达任何真实写操作**。

- [ ] **Step 5: 跑测试确认通过**

```powershell
& $node --test 2>&1 | Select-Object -Last 25
```
Expected: PASS，含"投递必须用 queue"这条。

- [ ] **Step 6: 核对 R-1 的守卫已在位**

Step 3 的 `dispatchRelay` 里已含硬断言（`const mode = 'queue'` + 模式校验），**不要再加第二处**。确认它就在 `prompt` 调用之前。

- [ ] **Step 7: Commit**

```powershell
& $git -C '<repo>' add lib/index.js test/index.test.js
& $git -C '<repo>' commit -m "feat: 真执行路径（create → 权限断言 → rename → queue 投递 → 审计）"
```

---

