// Pièces jointes : envoi (multipart) et lecture. Les fichiers sont servis avec un type fixé par le serveur,
// `nosniff` et une politique de sécurité qui interdit tout script (un fichier ne peut pas devenir une page active).

import type { FastifyInstance } from 'fastify'
import { createReadStream, existsSync } from 'node:fs'

import { ApiError } from '../http/errors.js'
import { attachmentFile, saveAttachment } from '../services/attachments.js'
import { idParam } from './wiki.js'

export async function attachmentRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db

  app.post('/api/attachments', async (request, reply) => {
    if (!request.isMultipart()) throw new ApiError(415, 'UNSUPPORTED_FILE', 'Envoi attendu en multipart/form-data (champ « file »).')
    const file = await request.file()
    if (!file) throw new ApiError(422, 'VALIDATION', 'Aucun fichier reçu.')
    const data = await file.toBuffer()
    if (data.length === 0) throw new ApiError(422, 'VALIDATION', 'Le fichier est vide.')
    const pageField = file.fields.pageId as { value?: unknown } | undefined
    const pageId = pageField?.value !== undefined && pageField.value !== '' ? idParam(pageField.value) : null
    reply.code(201)
    return saveAttachment(db, app.config.dataDir, { name: file.filename, data, pageId }, request.user)
  })

  app.get('/api/attachments/:id/*', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { path, attachment } = attachmentFile(db, app.config.dataDir, idParam(id, 'Pièce jointe'))
    if (!existsSync(path)) throw new ApiError(404, 'NOT_FOUND', 'Fichier introuvable sur le disque.')
    const inline = attachment.isImage || attachment.mime === 'application/pdf'
    const disposition = `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`
    // Le lecteur PDF du navigateur ne s'ouvre pas dans un document « sandbox » : les PDF n'ont que nosniff.
    if (attachment.mime !== 'application/pdf') {
      reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
    }
    return reply
      .header('Content-Type', attachment.mime)
      .header('Content-Length', attachment.size)
      .header('Content-Disposition', disposition)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(createReadStream(path))
  })
}
