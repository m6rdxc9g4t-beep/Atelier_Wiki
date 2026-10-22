// Pages : arborescence par espace, contenu Markdown, versions (historique), liens et corbeille.
// Toute écriture : une transaction qui met à jour la page, son index plein texte, ses liens, son historique
// et émet l'événement atelier-node/1 correspondant.

import type { Db } from '../db/database.js'
import { excerpt, extractLinks, normalizeTitle, slugify } from '../domain/markdown.js'
import { ApiError, conflict, invalid, notFound } from '../http/errors.js'
import { emitEvents, type WikiEvent } from './events.js'
import { getSpace } from './spaces.js'

export const MAX_TITLE = 200
export const MAX_CONTENT = 2_000_000
/** Résumé des enregistrements faits en cochant une case depuis la lecture (regroupés dans l'historique). */
export const TASK_SUMMARY = 'Case cochée'

interface PageRow {
  id: number
  space_id: number
  parent_id: number | null
  title: string
  icon: string
  content: string
  position: number
  version: number
  pinned: number
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  deleted_by: string | null
  deleted_root: number | null
}

export interface PageSummary {
  id: number
  spaceId: number
  parentId: number | null
  title: string
  slug: string
  icon: string
  position: number
  pinned: boolean
  version: number
  updatedAt: string
  updatedBy: string
}

export interface PageRef {
  id: number
  title: string
  icon: string
  slug: string
}

export interface PageDetail extends PageSummary {
  content: string
  createdAt: string
  createdBy: string
  deletedAt: string | null
  space: { id: number; name: string; slug: string; icon: string }
  breadcrumbs: PageRef[]
  children: (PageSummary & { excerpt: string })[]
  backlinks: (PageRef & { spaceId: number })[]
}

const ref = (r: Pick<PageRow, 'id' | 'title' | 'icon'>): PageRef => ({ id: r.id, title: r.title, icon: r.icon, slug: slugify(r.title) })

export const toSummary = (r: PageRow): PageSummary => ({
  id: r.id,
  spaceId: r.space_id,
  parentId: r.parent_id,
  title: r.title,
  slug: slugify(r.title),
  icon: r.icon,
  position: r.position,
  pinned: r.pinned === 1,
  version: r.version,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
})

function row(db: Db, id: number): PageRow {
  const r = db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as PageRow | undefined
  if (!r) throw notFound('Page')
  return r
}

function liveRow(db: Db, id: number): PageRow {
  const r = row(db, id)
  if (r.deleted_at) throw new ApiError(410, 'NOT_FOUND', 'Cette page est dans la corbeille.')
  return r
}

function cleanTitle(title: unknown): string {
  const value = String(title ?? '').replace(/\s+/g, ' ').trim()
  if (!value) throw invalid('Donne un titre à la page.')
  if (value.length > MAX_TITLE) throw invalid(`Le titre dépasse ${MAX_TITLE} caractères.`)
  return value
}

function cleanContent(content: unknown): string {
  const value = String(content ?? '').replace(/\r\n?/g, '\n')
  if (value.length > MAX_CONTENT) throw invalid('La page est trop longue (2 millions de caractères au plus).')
  return value
}

const cleanIcon = (icon: unknown) => String(icon ?? '').trim().slice(0, 16)

/** Index plein texte + liens sortants, recalculés à chaque écriture du contenu. */
function index(db: Db, id: number, title: string, content: string): void {
  db.prepare('DELETE FROM pages_fts WHERE rowid = ?').run(id)
  db.prepare('INSERT INTO pages_fts (rowid, title, content) VALUES (?, ?, ?)').run(id, title, content)
  db.prepare('DELETE FROM page_links WHERE source_id = ?').run(id)
  const insert = db.prepare('INSERT INTO page_links (source_id, target_id, target_title) VALUES (?, ?, ?)')
  for (const link of extractLinks(content)) insert.run(id, link.targetId, link.targetTitle)
}

