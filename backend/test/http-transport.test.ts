// Transport node:http vers Ollama : même comportement que fetch pour le client, sans délai propre.
// Faux Ollama sur l'adresse de bouclage (127.0.0.1, port libre) : aucun appel réseau extérieur.

import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'

import { ApiError } from '../src/http/errors.js'
import { draftPage, OllamaClient } from '../src/services/ai.js'
import { nodeHttpFetch } from '../src/services/http-transport.js'

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void

describe('transport node:http', () => {
  let server: Server
  let base = ''
  let handler: Handler = (_req, _body, res) => res.end()
  let closedEarly = 0

  before(async () => {
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        res.on('close', () => {
          if (!res.writableFinished) closedEarly++
        })
        handler(req, body, res)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })

  it('envoie méthode, en-têtes et corps ; renvoie statut, en-têtes et corps', async () => {
    handler = (req, body, res) => {
      res.writeHead(201, { 'content-type': 'application/json', 'x-test': 'oui' })
      res.end(JSON.stringify({ method: req.method, type: req.headers['content-type'], length: req.headers['content-length'], body: JSON.parse(body) }))
    }
    const res = await nodeHttpFetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texte: 'éé' }) })
    assert.equal(res.status, 201)
    assert.equal(res.ok, true)
    assert.equal(res.headers.get('x-test'), 'oui')
    assert.deepEqual(await res.json(), { method: 'POST', type: 'application/json', length: String(Buffer.byteLength('{"texte":"éé"}')), body: { texte: 'éé' } })
  })

  it('garde les statuts d’erreur et les réponses sans corps', async () => {
    handler = (_req, _body, res) => {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"error":"model not found"}')
    }
    const missing = await nodeHttpFetch(`${base}/api/chat`, { method: 'POST', body: '{}' })
    assert.equal(missing.status, 404)
    assert.equal(missing.ok, false)
    assert.equal(await missing.text(), '{"error":"model not found"}')

    handler = (_req, _body, res) => {
      res.writeHead(204)
      res.end()
    }
    const empty = await nodeHttpFetch(`${base}/vide`)
    assert.equal(empty.status, 204)
    assert.equal(await empty.text(), '')
  })

  it('attend les en-têtes sans délai propre, et s’arrête au signal (raison conservée, connexion coupée)', async () => {
    handler = (_req, _body, res) => {
      setTimeout(() => res.end('{}'), 400)
    }
    const slow = await nodeHttpFetch(`${base}/lent`)
    assert.equal(slow.status, 200, 'une réponse tardive arrive')

    handler = () => {
      /* ne répond jamais : seul le signal arrête */
    }
    const before = closedEarly
    await assert.rejects(nodeHttpFetch(`${base}/jamais`, { signal: AbortSignal.timeout(50) }), (error: Error) => error.name === 'TimeoutError')
    const controller = new AbortController()
    const pending = nodeHttpFetch(`${base}/jamais`, { signal: controller.signal })
    setTimeout(() => controller.abort(), 20)
    await assert.rejects(pending, (error: Error) => error.name === 'AbortError')
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(closedEarly - before, 2, 'Ollama voit la connexion fermée (génération arrêtée)')
  })

  it('serveur injoignable → TypeError « fetch failed », comme fetch', async () => {
    const free = createServer()
    await new Promise<void>((resolve) => free.listen(0, '127.0.0.1', resolve))
    const port = (free.address() as AddressInfo).port
    await new Promise((resolve) => free.close(resolve))
    await assert.rejects(nodeHttpFetch(`http://127.0.0.1:${port}/api/tags`), (error: Error) => error instanceof TypeError && error.message === 'fetch failed')
    await assert.rejects(nodeHttpFetch('file:///etc/passwd'), TypeError)
  })

  it('est le transport par défaut du client Ollama (rédaction, délai, état)', async () => {
    handler = (req, _body, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'llama3.1:8b' }] }))
      res.end(JSON.stringify({ model: 'llama3.1:8b', message: { role: 'assistant', content: '```markdown\n## A\n```' } }))
    }
    const client = new OllamaClient({ url: base, model: 'llama3.1:8b', timeoutMs: 2000 })
    assert.deepEqual(await client.status(), { available: true, model: 'llama3.1:8b', modelInstalled: true })
    assert.deepEqual(await draftPage(client, { mode: 'create', instructions: 'x' }), { markdown: '## A', model: 'llama3.1:8b' })

    handler = () => {
      /* génération trop longue */
    }
    const slow = new OllamaClient({ url: base, model: 'llama3.1:8b', timeoutMs: 60 })
    // Un minuteur actif simule la connexion ouverte (celui d'AbortSignal.timeout ne retient pas le processus).
    const keepAlive = setTimeout(() => {}, 5000)
    await assert.rejects(draftPage(slow, { mode: 'create', instructions: 'x' }), (error: unknown) => error instanceof ApiError && error.code === 'AI_TIMEOUT')
    clearTimeout(keepAlive)
  })
})
