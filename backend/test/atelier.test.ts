// Contrat atelier-node/1 (docs/SUITE.md §7 d'Atelier Projets) : manifeste, événements, idempotence, tables.

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { openDatabase } from '../src/db/database.js'
import { manifest } from '../src/services/atelier-manifest.js'
import { emitEvents, EVENT_TYPES, lastSeq, pruneEvents, readEvents } from '../src/services/events.js'
import { createPage, movePage, restorePage, trashPage, updatePage } from '../src/services/pages.js'
import { createSpace } from '../src/services/spaces.js'
import { json, testApp } from './helpers.js'

describe('manifeste', () => {
  it('respecte la forme du contrat', () => {
    const m = manifest()
    assert.equal(m.contract, 'atelier-node/1')
    assert.equal(m.app, 'wiki')
    assert.equal(m.transport, 'http')
    const ids = m.actions.map((a) => a.id)
    assert.equal(new Set(ids).size, ids.length, 'ids uniques')
    for (const action of m.actions) {
      assert.match(action.id, /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/)
      assert.ok(['read', 'write', 'destructive'].includes(action.kind))
      assert.ok(action.http && action.mcp_tool === null, 'un seul transport')
      assert.match(action.http.path, /^\/api\//)
      assert.equal((action.input_schema as { type: string }).type, 'object')
      for (const param of action.http.path.match(/\{(\w+)\}/g) ?? []) {
        const name = param.slice(1, -1)
        assert.ok(name in ((action.input_schema as { properties: object }).properties), `${action.id} : ${name} dans le schéma`)
      }
      if (action.kind === 'read') assert.ok(['natural', 'none'].includes(action.idempotency))
      if (action.id.endsWith('.create') || action.id.endsWith('.append')) assert.equal(action.idempotency, 'header')
    }
    assert.deepEqual(m.events.map((e) => e.type), [...EVENT_TYPES])
    assert.ok(!JSON.stringify(m).match(/secret|token|password/i))
  })

  it('chaque action du manifeste répond sur sa route', async () => {
    const { app } = await testApp({ seed: true })
    const m = manifest()
    const sample: Record<string, unknown> = { query: 'bienvenue', title: 'Nouvelle', content: 'Texte', page_id: '1' }
    for (const action of m.actions) {
      const props = Object.keys((action.input_schema as { properties: object }).properties)
      const required = (action.input_schema as { required?: string[] }).required ?? []
      const input = Object.fromEntries(required.map((k) => [k, sample[k]]))
      let url = action.http.path.replace(/\{(\w+)\}/g, (_m, k: string) => String(input[k]))
      for (const k of action.http.path.match(/\{(\w+)\}/g) ?? []) delete input[k.slice(1, -1)]
      const method = action.http.method as 'GET' | 'POST' | 'PUT'
      if (method === 'GET' && Object.keys(input).length) url += `?${new URLSearchParams(input as Record<string, string>)}`
      const res = await app.inject(json(method, url, method === 'GET' ? undefined : input, { 'idempotency-key': `test:${action.id}` }))
      assert.ok(res.statusCode < 300, `${action.id} → ${res.statusCode} ${res.body}`)
      if (action.output.format === 'atelier-table/1') {
        const table = res.json()
        assert.equal(table.format, 'atelier-table/1')
        for (const col of table.columns) assert.match(col.key, /^[a-z][a-z0-9_]*$/)
      }
      void props
    }
    await app.close()
  })
})

describe('événements', () => {
  it('émet chaque type déclaré', () => {
    const db = openDatabase(':memory:')
    const s1 = createSpace(db, { name: 'Un' })
    const s2 = createSpace(db, { name: 'Deux' })
    const page = createPage(db, { spaceId: s1.id, title: 'Page' }, 'x')
    updatePage(db, page.id, { content: 'nouveau', baseVersion: 1 }, 'x')
    movePage(db, page.id, { spaceId: s2.id, parentId: null }, 'x')
    trashPage(db, page.id, 'x')
    restorePage(db, page.id, 'x')
    const { events } = readEvents(db, { since: 0 })
    assert.deepEqual(new Set(events.map((e) => e.type)), new Set(EVENT_TYPES))
    const updated = events.find((e) => e.type === 'wiki.page.updated')!
    assert.deepEqual(updated.subject, { kind: 'page', id: String(page.id), label: 'Page' })
    assert.deepEqual(updated.data, { space_id: String(s1.id), fields: ['content'], version: 2 })
    for (const e of events) {
      for (const [k, v] of Object.entries(e.data)) if (k.endsWith('_id') && v !== null) assert.equal(typeof v, 'string', `${e.type}.${k}`)
      assert.ok(!('content' in e.data), 'jamais de contenu')
    }
  })

  it('garde seq après un redémarrage et après une purge ; signale les trous', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atelier-wiki-ev-'))
    const file = join(dir, 'wiki.db')
    let db = openDatabase(file)
    const ev = { type: 'wiki.space.created' as const, subject: { kind: 'space' as const, id: '1', label: 'x' }, data: {} }
    emitEvents(db, [ev, ev, ev], new Date('2026-01-01T00:00:00Z'))
    db.close()
    db = openDatabase(file)
    emitEvents(db, [ev])
    assert.equal(lastSeq(db), 4)

    let page = readEvents(db, { since: 2, limit: 1 })
    assert.deepEqual([page.events.map((e) => e.seq), page.next, page.oldest, page.gap], [[3], 3, 1, false])
    page = readEvents(db, {})
    assert.deepEqual(page.events.map((e) => e.seq), [1, 2, 3, 4])

    // Purge : seuls les événements à la fois hors des 1000 derniers et de plus de 30 jours partent → rien ici.
    assert.equal(pruneEvents(db), 0)
    db.prepare('DELETE FROM atelier_events WHERE seq <= 3').run()
    page = readEvents(db, { since: 1 })
    assert.equal(page.gap, true, 'événements perdus')
    assert.equal(page.oldest, 4)
    db.prepare('DELETE FROM atelier_events').run()
    page = readEvents(db, {})
    assert.deepEqual([page.events, page.next, page.oldest], [[], 4, 5])
    assert.equal(readEvents(db, { since: 9 }).gap, true, 'since au-delà du dernier seq')
    emitEvents(db, [ev])
    assert.equal(lastSeq(db), 5, 'seq jamais réutilisé')
    db.close()
  })
})