function saveRevision(db: Db, page: Pick<PageRow, 'id' | 'version' | 'title' | 'icon' | 'content'>, author: string, summary: string, at: string): void {
  db.prepare(
    'INSERT INTO page_revisions (page_id, version, title, icon, content, author, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(page.id, page.version, page.title, page.icon, page.content, author, summary.trim().slice(0, 200), at)
}

/** Enfants vivants d'un parent (null = racine de l'espace), dans l'ordre. */
function siblings(db: Db, spaceId: number, parentId: number | null, exceptId?: number): PageRow[] {
  const rows = (
    parentId === null
      ? db.prepare('SELECT * FROM pages WHERE space_id = ? AND parent_id IS NULL AND deleted_at IS NULL ORDER BY position, id').all(spaceId)
      : db.prepare('SELECT * FROM pages WHERE parent_id = ? AND deleted_at IS NULL ORDER BY position, id').all(parentId)
  ) as PageRow[]
  return exceptId === undefined ? rows : rows.filter((r) => r.id !== exceptId)
}

/** Range `pageId` à l'index voulu parmi ses frères et renumérote (0, 1, 2…). */
function placeAt(db: Db, pageId: number, ordered: PageRow[], index: number | undefined): void {
  const ids = ordered.map((r) => r.id)
  const at = index === undefined ? ids.length : Math.max(0, Math.min(index, ids.length))
  ids.splice(at, 0, pageId)
  const update = db.prepare('UPDATE pages SET position = ? WHERE id = ?')
  ids.forEach((id, position) => update.run(position, id))
}

/** Ids de la page et de toutes ses sous-pages vivantes. */
function subtreeIds(db: Db, id: number): number[] {
  return (
    db
      .prepare(
        `WITH RECURSIVE tree(id) AS (
           SELECT ?
           UNION ALL
           SELECT p.id FROM pages p JOIN tree t ON p.parent_id = t.id WHERE p.deleted_at IS NULL
         ) SELECT id FROM tree`,
      )
      .all(id) as { id: number }[]
  ).map((r) => r.id)
}

function ancestors(db: Db, page: PageRow): PageRef[] {
  const out: PageRef[] = []
  let parentId = page.parent_id
  const seen = new Set<number>()
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = db.prepare('SELECT id, title, icon, parent_id FROM pages WHERE id = ?').get(parentId) as
      | (Pick<PageRow, 'id' | 'title' | 'icon' | 'parent_id'>)
      | undefined
    if (!parent) break
    out.unshift(ref(parent))
    parentId = parent.parent_id
  }
  return out
}

export function backlinks(db: Db, page: Pick<PageRow, 'id' | 'title'>): (PageRef & { spaceId: number })[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT p.id, p.title, p.icon, p.space_id FROM page_links l
       JOIN pages p ON p.id = l.source_id
       WHERE (l.target_id = ? OR l.target_title = ?) AND p.id <> ? AND p.deleted_at IS NULL
       ORDER BY p.title COLLATE NOCASE`,
    )
    .all(page.id, normalizeTitle(page.title), page.id) as (Pick<PageRow, 'id' | 'title' | 'icon' | 'space_id'>)[]
  return rows.map((r) => ({ ...ref(r), spaceId: r.space_id }))
}

export function getPage(db: Db, id: number): PageDetail {
  const r = row(db, id)
  const space = getSpace(db, r.space_id)
  const children = siblings(db, r.space_id, r.id).map((c) => ({ ...toSummary(c), excerpt: excerpt(c.content, 140) }))
  return {
    ...toSummary(r),
    content: r.content,
    createdAt: r.created_at,
    createdBy: r.created_by,
    deletedAt: r.deleted_at,
    space: { id: space.id, name: space.name, slug: space.slug, icon: space.icon },
    breadcrumbs: ancestors(db, r),
    children: r.deleted_at ? [] : children,
    backlinks: backlinks(db, r),
  }
}

export interface CreatePageInput {
  spaceId: number
  parentId?: number | null
  title: string
  content?: string
  icon?: string
  /** Rang parmi les frères (défaut : à la fin). */
  index?: number
}

export function createPage(db: Db, input: CreatePageInput, user: string, now = new Date()): PageDetail {
  const title = cleanTitle(input.title)
  const content = cleanContent(input.content)
  const icon = cleanIcon(input.icon)
  return db.transaction(() => {
    getSpace(db, input.spaceId)
    const parentId = input.parentId ?? null
    if (parentId !== null) {
      const parent = liveRow(db, parentId)
      if (parent.space_id !== input.spaceId) throw invalid("La page parente appartient à un autre espace.")
    }
    const at = now.toISOString()
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO pages (space_id, parent_id, title, icon, content, position, version, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?)`,
      )
      .run(input.spaceId, parentId, title, icon, content, user, user, at, at)
    const id = Number(lastInsertRowid)
    placeAt(db, id, siblings(db, input.spaceId, parentId, id), input.index)
    index(db, id, title, content)
    saveRevision(db, { id, version: 1, title, icon, content }, user, 'Création', at)
    emitEvents(
      db,
      [{
        type: 'wiki.page.created',
        subject: { kind: 'page', id: String(id), label: title },
        data: { space_id: String(input.spaceId), parent_id: parentId === null ? null : String(parentId), version: 1 },
      }],
      now,
    )
    return getPage(db, id)
  })()
}

