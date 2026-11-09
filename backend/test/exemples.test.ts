// Exemples de la suite : chaque histoire crée son espace et ses pages reliées, puis se retire sans reste.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { loadConfig } from '../src/config.js'
import { json, testApp } from './helpers.js'

describe('exemples de la suite', () => {
  it('livre les exemples dans le dépôt', () => {
    assert.ok(existsSync(join(loadConfig({}).exemplesDir, 'index.json')))
  })

  it('charge chaque histoire : espace, pages, liens résolus', async () => {
    const { app } = await testApp({ seed: true })
    const histoires = (await app.inject(json('GET', '/api/exemples-suite'))).json() as any[]
    assert.ok(histoires.length >= 9)
    for (const h of histoires) {
      assert.equal(h.charge, false)
      const res = await app.inject(json('POST', `/api/exemples-suite/${h.id}`))
      assert.equal(res.statusCode, 200, res.body)
      const { spaceId, pageId } = res.json()
      const tree = (await app.inject(json('GET', `/api/spaces/${spaceId}/tree`))).json() as any[]
      assert.equal(tree.length, h.pages)
      // La page d'entrée (« Parcours de l'exemple ») est citée par les bilans mensuels : liens [[…]] résolus.
      const entry = (await app.inject(json('GET', `/api/pages/${pageId}`))).json()
      assert.equal(entry.title, 'Parcours de l’exemple'.replace('’', "'"))
      assert.ok(entry.backlinks.length >= 1)
    }
    const listed = (await app.inject(json('GET', '/api/exemples-suite'))).json() as any[]
    assert.ok(listed.every((h) => h.charge && h.pageId))
    const hits = (await app.inject(json('GET', '/api/search?q=Boesner'))).json() as any[]
    assert.ok(hits.length >= 1)
    await app.close()
  })

  it('ne duplique rien et ne retire que son espace', async () => {
    const { app } = await testApp({ seed: true })
    const before = (await app.inject(json('GET', '/api/spaces'))).json() as any[]
    const first = (await app.inject(json('POST', '/api/exemples-suite/studio-garance'))).json()
    const again = (await app.inject(json('POST', '/api/exemples-suite/studio-garance'))).json()
    assert.equal(again.spaceId, first.spaceId)
    assert.equal(again.dejaCharge, true)
    assert.equal((await app.inject(json('DELETE', '/api/exemples-suite/studio-garance'))).statusCode, 204)
    const after = (await app.inject(json('GET', '/api/spaces'))).json() as any[]
    assert.deepEqual(after.map((s) => s.id), before.map((s) => s.id))
    assert.equal((await app.inject(json('GET', '/api/trash'))).json().entries.length, 0)
    assert.equal((await app.inject(json('DELETE', '/api/exemples-suite/studio-garance'))).statusCode, 404)
    await app.close()
  })

  it('refuse une histoire inconnue ou un identifiant invalide', async () => {
    const { app } = await testApp({ seed: true })
    assert.equal((await app.inject(json('POST', '/api/exemples-suite/inconnue'))).statusCode, 404)
    assert.equal((await app.inject(json('POST', '/api/exemples-suite/..%2Fx'))).statusCode, 422)
    await app.close()
  })

  it('liste vide sans dossier d’exemples', async () => {
    const { app } = await testApp({ config: { exemplesDir: '/chemin/absent' } })
    assert.deepEqual((await app.inject(json('GET', '/api/exemples-suite'))).json(), [])
    await app.close()
  })
})
