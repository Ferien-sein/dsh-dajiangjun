### Task 5: `lib/relay.js` — 四类禁写内容

**Files:**
- Modify: `lib/relay.js`
- Modify: `test/relay.test.js`

**Interfaces:**
- Consumes: Task 4 的 `parseDoc`
- Produces:
  - `checkForbidden(text: string, opts?: { quoteLines?: number }): { ok: boolean, hits: { kind: string, line: number }[] }`
  - 命中项**只返回类目与行号，绝不回显命中内容**

- [ ] **Step 1: 写失败的测试**

```js
import { checkForbidden } from '../lib/relay.js'

test('四类禁写各命中一例', () => {
  const cases = [
    ['凭据值', 'key = sk-abcdefghijklmnopqrstuvwxyz012345'],
    ['内网地址', '服务在 http://192.168.1.20:3080 上'],
    ['他人隐私', '联系 zhang.san@example.com 处理'],
    ['会话原文', 'user: 帮我把这个改一下\nassistant: 好的，我这就改\nuser: 还有这个\nassistant: 也改了\nuser: 再检查一遍'],
  ]
  for (const [kind, text] of cases) {
    const r = checkForbidden(text)
    assert.equal(r.ok, false, `${kind} 没被拦住`)
    assert.ok(r.hits.some((h) => h.kind === kind), `命中类目里没有 ${kind}`)
  }
})

test('干净文本通过；回环地址不算内网', () => {
  assert.equal(checkForbidden('服务在 http://127.0.0.1:19387/docs/notes.md 上').ok, true)
  assert.equal(checkForbidden('见 docs/superpowers/specs/x.md 第 3 节').ok, true)
})

test('内网地址：公网链接放行、内网主机名拦住', () => {
  // 公网文档链**不该**被当成内网地址。拦它没有任何安全收益——公网 URL 不泄漏内网拓扑；
  // 代价却是合法交接档被判不合格、整条接力卡住，而上游设计把**误报率列为第一 KPI**。
  assert.equal(checkForbidden('见 https://nodejs.org/api/ 的说明').ok, true)
  assert.equal(checkForbidden('见 https://github.com/kira905/ops-handoff-design 的说明').ok, true)

  // 真正的内网主机名要拦住：无点的裸主机名，与私有后缀
  assert.equal(checkForbidden('服务在 http://my-nas/ 上').ok, false)
  assert.equal(checkForbidden('服务在 http://storage.local/ 上').ok, false)
  assert.equal(checkForbidden('服务在 http://box.lan/ 上').ok, false)

  // 私网 IP 由同一类的另一条模式捕获，URL 模式**不重复覆盖**它
  assert.equal(checkForbidden('服务在 http://192.168.1.20:3080 上').ok, false)
})

test('命中项不回显命中内容', () => {
  const secret = 'sk-abcdefghijklmnopqrstuvwxyz012345'
  const r = checkForbidden(`key = ${secret}`)
  assert.equal(JSON.stringify(r).includes(secret), false)
})
```

- [ ] **Step 2: 跑测试确认失败**

```powershell
& $node --test test/relay.test.js 2>&1 | Select-Object -Last 20
```
Expected: FAIL — `checkForbidden is not a function`

- [ ] **Step 3: 实现**

追加到 `lib/relay.js`：

```js
const FORBIDDEN = [
  ['凭据值', /\bsk-[A-Za-z0-9_-]{16,}/, /(?:Bearer\s+[A-Za-z0-9._-]{16,})/i, /(?:password|passwd|token|secret|api[_-]?key)\s*[:=]\s*\S+/i],
  // 内网地址之一：非回环、且**不像公网 FQDN** 的 URL 主机——无点的裸主机名，或私有后缀。
  // 刻意**不**拦公网 FQDN：公网链接不泄漏内网拓扑，拦它没有安全收益，代价却是误报率，
  // 而上游设计把误报率列为第一 KPI（doc 07）。私网 IP 由本类前一条模式负责，这里不重复覆盖。
  ['内网地址', /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}(?:\.\d{1,3})?\b/, /https?:\/\/(?!127\.0\.0\.1|localhost\b)(?:[A-Za-z0-9-]+\.(?:local|lan|internal|intranet|home|corp)\b|[A-Za-z0-9-]+(?![\w.-]))/i],
  ['他人隐私', /\b1[3-9]\d{9}\b/, /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
]

/** 只返回类目与行号；绝不回显命中内容（否则等于把禁写内容搬进日志）。 */
export function checkForbidden(text, opts = {}) {
  const quoteLines = opts.quoteLines ?? 5
  const lines = String(text).split(/\r?\n/)
  const hits = []
  lines.forEach((line, i) => {
    for (const [kind, ...patterns] of FORBIDDEN) {
      if (patterns.some((p) => p.test(line))) {
        hits.push({ kind, line: i + 1 })
        break
      }
    }
  })
  // 会话原文：连续 >= quoteLines 行以 user:/assistant: 开头
  let run = 0
  lines.forEach((line, i) => {
    if (/^\s*(?:user|assistant)\s*[:：]/i.test(line)) {
      run += 1
      if (run === quoteLines) hits.push({ kind: '会话原文', line: i + 1 })
    } else {
      run = 0
    }
  })
  return { ok: hits.length === 0, hits }
}
```

- [ ] **Step 4: 跑测试确认通过**

```powershell
& $node --test test/relay.test.js 2>&1 | Select-Object -Last 20
```
Expected: PASS，9 个测试全绿。

- [ ] **Step 5: Commit**

```powershell
& $git -C '<repo>' add lib/relay.js test/relay.test.js
& $git -C '<repo>' commit -m "feat(relay): 交接档四类禁写内容检查（不回显命中内容）"
```

---