export interface UpdatePageInput {
  title?: string
  content?: string
  icon?: string
  /** Version sur laquelle la modification a été faite : protège contre l'écrasement d'une modification concurrente. */
  baseVersion: number
  summary?: string
}

export function updatePage(db: Db, id: number, input: UpdatePageInput, user: string, now = new Date()): PageDetail {
  return db.transaction(() => {
    const current = liveRow(db, id)
    if (input.baseVersion !== current.version) {
      throw conflict(
        `${current.updated_by} a modifié cette page entre-temps (version ${current.version}). Recharge-la avant d'enregistrer, ou garde ta version.`,
        { current: getPage(db, id) },
      )
    }
    const title = input.title !== undefined ? cleanTitle(input.title) : current.title
    const content = input.content !== undefined ? cleanContent(input.content) : current.content
    const icon = input.icon !== undefined ? cleanIcon(input.icon) : current.icon
    const fields = [
      title !== current.title && 'title',
      content !== current.content && 'content',
      icon !== current.icon && 'icon',
    ].filter((f): f is string => Boolean(f))
    if (fields.length === 0) return getPage(db, id)

    const version = current.version + 1
    const at = now.toISOString()
    db.prepare('UPDATE pages SET title = ?, content = ?, icon = ?, version = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(
      title, content, icon, version, user, at, id,
    )
    index(db, id, title, content)
    // Cases cochées en série par la même personne : une seule entrée d'historique (la dernière), pas une par clic.
    if (input.summary === TASK_SUMMARY) {
      const last = db.prepare('SELECT id, author, summary, created_at FROM page_revisions WHERE page_id = ? ORDER BY version DESC LIMIT 1').get(id) as
        | { id: number; author: string; summary: string; created_at: string }
        | undefined
      if (last && last.author === user && last.summary === TASK_SUMMARY && now.getTime() - new Date(last.created_at).getTime() < 15 * 60_000) {
        db.prepare('DELETE FROM page_revisions WHERE id = ?').run(last.id)
      }
    }
    saveRevision(db, { id, version, title, icon, content }, user, input.summary ?? '', at)
    emitEvents(
      db,
      [{
        type: 'wiki.page.updated',
        subject: { kind: 'page', id: String(id), label: title },
        data: { space_id: String(current.space_id), fields, version },
      }],
      now,
    )
    return getPage(db, id)
  })()
}

export interface MovePageInput {
  spaceId?: number
  parentId: number | null
  index?: number
}

export function movePage(db: Db, id: number, input: MovePageInput, user: string, now = new Date()): PageDetail {
  return db.transaction(() => {
    const page = liveRow(db, id)
    const spaceId = input.spaceId ?? page.space_id
    getSpace(db, spaceId)
    const parentId = input.parentId ?? null
    if (parentId !== null) {
      const parent = liveRow(db, parentId)
      if (parent.space_id !== spaceId) throw invalid("La page parente appartient à un autre espace.")
      if (subtreeIds(db, id).includes(parentId)) throw invalid('Une page ne peut pas être rangée sous elle-même ou sous une de ses sous-pages.')
    }
    const subtree = subtreeIds(db, id)
    if (spaceId !== page.space_id) {
      const update = db.prepare('UPDATE pages SET space_id = ? WHERE id = ?')
      for (const pageId of subtree) update.run(spaceId, pageId)
    }
    db.prepare('UPDATE pages SET parent_id = ? WHERE id = ?').run(parentId, id)
    placeAt(db, id, siblings(db, spaceId, parentId, id), input.index)
    // Renumérote aussi les anciens frères (trou laissé par le départ de la page).
    if (page.parent_id !== parentId || page.space_id !== spaceId) {
      siblings(db, page.space_id, page.parent_id).forEach((s, i) => db.prepare('UPDATE pages SET position = ? WHERE id = ?').run(i, s.id))
      emitEvents(
        db,
        [{
          type: 'wiki.page.moved',
          subject: { kind: 'page', id: String(id), label: page.title },
          data: {
            space_id: String(spaceId),
            parent_id: parentId === null ? null : String(parentId),
            from_space_id: String(page.space_id),
            from_parent_id: page.parent_id === null ? null : String(page.parent_id),
            pages: subtree.length,
          },
        }],
        now,
      )
    }
    void user
    return getPage(db, id)
  })()
}

