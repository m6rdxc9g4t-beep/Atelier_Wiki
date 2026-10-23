// Rédaction assistée par l'IA locale (Ollama). Routes minces : elles valident puis appellent services/ai.ts.
// Mêmes gardes Host / Origin que toutes les routes /api (crochet onRequest de app.ts).
// POST /api/ai/draft ne crée ni ne modifie aucune page : il renvoie un brouillon.

import type { FastifyInstance } from 'fastify'

import { MAX_CURRENT, MAX_INSTRUCTIONS, MAX_TITLE, type DraftInput } from '../domain/ai-prompts.js'
import { draftPage } from '../services/ai.js'

const draftBody = {
  type: 'object',
  properties: {
    instructions: { type: 'string', maxLength: MAX_INSTRUCTIONS },
    title: { type: 'string', maxLength: MAX_TITLE },
    current: { type: 'string', maxLength: MAX_CURRENT },
    mode: { type: 'string', enum: ['create', 'rewrite'] },
  },
  required: ['instructions', 'mode'],
  additionalProperties: false,
} as const

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/ai/status', async () => app.ai.status())

  app.post('/api/ai/draft', { schema: { body: draftBody } }, async (request, reply) => {
    // Si le navigateur abandonne (bouton « Annuler »), la génération s'arrête aussi côté Ollama.
    const controller = new AbortController()
    reply.raw.once('close', () => {
      if (!reply.raw.writableFinished) controller.abort()
    })
    return draftPage(app.ai, request.body as DraftInput, controller.signal)
  })
}
