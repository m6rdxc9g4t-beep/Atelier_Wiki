// Exemples de la suite : histoires fictives reliées d'une app à l'autre (« Exemples de la suite »).

import type { FastifyInstance } from 'fastify'

import { listExemples, loadExemple, removeExemple } from '../services/exemples.js'

const params = {
  type: 'object',
  properties: { histoire: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' } },
  required: ['histoire'],
} as const

export async function exempleRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db
  const dir = () => app.config.exemplesDir

  app.get('/api/exemples-suite', async () => listExemples(db, dir()))

  app.post('/api/exemples-suite/:histoire', { schema: { params } }, async (request) =>
    loadExemple(db, dir(), (request.params as { histoire: string }).histoire, request.user),
  )

  app.delete('/api/exemples-suite/:histoire', { schema: { params } }, async (request, reply) => {
    removeExemple(db, dir(), (request.params as { histoire: string }).histoire, request.user)
    return reply.code(204).send()
  })
}
