// Nœud Atelier (contrat atelier-node/1) : manifeste, événements et actions pour Atelier Nexus.
// Routes minces : la logique est dans services/atelier-node.ts, les schémas dans services/atelier-manifest.ts.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { ApiError } from '../http/errors.js'
import { bodySchema, manifest, SCHEMAS } from '../services/atelier-manifest.js'
import { nodeAppend, nodeCreatePage, nodePage, nodeReplace, pagesTable, searchTable, spacesTable } from '../services/atelier-node.js'
import { readEvents } from '../services/events.js'
import { checkKey, fingerprint, runIdempotent } from '../services/idempotency.js'
import { getPage } from '../services/pages.js'
import { idParam } from './wiki.js'

const pageParams = { type: 'object', properties: { page_id: { type: 'string', pattern: '^[0-9]+$' } }, required: ['page_id'] }

/** Auteur d'une écriture venue de Nexus : `X-Atelier-User` si présent, sinon « Atelier Nexus ». */
const nodeUser = (request: FastifyRequest) => (request.headers['x-atelier-user'] ? request.user : 'Atelier Nexus')

export async function atelierRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db
  const publicUrl = () => app.config.publicUrl

  app.get('/api/atelier/manifest', async () => manifest())

  app.get(
    '/api/atelier/events',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            since: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 500 },
            types: { type: 'string', maxLength: 2000 },
          },
        },
      },
    },
    async (request) => {
      const { since, limit, types } = request.query as { since?: number; limit?: number; types?: string }
      return readEvents(db, {
        since,
        limit,
        types: types ? types.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      })
    },
  )

  app.get('/api/atelier/spaces', async () => spacesTable(db))

  app.post('/api/atelier/search', { schema: { body: SCHEMAS.pagesSearch } }, async (request) =>
    searchTable(db, request.body as { query: string; space_id?: string; limit?: number }, publicUrl()),
  )

  app.get('/api/atelier/pages', { schema: { querystring: SCHEMAS.pagesList } }, async (request) =>
    pagesTable(db, request.query as { space_id?: string; updated_since?: string; limit?: number }, publicUrl()),
  )

  app.get('/api/atelier/pages/:page_id', { schema: { params: pageParams } }, async (request) => {
    const page = getPage(db, idParam((request.params as { page_id: string }).page_id))
    if (page.deletedAt) return notFoundTrash()
    return nodePage(page, publicUrl())
  })

  /** Écriture idempotente : rejoue la réponse enregistrée pour une même clé et une même requête. */
  async function idempotent(request: FastifyRequest, reply: FastifyReply, run: () => { status: number; body: unknown }) {
    const key = checkKey(request.headers['idempotency-key'] as string | undefined)
    const path = request.url.split('?')[0] ?? request.url
    const result = runIdempotent(db, key, fingerprint(request.method, path, request.body ?? null), run)
    if (result.replayed) reply.header('Idempotency-Replayed', 'true')
    return reply.code(result.status).send(result.body)
  }

  app.post('/api/atelier/pages', { schema: { body: SCHEMAS.pagesCreate } }, async (request, reply) =>
    idempotent(request, reply, () => ({
      status: 201,
      body: nodePage(nodeCreatePage(db, request.body as Parameters<typeof nodeCreatePage>[1], nodeUser(request)), publicUrl()),
    })),
  )

  app.post(
    '/api/atelier/pages/:page_id/append',
    { schema: { params: pageParams, body: bodySchema(SCHEMAS.pagesAppend, ['page_id']) } },
    async (request, reply) => {
      const pageId = idParam((request.params as { page_id: string }).page_id)
      return idempotent(request, reply, () => ({
        status: 200,
        body: nodePage(nodeAppend(db, pageId, request.body as { content: string; heading?: string }, nodeUser(request)), publicUrl()),
      }))
    },
  )

  app.put(
    '/api/atelier/pages/:page_id',
    { schema: { params: pageParams, body: bodySchema(SCHEMAS.pagesReplace, ['page_id']) } },
    async (request) => {
      const pageId = idParam((request.params as { page_id: string }).page_id)
      return nodePage(nodeReplace(db, pageId, request.body as { content: string; title?: string }, nodeUser(request)), publicUrl())
    },
  )
}

function notFoundTrash(): never {
  throw new ApiError(404, 'NOT_FOUND', 'Cette page est dans la corbeille.')
}
