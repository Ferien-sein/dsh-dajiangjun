import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  acquireLock,
  appendAudit,
  auditFile,
  hashEntry,
  lockPath,
  readAudit,
  readJson,
  releaseLock,
  updateJson,
  verifyChain,
  writeJsonAtomic,
} from '../lib/store.js'

function home() {
  return mkdtempSync(path.join(tmpdir(), 'dj-store-'))
}

test('appendAudit 串起哈希链', () => {
  const h = home()
  const a = appendAudit(h, { ts: '2026-10-06T00:00:00.000Z', actionId: 'x', dryRun: false })
  const b = appendAudit(h, { ts: '2026-10-06T00:00:01.000Z', actionId: 'x', dryRun: false })
  assert.equal(a.prevHash, '')
  assert.equal(b.prevHash, a.hash)
  assert.equal(a.hash, hashEntry(a))
})

test('verifyChain 检出被篡改的行', () => {
  const h = home()
  appendAudit(h, { ts: '2026-10-06T00:00:00.000Z', actionId: 'x', dryRun: false })
  appendAudit(h, { ts: '2026-10-06T00:00:01.000Z', actionId: 'x', dryRun: false })
  const file = auditFile(h, new Date('2026-10-06T00:00:00.000Z'))
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  assert.equal(verifyChain(rows).ok, true)
  rows[0].actionId = 'tampered'
  const v = verifyChain(rows)
  assert.equal(v.ok, false)
  assert.equal(v.brokenAt, 0)
})

test('readAudit 只读当月与上月', () => {
  const h = home()
  appendAudit(h, { ts: '2026-09-15T00:00:00.000Z', actionId: 'old', dryRun: false })
  appendAudit(h, { ts: '2026-10-06T00:00:00.000Z', actionId: 'new', dryRun: false })
  appendAudit(h, { ts: '2026-08-01T00:00:00.000Z', actionId: 'ancient', dryRun: false })
  const rows = readAudit(h, 2, new Date('2026-10-06T00:00:00.000Z'))
  assert.deepEqual(rows.map((r) => r.actionId).sort(), ['new', 'old'])
})

test('半截 JSON 行不让整条链炸掉', () => {
  const h = home()
  appendAudit(h, { ts: '2026-10-06T00:00:00.000Z', actionId: 'a', dryRun: false })
  const file = auditFile(h, new Date('2026-10-06T00:00:00.000Z'))
  writeFileSync(file, readFileSync(file, 'utf8') + '{"ts":"2026-10-06T00:00:02', 'utf8')
  const rows = readAudit(h, 2, new Date('2026-10-06T00:00:00.000Z'))
  assert.equal(rows.length, 1)
})

test('链跨月连续：跨月读取后 verifyChain 不误报', () => {
  const h = home()
  appendAudit(h, { ts: '2026-08-15T12:00:00.000Z', actionId: 'aug', dryRun: false })
  appendAudit(h, { ts: '2026-09-15T12:00:00.000Z', actionId: 'sep', dryRun: false })
  appendAudit(h, { ts: '2026-10-06T12:00:00.000Z', actionId: 'oct', dryRun: false })

  const all = readAudit(h, 12, new Date('2026-10-06T00:00:00.000Z'))
  assert.deepEqual(all.map((r) => r.actionId), ['aug', 'sep', 'oct'])
  assert.equal(verifyChain(all).ok, true, '跨月链断了——新月份首行的 prevHash 没指向上月末行')

  const oct = all.find((r) => r.actionId === 'oct')
  const sep = all.find((r) => r.actionId === 'sep')
  assert.equal(oct.prevHash, sep.hash)
})