export function setPinned(db: Db, id: number, pinned: boolean): PageDetail {
  liveRow(db, id)
  db.prepare('UPDATE pages SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id)
  return getPage(db, id)
}

/** Met la page et ses sous-pages à la corbeille. Renvoie le nombre de pages concernées. */
export function trashPage(db: Db, id: number, user: string, now = new Date()): number {
  return db.transaction(() => {
    const page = liveRow(db, id)
    const ids = subtreeIds(db, id)
    const at = now.toISOString()
    const update = db.prepare('UPDATE pages SET deleted_at = ?, deleted_by = ?, deleted_root = ?, pinned = 0 WHERE id = ?')
    for (const pageId of ids) update.run(at, user, id, pageId)
    siblings(db, page.space_id, page.parent_id).forEach((s, i) => db.prepare('UPDATE pages SET position = ? WHERE id = ?').run(i, s.id))
    emitEvents(
      db,
      [{ type: 'wiki.page.deleted', subject: { kind: 'page', id: String(id), label: page.title }, data: { space_id: String(page.space_id), pages: ids.length } }],
      now,
    )
    return ids.length
  })()
}

export interface TrashEntry {
  id: number
  title: string
  icon: string
  spaceId: number
  spaceName: string
  deletedAt: string
  deletedBy: string
  /** Nombre de pages restaurées avec elle (elle comprise). */
  pages: number
}

export function listTrash(db: Db): TrashEntry[] {
  return (
    db
      .prepare(
        `SELECT p.id, p.title, p.icon, p.space_id, s.name AS space_name, p.deleted_at, p.deleted_by,
                (SELECT COUNT(*) FROM pages c WHERE c.deleted_root = p.id) AS pages
         FROM pages p JOIN spaces s ON s.id = p.space_id
         WHERE p.deleted_root = p.id
         ORDER BY p.deleted_at DESC`,
      )
      .all() as { id: number; title: string; icon: string; space_id: number; space_name: string; deleted_at: string; deleted_by: string; pages: number }[]
  ).map((r) => ({
    id: r.id,
    title: r.title,
    icon: r.icon,
    spaceId: r.space_id,
    spaceName: r.space_name,
    deletedAt: r.deleted_at,
    deletedBy: r.deleted_by ?? '',
    pages: r.pages,
  }))
}

function trashRoot(db: Db, id: number): PageRow {
  const page = row(db, id)
  if (page.deleted_root !== id) throw notFound('Page dans la corbeille')
  return page
}

export function restorePage(db: Db, id: number, user: string, now = new Date()): PageDetail {
  return db.transaction(() => {
    const page = trashRoot(db, id)
    db.prepare('UPDATE pages SET deleted_at = NULL, deleted_by = NULL, deleted_root = NULL WHERE deleted_root = ?').run(id)
    // Parent supprimé entre-temps (ou toujours à la corbeille) : la page revient à la racine de son espace.
    let parentId = page.parent_id
    if (parentId !== null) {
      const parent = db.prepare('SELECT deleted_at, space_id FROM pages WHERE id = ?').get(parentId) as { deleted_at: string | null; space_id: number } | undefined
      if (!parent || parent.deleted_at || parent.space_id !== page.space_id) parentId = null
    }
    db.prepare('UPDATE pages SET parent_id = ? WHERE id = ?').run(parentId, id)
    placeAt(db, id, siblings(db, page.space_id, parentId, id), undefined)
    emitEvents(
      db,
      [{ type: 'wiki.page.restored', subject: { kind: 'page', id: String(id), label: page.title }, data: { space_id: String(page.space_id) } }],
      now,
    )
    void user
    return getPage(db, id)
  })()
}

/** Suppression définitive d'une entrée de la corbeille (la page et ses sous-pages). */
export function purgePage(db: Db, id: number): number {
  return db.transaction(() => {
    trashRoot(db, id)
    return purgeRoots(db, [id])
  })()
}

function purgeRoots(db: Db, roots: number[]): number {
  let count = 0
  for (const root of roots) {
    const ids = (db.prepare('SELECT id FROM pages WHERE deleted_root = ?').all(root) as { id: number }[]).map((r) => r.id)
    // Une page vivante rangée sous une page purgée (cas improbable) remonte à la racine.
    const detach = db.prepare('UPDATE pages SET parent_id = NULL WHERE parent_id = ?')
    for (const pageId of ids) detach.run(pageId)
    for (const pageId of ids) {
      db.prepare('DELETE FROM pages_fts WHERE rowid = ?').run(pageId)
      db.prepare('DELETE FROM pages WHERE id = ?').run(pageId)
    }
    count += ids.length
  }
  return count
}

/** Vide les entrées de la corbeille plus vieilles que `days` jours. */
export function purgeExpiredTrash(db: Db, days: number, now = new Date()): number {
  const limit = new Date(now.getTime() - days * 864e5).toISOString()
  return db.transaction(() => {
    const roots = (db.prepare('SELECT id FROM pages WHERE deleted_root = id AND deleted_at < ?').all(limit) as { id: number }[]).map((r) => r.id)
    return purgeRoots(db, roots)
  })()
}

/** Arborescence d'un espace : liste à plat, triée par parent puis position (le frontend construit l'arbre). */
export function spaceTree(db: Db, spaceId: number): PageSummary[] {
  getSpace(db, spaceId)
  return (db.prepare('SELECT * FROM pages WHERE space_id = ? AND deleted_at IS NULL ORDER BY parent_id, position, id').all(spaceId) as PageRow[]).map(toSummary)
}

export interface TitleEntry {
  id: number
  title: string
  icon: string
  spaceId: number
}

/** Index des titres : résolution des liens [[Titre]] et recherche instantanée par titre. */
export function titles(db: Db): TitleEntry[] {
  return (
    db.prepare('SELECT id, title, icon, space_id FROM pages WHERE deleted_at IS NULL ORDER BY title COLLATE NOCASE').all() as {
      id: number
      title: string
      icon: string
      space_id: number
    }[]
  ).map((r) => ({ id: r.id, title: r.title, icon: r.icon, spaceId: r.space_id }))
}

export function recentPages(db: Db, limit = 12): (PageSummary & { excerpt: string; spaceName: string })[] {
  return (
    db
      .prepare(
        `SELECT p.*, s.name AS space_name FROM pages p JOIN spaces s ON s.id = p.space_id
         WHERE p.deleted_at IS NULL ORDER BY p.updated_at DESC, p.id DESC LIMIT ?`,
      )
      .all(limit) as (PageRow & { space_name: string })[]
  ).map((r) => ({ ...toSummary(r), excerpt: excerpt(r.content, 140), spaceName: r.space_name }))
}

export function pinnedPages(db: Db): (PageSummary & { spaceName: string })[] {
  return (
    db
      .prepare(
        `SELECT p.*, s.name AS space_name FROM pages p JOIN spaces s ON s.id = p.space_id
         WHERE p.deleted_at IS NULL AND p.pinned = 1 ORDER BY p.title COLLATE NOCASE`,
      )
      .all() as (PageRow & { space_name: string })[]
  ).map((r) => ({ ...toSummary(r), spaceName: r.space_name }))
}

// ── Historique ───────────────────────────────────────────────────────────────

export interface RevisionSummary {
  version: number
  title: string
  author: string
  summary: string
  createdAt: string
  size: number
}

export function listRevisions(db: Db, pageId: number): RevisionSummary[] {
  row(db, pageId)
  return (
    db
      .prepare(
        'SELECT version, title, author, summary, created_at, LENGTH(content) AS size FROM page_revisions WHERE page_id = ? ORDER BY version DESC',
      )
      .all(pageId) as { version: number; title: string; author: string; summary: string; created_at: string; size: number }[]
  ).map((r) => ({ version: r.version, title: r.title, author: r.author, summary: r.summary, createdAt: r.created_at, size: r.size }))
}

export function getRevision(db: Db, pageId: number, version: number) {
  const r = db
    .prepare('SELECT version, title, icon, content, author, summary, created_at FROM page_revisions WHERE page_id = ? AND version = ?')
    .get(pageId, version) as { version: number; title: string; icon: string; content: string; author: string; summary: string; created_at: string } | undefined
  if (!r) throw notFound('Version')
  return { version: r.version, title: r.title, icon: r.icon, content: r.content, author: r.author, summary: r.summary, createdAt: r.created_at }
}

/** Remet une ancienne version : crée une NOUVELLE version identique à l'ancienne (l'historique ne perd rien). */
export function restoreRevision(db: Db, pageId: number, version: number, user: string, now = new Date()): PageDetail {
  const old = getRevision(db, pageId, version)
  const current = liveRow(db, pageId)
  return updatePage(
    db,
    pageId,
    { title: old.title, content: old.content, icon: old.icon, baseVersion: current.version, summary: `Retour à la version ${version}` },
    user,
    now,
  )
}
