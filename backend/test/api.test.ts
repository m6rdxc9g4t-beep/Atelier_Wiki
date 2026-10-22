import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import type { FastifyInstance } from 'fastify'

import { json, testApp } from './helpers.js'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function multipart(fields: Record<string, string>, file: { name: string; data: Buffer; type: string }) {
  const boundary = '----atelierwiki'
  const parts: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`))
  parts.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`))
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, host: '127.0.0.1:3200' } }
}

describe('API du Wiki', () => {
  let app: FastifyInstance

  before(async () => {
    ;({ app } = await testApp({ seed: true }))
  })
  after(() => app.close())

  it('répond à la sonde de santé', async () => {
    const res = await app.inject(json('GET', '/api/health'))
    assert.deepEqual(res.json(), { status: 'ok', app: 'atelier-wiki' })
    assert.equal(res.headers['x-content-type-options'], 'nosniff')
  })

  it('refuse un hôte inconnu (DNS rebinding) et accepte l’hôte public déclaré', async () => {
    const bad = await app.inject(json('GET', '/api/health', undefined, { host: 'evil.example' }))
    assert.equal(bad.statusCode, 403)
    assert.equal(bad.json().code, 'FORBIDDEN_HOST')
    const good = await app.inject(json('GET', '/api/health', undefined, { host: 'wiki.atelier.test' }))
    assert.equal(good.statusCode, 200)
  })

  it('refuse une écriture venue d’un autre site ou d’une origine « null »', async () => {
    for (const origin of ['https://evil.example', 'null']) {
      const res = await app.inject(json('POST', '/api/spaces', { name: 'Pirate' }, { origin }))
      assert.equal(res.statusCode, 403, origin)
      assert.equal(res.json().code, 'FORBIDDEN_ORIGIN')
    }
    const ok = await app.inject(json('POST', '/api/spaces', { name: 'Équipe' }, { origin: 'https://wiki.atelier.test', host: 'wiki.atelier.test' }))
    assert.equal(ok.statusCode, 201)
  })

  it('crée, lit, modifie une page ; l’auteur vient du portail ; conflit → 409 avec la version actuelle', async () => {
    const spaces = (await app.inject(json('GET', '/api/spaces'))).json() as { id: number }[]
    const created = await app.inject(
      json('POST', '/api/pages', { spaceId: spaces[0]!.id, title: 'Runbook', content: 'Étapes' }, { 'x-atelier-user': 'francois' }),
    )
    assert.equal(created.statusCode, 201)
    const page = created.json() as { id: number; createdBy: string; slug: string }
    assert.equal(page.createdBy, 'francois')
    assert.equal(page.slug, 'runbook')

    const updated = await app.inject(json('PUT', `/api/pages/${page.id}`, { content: 'Étapes v2', baseVersion: 1 }))
    assert.equal(updated.json().version, 2)
    assert.equal(updated.json().updatedBy, 'moi', 'sans portail : auteur par défaut')

    const stale = await app.inject(json('PUT', `/api/pages/${page.id}`, { content: 'v1 bis', baseVersion: 1 }))
    assert.equal(stale.statusCode, 409)
    assert.equal(stale.json().code, 'CONFLICT')
    assert.equal(stale.json().current.content, 'Étapes v2')

    const missing = await app.inject(json('GET', '/api/pages/abc'))
    assert.equal(missing.statusCode, 404)
    const invalid = await app.inject(json('POST', '/api/pages', { spaceId: spaces[0]!.id, title: '   ' }))
    assert.equal(invalid.statusCode, 422)
    assert.equal(invalid.json().code, 'VALIDATION')
  })

  it('cherche, exporte en Markdown, liste l’historique, la corbeille', async () => {
    const hits = (await app.inject(json('GET', '/api/search?q=bienvenue'))).json() as { title: string }[]
    assert.equal(hits[0]?.title, 'Bienvenue sur le Wiki')

    const titles = (await app.inject(json('GET', '/api/titles'))).json() as { id: number; title: string }[]
    const welcome = titles.find((t) => t.title === 'Bienvenue sur le Wiki')!
    const md = await app.inject(json('GET', `/api/pages/${welcome.id}/export`))
    assert.match(md.headers['content-type'] as string, /text\/markdown/)
    assert.match(md.headers['content-disposition'] as string, /bienvenue-sur-le-wiki\.md/)
    assert.ok(md.body.startsWith('# Bienvenue sur le Wiki\n\n'))

    const revisions = (await app.inject(json('GET', `/api/pages/${welcome.id}/revisions`))).json() as unknown[]
    assert.equal(revisions.length, 1)

    const home = (await app.inject(json('GET', '/api/home'))).json() as { pinned: { title: string }[]; recent: unknown[] }
    assert.deepEqual(home.pinned.map((p) => p.title), ['Bienvenue sur le Wiki'])

    const del = await app.inject(json('DELETE', `/api/pages/${welcome.id}`))
    assert.deepEqual(del.json(), { trashed: 2 })
    const trash = (await app.inject(json('GET', '/api/trash'))).json() as { days: number; entries: { id: number }[] }
    assert.equal(trash.days, 30)
    assert.equal(trash.entries[0]?.id, welcome.id)
    const restored = await app.inject(json('POST', `/api/trash/${welcome.id}/restore`))
    assert.equal(restored.statusCode, 200)
  })

  it('accepte une image et la sert avec son type ; refuse un faux PNG et un type inconnu', async () => {
    const up = await app.inject({ method: 'POST', url: '/api/attachments', ...multipart({ pageId: '1' }, { name: 'capture écran.png', data: PNG, type: 'image/png' }) })
    assert.equal(up.statusCode, 201, up.body)
    const att = up.json() as { url: string; isImage: boolean; name: string }
    assert.equal(att.isImage, true)
    assert.equal(att.name, 'capture écran.png')

    const file = await app.inject(json('GET', att.url))
    assert.equal(file.statusCode, 200)
    assert.equal(file.headers['content-type'], 'image/png')
    assert.match(file.headers['content-security-policy'] as string, /sandbox/)
    assert.deepEqual(file.rawPayload, PNG)

    const fake = await app.inject({ method: 'POST', url: '/api/attachments', ...multipart({}, { name: 'faux.png', data: Buffer.from('<svg/>'), type: 'image/png' }) })
    assert.equal(fake.statusCode, 415)
    const svg = await app.inject({ method: 'POST', url: '/api/attachments', ...multipart({}, { name: 'x.svg', data: Buffer.from('<svg/>'), type: 'image/svg+xml' }) })
    assert.equal(svg.statusCode, 415)
    assert.equal(svg.json().code, 'UNSUPPORTED_FILE')
  })

  it('répond 404 en JSON pour une adresse d’API inconnue', async () => {
    const res = await app.inject(json('GET', '/api/inconnu'))
    assert.equal(res.statusCode, 404)
    assert.equal(res.json().code, 'NOT_FOUND')
  })
})
