# 大管家（dsh-dajiangjun）

「大管家」是 DeepSeek Harness 的宿主插件（v1）。它提供一个工具：当前会话的 agent 写完一份**七段交接档**后调用它，插件校验档、过闸门、建一个新会话、命名、投递"接手指令"，让新会话自己开工。**缺省只预览，不真做**（`dryRun` 缺省为 `true`）。

> 本插件**兼容 DeepSeek Harness / 构建于 DeepSeek Harness 之上**，但这**不代表 DeepSeek 官方背书**。

## 怎么装

```powershell
dsh plugin --profile <profile> add '<repo>'
```

`<profile>` 是要安装到的 DSH profile 名（例如 `desktop`）。安装后，配置树里会出现 `- id: dajiangjun`，但**出厂全关**——见下节。

## 依赖与适用范围

本插件在顶层 `inject` 里**硬依赖** `ctx.sessionController`（`@deepseek-ai/dsh-api-session-controller`，一个 web 客户端，经 HTTP gateway 走）。

- **web / desktop 宿主有**这个服务 → 插件正常激活、注册 `steward_relay`。
- **`headless` profile 没有**它（headless 是"无 Host / 无 HTTP / 无浏览器"的一次性 agent 驱动器）。

因此**本插件不适用于 `headless` profile**。装进 headless 的表现是**静默失效**：宿主只打一行

```
dajiangjun (dsh-dajiangjun): pending (waiting for service: sessionController)
```

插件停在 `pending`，`steward_relay` 工具**不会出现**，也**不报任何错误**——必须点名这个形态，避免"装上了但什么都没发生"却无从排查。

本机实测证据（2026-10-06）：`dsh --profile headless --dump-config` 的配置树里**没有** `@deepseek-ai/dsh-api-session-controller`；对照 `steward-dev`（web 模板建的隔离 profile）**有**。详见 `docs/notes/dsh-api-notes.md` §10。

## Config 字段（出厂全关）

| 字段 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `enabled` | boolean | **`false`** | 接力总开关。**出厂关闭**，要真用必须先显式设为 `true` |
| `softLimitRatio` | number | `0.7` | 主动提醒的软限比例（0.1–0.95） |
| `rateLimitMinutes` | number | `20` | 同主线两次成功交接的最小间隔（分钟） |
| `failureLimit` | number | `2` | 同主线连续失败次数上限，达到即停 |
| `lockTtlMs` | number | `120000` | 单飞锁的 TTL（毫秒） |
| `forbiddenQuoteLines` | number | `5` | 判定"会话原文"禁写内容的连续引用行数 |
| `notify.enabled` | boolean | **`false`** | 主动提醒开关。**出厂关闭** |
| `notify.cooldownMinutes` | number | `20` | 同会话两次提醒的冷却（分钟） |
| `notify.dailyCap` | number | `10` | 全局每日提醒上限 |
| `notify.growthStepPct` | number | `5` | 只报状态变化：用量每再涨 ≥5 个百分点才重新提醒 |
| `notify.quietFrom` / `notify.quietTo` | number | `23` / `7` | 免打扰时段 |

## 工具签名与 dryRun 语义

工具名：`steward_relay`

```ts
steward_relay({
  docPath: string,   // 必填：交接档的绝对路径
  mainline?: string, // 主线名，缺省从档里或文件名推断
  dryRun?: boolean,  // 缺省 true：只预览，不建会话/不改档/不投递/不占锁
})
```

- **`dryRun` 缺省为 `true`**：返回 `kind: 'preview'`，列出"将做什么"，**零真副作用**。
- **`dryRun: false`**：真执行完整链——建会话 → 权限回读断言 → 命名 `【续】<主线名>` → 投递接手指令 → 回写档头 → 追加审计行 → 返回 `kind: 'dispatched'`。

返回结构（`output.schema`）：`{ kind, exitCode, gate?, relayId?, message }`，其中 `kind` / `exitCode` / `message` 必填。

退出码：`0` 成功/预览/抢不到单飞锁（静默）；`2` 参数错或越权（子代理不得发起）；`3` 部分完成（会话已建但后续失败，现场保留）；`5` 需人工 fail-closed（档不合格/闸门不过/权限降级/配置不可读）；`1` 其它未预期错误。

## 红线 R-1

投递**必须**用 `mode: 'queue'` 或 `'steer'`，**绝不用** `inject`——`inject` 不唤醒会话（`wakeup=false`），会建好会话、投了内容、**就是不跑**，且不报错。

其余红线（R-2 权限档位走序表、R-3 读不到配置即拒、R-4 单飞锁原子创建、R-5 状态原子写）见设计稿 `docs/superpowers/specs/2026-10-06-dajiangjun-session-relay-design.md` §7。

## 测试

```powershell
node --test
```

全套 62 个测试覆盖：审计哈希链 / 原子写 / 单飞锁 / 档契约 / 禁写内容 / 闸门 / 权限序表 / 主动提醒。