test('窗口验证：readAudit 默认只读两个月，必须用 seed 补上窗口前那条的 hash', () => {
  const h = home()
  appendAudit(h, { ts: '2026-08-15T12:00:00.000Z', actionId: 'aug', dryRun: false })
  appendAudit(h, { ts: '2026-09-15T12:00:00.000Z', actionId: 'sep', dryRun: false })
  appendAudit(h, { ts: '2026-10-06T12:00:00.000Z', actionId: 'oct', dryRun: false })

  const window = readAudit(h, 2, new Date('2026-10-06T00:00:00.000Z'))
  assert.deepEqual(window.map((r) => r.actionId), ['sep', 'oct'])
  // 不传 seed 时窗口首行注定对不上——这是有意的，不是 bug
  assert.equal(verifyChain(window).ok, false)
  assert.equal(verifyChain(window).brokenAt, 0)

  const aug = readAudit(h, 12, new Date('2026-10-06T00:00:00.000Z')).find((r) => r.actionId === 'aug')
  assert.equal(verifyChain(window, aug.hash).ok, true)
})

// 注意：这条**不测并发**。Promise.all 里全是同步的 updateJson，Node 单线程逐个跑完，零交错；
// 即便把 updateJson 退化成"非原子读 + 直接 writeFileSync"，计数照样是 100。
// 它验证的是"连续 100 次读-改-写不丢更新、文件始终是完整 JSON"。
// 跨进程的原子性**由调用方的锁负责**（见 lib/store.js 里 updateJson 的注释），本任务不提供该保证，
// 也就不假造一个测试去暗示它成立。真要压并发得另起 worker_threads/子进程，已记入台账待办。
test('updateJson 连续 100 次读-改-写不丢更新（进程内串行）', () => {
  const h = home()
  const file = path.join(h, 'counter.json')
  writeJsonAtomic(file, { n: 0 })
  for (let i = 0; i < 100; i++) updateJson(file, (v) => ({ n: v.n + 1 }))
  assert.equal(readJson(file, { n: -1 }).n, 100)
})

test('writeJsonAtomic 留下完整 JSON，不留临时文件', () => {
  const h = home()
  const file = path.join(h, 'a.json')
  writeJsonAtomic(file, { hello: '世界' })
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { hello: '世界' })
  const leftovers = readdirSync(h).filter((f) => f.includes('.tmp-'))
  assert.deepEqual(leftovers, [])
})

test('锁：抢不到返回 null', () => {
  const h = home()
  assert.ok(acquireLock(h, 'relay-s1', { ttlMs: 60000, now: 1000 }))
  assert.equal(acquireLock(h, 'relay-s1', { ttlMs: 60000, now: 2000 }), null)
})

test('锁：过期可抢占，且抢占必须留下审计行', () => {
  const h = home()
  acquireLock(h, 'relay-s1', { ttlMs: 1000, now: 0 })
  const got = acquireLock(h, 'relay-s1', { ttlMs: 1000, now: 5000 })
  assert.equal(got.ok, true)
  assert.equal(got.stole, true)

  const rows = readAudit(h, 2, new Date(5000))
  assert.equal(rows.length, 1, '抢占没有留下审计行（doc 02 §5.6 要求「抢占并记一行审计」）')
  assert.equal(rows[0].actionId, 'lock-steal')
  assert.equal(rows[0].result, 'stolen')
  assert.equal(rows[0].reason, 'expired')
})

test('锁：损坏/半截的锁文件视为持有者已死，可被抢占（否则这把锁永久卡死）', () => {
  const h = home()
  acquireLock(h, 'relay-s1', { ttlMs: 60000, now: 0 })
  writeFileSync(lockPath(h, 'relay-s1'), '{"pid":123,"started', 'utf8') // 进程在 create 与 write 之间崩了

  const got = acquireLock(h, 'relay-s1', { ttlMs: 60000, now: 10 })
  assert.equal(got.ok, true, '半截锁文件把锁永久锁死了：held 解析成 null 时 expired 恒为 false')
  assert.equal(got.stole, true)
  assert.equal(readAudit(h, 2, new Date(10))[0].reason, 'unreadable')
})

test('锁：release 后可再抢', () => {
  const h = home()
  acquireLock(h, 'relay-s1', { ttlMs: 1000, now: 0 })
  releaseLock(h, 'relay-s1')
  assert.ok(acquireLock(h, 'relay-s1', { ttlMs: 1000, now: 10 }))
})
