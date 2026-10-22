// Routes de l'interface du Wiki. Minces : elles valident, appellent un service et renvoient sa réponse.

import type { FastifyInstance } from 'fastify'

import { slugify } from '../domain/markdown.js'
import { ApiError } from '../http/errors.js'
import { pageAttachments } from '../services/attachments.js'
import {
  createPage,
  getPage,
  getRevision,
  listRevisions,
  listTrash,
  movePage,
  pinnedPages,
  purgePage,
  recentPages,
  restorePage,
  restoreRevision,
  setPinned,
  spaceTree,
  titles,
  trashPage,
  updatePage,
} from '../services/pages.js'
import { searchPages } from '../services/search.js'
import { createSpace, deleteSpace, listSpaces, updateSpace } from '../services/spaces.js'
import { manifest } from '../services/atelier-manifest.js'

/** Identifiant numérique de l'URL ; sinon 404 (une adresse mal formée est une page qui n'existe pas). */
export function idParam(value: unknown, what = 'Page'): number {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n <= 0) throw new ApiError(404, 'NOT_FOUND', `${what} introuvable.`)
  return n
}

const idSchema = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } as const

const spaceBody = {
  type: 'object',
  properties: {
    name: { type: 'string', maxLength: 200 },
    icon: { type: 'string', maxLength: 32 },
    description: { type: 'string', maxLength: 2000 },
  },
  additionalProperties: false,
} as const

export async function wikiRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db

  app.get('/api/health', async () => ({ status: 'ok', app: 'atelier-wiki' }))

  app.get('/api/me', async (request) => ({ user: request.user, version: manifest().version }))

  app.get('/api/home', async () => ({
    spaces: listSpaces(db),
    pinned: pinnedPages(db),
    recent: recentPages(db, 12),
  }))

  // ── Espaces ──────────────────────────────────────────────────────────────
  app.get('/api/spaces', async () => listSpaces(db))

  app.post('/api/spaces', { schema: { body: { ...spaceBody, required: ['name'] } } }, async (request, reply) => {
    reply.code(201)
    return createSpace(db, request.body as { name: string; icon?: string; description?: string })
  })

  app.patch('/api/spaces/:id', { schema: { params: idSchema, body: spaceBody } }, async (request) =>
    updateSpace(db, idParam((request.params as { id: string }).id, 'Espace'), request.body as { name?: string }),
  )

  app.delete('/api/spaces/:id', { schema: { params: idSchema } }, async (request, reply) => {
    deleteSpace(db, idParam((request.params as { id: string }).id, 'Espace'))
    return reply.code(204).send()
  })

  app.get('/api/spaces/:id/tree', { schema: { params: idSchema } }, async (request) =>
    spaceTree(db, idParam((request.params as { id: string }).id, 'Espace')),
  )

  app.get('/api/titles', async () => titles(db))

  // ── Pages ────────────────────────────────────────────────────────────────
  app.post(
    '/api/pages',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            spaceId: { type: 'integer', minimum: 1 },
            parentId: { type: ['integer', 'null'], minimum: 1 },
            title: { type: 'string' },
            content: { type: 'string' },
            icon: { type: 'string', maxLength: 32 },
            index: { type: 'integer', minimum: 0 },
          },
          required: ['spaceId', 'title'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      reply.code(201)
      return createPage(db, request.body as Parameters<typeof createPage>[1], request.user)
    },
  )

  app.get('/api/pages/:id', { schema: { params: idSchema } }, async (request) => getPage(db, idParam((request.params as { id: string }).id)))

  app.put(
    '/api/pages/:id',
    {
      schema: {
        params: idSchema,
        body: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            icon: { type: 'string', maxLength: 32 },
            baseVersion: { type: 'integer', minimum: 1 },
            summary: { type: 'string', maxLength: 500 },
          },
          required: ['baseVersion'],
          additionalProperties: false,
        },
      },
    },
    async (request) =>
      updatePage(db, idParam((request.params as { id: string }).id), request.body as Parameters<typeof updatePage>[2], request.user),
  )

  app.post(
    '/api/pages/:id/move',
    {
      schema: {
        params: idSchema,
        body: {
          type: 'object',
          properties: {
            spaceId: { type: 'integer', minimum: 1 },
            parentId: { type: ['integer', 'null'], minimum: 1 },
            index: { type: 'integer', minimum: 0 },
          },
          required: ['parentId'],
          additionalProperties: false,
        },
      },
    },
    async (request) => movePage(db, idParam((request.params as { id: string }).id), request.body as Parameters<typeof movePage>[2], request.user),
  )

  app.post(
    '/api/pages/:id/pin',
    {
      schema: {
        params: idSchema,
        body: { type: 'object', properties: { pinned: { type: 'boolean' } }, required: ['pinned'], additionalProperties: false },
      },
    },
    async (request) => setPinned(db, idParam((request.params as { id: string }).id), (request.body as { pinned: boolean }).pinned),
  )

  app.delete('/api/pages/:id', { schema: { params: idSchema } }, async (request) => ({
    trashed: trashPage(db, idParam((request.params as { id: string }).id), request.user),
  }))

  app.get('/api/pages/:id/revisions', { schema: { params: idSchema } }, async (request) =>
    listRevisions(db, idParam((request.params as { id: string }).id)),
  )

  app.get('/api/pages/:id/revisions/:version', async (request) => {
    const { id, version } = request.params as { id: string; version: string }
    return getRevision(db, idParam(id), idParam(version, 'Version'))
  })

  app.post('/api/pages/:id/revisions/:version/restore', async (request) => {
    const { id, version } = request.params as { id: string; version: string }
    return restoreRevision(db, idParam(id), idParam(version, 'Version'), request.user)
  })

  app.get('/api/pages/:id/attachments', { schema: { params: idSchema } }, async (request) =>
    pageAttachments(db, idParam((request.params as { id: string }).id)),
  )

  /** Export Markdown d'une page (titre en # puis contenu). */
  app.get('/api/pages/:id/export', { schema: { params: idSchema } }, async (request, reply) => {
    const page = getPage(db, idParam((request.params as { id: string }).id))
    const file = `${slugify(page.title)}.md`
    return reply
      .header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${file}"; filename*=UTF-8''${encodeURIComponent(file)}`)
      .send(`# ${page.title}\n\n${page.content.replace(/\s+$/, '')}\n`)
  })

  // ── Recherche ────────────────────────────────────────────────────────────
  app.get(
    '/api/search',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', maxLength: 500 },
            spaceId: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request) => {
      const { q = '', spaceId, limit } = request.query as { q?: string; spaceId?: number; limit?: number }
      return searchPages(db, q, { spaceId, limit })
    },
  )

  // ── Corbeille ────────────────────────────────────────────────────────────
  app.get('/api/trash', async () => ({ days: app.config.trashDays, entries: listTrash(db) }))

  app.post('/api/trash/:id/restore', { schema: { params: idSchema } }, async (request) =>
    restorePage(db, idParam((request.params as { id: string }).id), request.user),
  )

  app.delete('/api/trash/:id', { schema: { params: idSchema } }, async (request) => ({
    deleted: purgePage(db, idParam((request.params as { id: string }).id)),
  }))
}
