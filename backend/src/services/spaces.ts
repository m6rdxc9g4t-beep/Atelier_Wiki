// Espaces : grands rayons du Wiki (« Général », « Technique », « Procédures »…). Chaque page appartient à un espace.

import type { Db } from '../db/database.js'
import { normalizeTitle, slugify } from '../domain/markdown.js'
import { conflict, invalid, notFound } from '../http/errors.js'
import { emitEvents } from './events.js'

export interface Space {
  id: number
  slug: string
  name: string
  icon: string
  description: string
  position: number
  pageCount: number
  createdAt: string
  updatedAt: string
}

interface SpaceRow {
  id: number
  slug: string
  name: string
  icon: string
  description: string
  position: number
  created_at: string
  updated_at: string
  page_count?: number
}

const toSpace = (r: SpaceRow): Space => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  icon: r.icon,
  description: r.description,
  position: r.position,
  pageCount: r.page_count ?? 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const SELECT = `
  SELECT s.*, (SELECT COUNT(*) FROM pages p WHERE p.space_id = s.id AND p.deleted_at IS NULL) AS page_count
  FROM spaces s`

export function listSpaces(db: Db): Space[] {
  return (db.prepare(`${SELECT} ORDER BY s.position, s.name COLLATE NOCASE`).all() as SpaceRow[]).map(toSpace)
}

export function getSpace(db: Db, id: number): Space {
  const row = db.prepare(`${SELECT} WHERE s.id = ?`).get(id) as SpaceRow | undefined
  if (!row) throw notFound('Espace')
  return toSpace(row)
}

export function findSpaceBySlug(db: Db, slug: string): Space | null {
  const row = db.prepare(`${SELECT} WHERE s.slug = ?`).get(slug) as SpaceRow | undefined
  return row ? toSpace(row) : null
}

export interface SpaceInput {
  name?: string
  icon?: string
  description?: string
}

function cleanName(name: string | undefined): string {
  const value = (name ?? '').replace(/\s+/g, ' ').trim()
  if (!value) throw invalid("Donne un nom à l'espace.")
  if (value.length > 80) throw invalid("Le nom de l'espace dépasse 80 caractères.")
  return value
}

function ensureUniqueName(db: Db, name: string, exceptId?: number): void {
  const wanted = normalizeTitle(name)
  for (const row of db.prepare('SELECT id, name FROM spaces').all() as { id: number; name: string }[]) {
    if (row.id !== exceptId && normalizeTitle(row.name) === wanted) throw conflict(`Un espace « ${row.name} » existe déjà.`)
  }
}

function uniqueSlug(db: Db, name: string): string {
  const base = slugify(name, 'espace')
  let slug = base
  for (let i = 2; db.prepare('SELECT 1 FROM spaces WHERE slug = ?').get(slug); i++) slug = `${base}-${i}`
  return slug
}

export function createSpace(db: Db, input: SpaceInput, now = new Date()): Space {
  const name = cleanName(input.name)
  return db.transaction(() => {
    ensureUniqueName(db, name)
    const at = now.toISOString()
    const position = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM spaces').get() as { p: number }).p
    const { lastInsertRowid } = db
      .prepare('INSERT INTO spaces (slug, name, icon, description, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uniqueSlug(db, name), name, (input.icon ?? '').trim().slice(0, 16), (input.description ?? '').trim().slice(0, 500), position, at, at)
    const id = Number(lastInsertRowid)
    emitEvents(db, [{ type: 'wiki.space.created', subject: { kind: 'space', id: String(id), label: name }, data: {} }], now)
    return getSpace(db, id)
  })()
}

export function updateSpace(db: Db, id: number, input: SpaceInput, now = new Date()): Space {
  return db.transaction(() => {
    const current = getSpace(db, id)
    const name = input.name !== undefined ? cleanName(input.name) : current.name
    if (name !== current.name) ensureUniqueName(db, name, id)
    db.prepare('UPDATE spaces SET name = ?, icon = ?, description = ?, updated_at = ? WHERE id = ?').run(
      name,
      input.icon !== undefined ? input.icon.trim().slice(0, 16) : current.icon,
      input.description !== undefined ? input.description.trim().slice(0, 500) : current.description,
      now.toISOString(),
      id,
    )
    return getSpace(db, id)
  })()
}

/** Supprime un espace vide (ses pages déjà à la corbeille sont supprimées définitivement avec lui). */
export function deleteSpace(db: Db, id: number): void {
  db.transaction(() => {
    const space = getSpace(db, id)
    if (space.pageCount > 0) {
      throw conflict(`L'espace « ${space.name} » contient encore ${space.pageCount} page(s) : déplace-les ou supprime-les d'abord.`)
    }
    if ((db.prepare('SELECT COUNT(*) AS n FROM spaces').get() as { n: number }).n <= 1) {
      throw conflict('Le Wiki garde au moins un espace.')
    }
    const trashed = db.prepare('SELECT id FROM pages WHERE space_id = ?').all(id) as { id: number }[]
    db.prepare('UPDATE pages SET parent_id = NULL WHERE space_id = ?').run(id)
    for (const { id: pageId } of trashed) {
      db.prepare('DELETE FROM pages_fts WHERE rowid = ?').run(pageId)
      db.prepare('DELETE FROM page_links WHERE source_id = ?').run(pageId)
      db.prepare('DELETE FROM pages WHERE id = ?').run(pageId)
    }
    db.prepare('DELETE FROM spaces WHERE id = ?').run(id)
  })()
}
