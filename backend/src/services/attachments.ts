// Pièces jointes : images collées dans l'éditeur, PDF, documents. Fichiers dans <données>/uploads/.
// Seuls des types connus sont acceptés ; le serveur décide du type servi, jamais le navigateur (nosniff).

import { randomBytes } from 'node:crypto'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'

import type { Db } from '../db/database.js'
import { ApiError, notFound } from '../http/errors.js'

/** Extension → type MIME servi. Les images s'affichent dans la page ; le reste se télécharge. */
export const ALLOWED_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
}

/** Signatures des images : un fichier .png qui n'en est pas un est refusé. */
const MAGIC: Readonly<Record<string, (b: Buffer) => boolean>> = {
  '.png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.jpg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  '.jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  '.gif': (b) => b.subarray(0, 4).toString('latin1') === 'GIF8',
  '.webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  '.avif': (b) => b.subarray(4, 12).toString('latin1').startsWith('ftypavi'),
  '.pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
}

export interface Attachment {
  id: number
  pageId: number | null
  name: string
  mime: string
  size: number
  url: string
  isImage: boolean
  createdBy: string
  createdAt: string
}

interface AttachmentRow {
  id: number
  page_id: number | null
  name: string
  stored: string
  mime: string
  size: number
  created_by: string
  created_at: string
}

/** Nom de fichier propre (affichage et en-tête Content-Disposition). */
export function safeName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(-120)
  return cleaned || 'fichier'
}

const toAttachment = (r: AttachmentRow): Attachment => ({
  id: r.id,
  pageId: r.page_id,
  name: r.name,
  mime: r.mime,
  size: r.size,
  url: `/api/attachments/${r.id}/${encodeURIComponent(r.name)}`,
  isImage: r.mime.startsWith('image/'),
  createdBy: r.created_by,
  createdAt: r.created_at,
})

export function uploadsDir(dataDir: string): string {
  return join(dataDir, 'uploads')
}

export function saveAttachment(
  db: Db,
  dataDir: string,
  input: { name: string; data: Buffer; pageId: number | null },
  user: string,
  now = new Date(),
): Attachment {
  const name = safeName(input.name)
  const ext = extname(name).toLowerCase()
  const mime = ALLOWED_TYPES[ext]
  if (!mime) {
    throw new ApiError(415, 'UNSUPPORTED_FILE', `Type de fichier non accepté (${ext || 'sans extension'}). Acceptés : ${Object.keys(ALLOWED_TYPES).join(', ')}.`)
  }
  const check = MAGIC[ext]
  if (check && !check(input.data)) throw new ApiError(415, 'UNSUPPORTED_FILE', `Le contenu de « ${name} » ne correspond pas à son extension.`)
  if (input.pageId !== null) {
    const page = db.prepare('SELECT id FROM pages WHERE id = ?').get(input.pageId)
    if (!page) throw notFound('Page')
  }
  const dir = uploadsDir(dataDir)
  mkdirSync(dir, { recursive: true })
  const stored = `${randomBytes(16).toString('hex')}${ext}`
  writeFileSync(join(dir, stored), input.data, { flag: 'wx' })
  try {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO attachments (page_id, name, stored, mime, size, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(input.pageId, name, stored, mime, input.data.length, user, now.toISOString())
    return getAttachment(db, Number(lastInsertRowid))
  } catch (error) {
    unlinkSync(join(dir, stored))
    throw error
  }
}

export function getAttachment(db: Db, id: number): Attachment {
  const r = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow | undefined
  if (!r) throw notFound('Pièce jointe')
  return toAttachment(r)
}

/** Chemin du fichier stocké (lecture pour le téléchargement). */
export function attachmentFile(db: Db, dataDir: string, id: number): { path: string; attachment: Attachment } {
  const r = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow | undefined
  if (!r) throw notFound('Pièce jointe')
  return { path: join(uploadsDir(dataDir), r.stored), attachment: toAttachment(r) }
}

export function pageAttachments(db: Db, pageId: number): Attachment[] {
  return (db.prepare('SELECT * FROM attachments WHERE page_id = ? ORDER BY created_at DESC').all(pageId) as AttachmentRow[]).map(toAttachment)
}