describe('actions', () => {
  it('pages.create est idempotente ; même clé + autre corps → 409 ; autre route → 409', async () => {
    const { app } = await testApp({ seed: true })
    const req = json('POST', '/api/atelier/pages', { title: 'CR réunion', content: 'Points' }, { 'idempotency-key': 'nexus:run1:step2' })
    const first = await app.inject(req)
    assert.equal(first.statusCode, 201)
    assert.equal(first.json().updated_by, 'Atelier Nexus')
    assert.match(first.json().path, /^\/p\/\d+-cr-reunion$/)

    const replay = await app.inject(json('POST', '/api/atelier/pages', { content: 'Points', title: 'CR réunion' }, { 'idempotency-key': 'nexus:run1:step2' }))
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotency-replayed'], 'true')
    assert.deepEqual(replay.json(), first.json())

    const other = await app.inject(json('POST', '/api/atelier/pages', { title: 'Autre' }, { 'idempotency-key': 'nexus:run1:step2' }))
    assert.equal(other.statusCode, 409)
    assert.equal(other.json().code, 'IDEMPOTENCY_KEY_REUSED')

    const id = first.json().id as string
    const append = await app.inject(json('POST', `/api/atelier/pages/${id}/append`, { content: 'Décision', heading: 'Suite' }, { 'idempotency-key': 'nexus:run1:step2' }))
    assert.equal(append.statusCode, 409)

    const ok = await app.inject(json('POST', `/api/atelier/pages/${id}/append`, { content: 'Décision', heading: 'Suite' }, { 'idempotency-key': 'nexus:run1:step3' }))
    assert.equal(ok.json().content, 'Points\n\n## Suite\n\nDécision\n')
    assert.equal(ok.json().version, 2)
    const again = await app.inject(json('POST', `/api/atelier/pages/${id}/append`, { content: 'Décision', heading: 'Suite' }, { 'idempotency-key': 'nexus:run1:step3' }))
    assert.equal(again.json().version, 2, 'pas de deuxième ajout')

    const search = await app.inject(json('POST', '/api/atelier/search', { query: 'decision' }))
    assert.equal(search.json().rows[0].titre, 'CR réunion')
    assert.equal(search.json().rows[0].extrait, 'Points Suite Décision')

    const missing = await app.inject(json('GET', '/api/atelier/pages/9999'))
    assert.deepEqual([missing.statusCode, missing.json().code], [404, 'NOT_FOUND'])
    const bad = await app.inject(json('POST', '/api/atelier/pages', { content: 'sans titre' }))
    assert.deepEqual([bad.statusCode, bad.json().code], [422, 'VALIDATION'])
    await app.close()
  })

  it('pages.list filtre par date et signale la troncature', async () => {
    const { app } = await testApp({ seed: true })
    const all = (await app.inject(json('GET', '/api/atelier/pages?limit=1'))).json()
    assert.equal(all.total, 2)
    assert.equal(all.truncated, true)
    const none = (await app.inject(json('GET', '/api/atelier/pages?updated_since=2999-01-01T00:00:00Z'))).json()
    assert.deepEqual([none.rows, none.total], [[], 0])
    await app.close()
  })
})
