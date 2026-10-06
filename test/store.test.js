import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appendAudit, auditFile, hashEntry, readAudit, verifyChain } from '../lib/store.js'

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
