// Actions du nœud Atelier : délèguent aux services du Wiki et convertissent en snake_case / atelier-table/1.

import type { Db } from '../db/database.js'
import { appendSection, slugify as slugOf } from '../domain/markdown.js'
import { notFound } from '../http/errors.js'
import { createPage, getPage, updatePage, type PageDetail } from './pages.js'
import { HIT_END, HIT_START, searchPages } from './search.js'
import { listSpaces } from './spaces.js'

type ColumnType = 'string' | 'number' | 'date' | 'datetime' | 'boolean'

interface AtelierTable {
  format: 'atelier-table/1'
  name: string
  label: string
  columns: { key: string; label: string; type: ColumnType }[]
  rows: Record<string, unknown>[]
  total: number | null
  truncated: boolean
}

export function pagePath(page: { id: number; slug: string }): string {
  return `/p/${page.id}-${page.slug}`
}

export function nodePage(page: PageDetail, publicUrl: string | null) {
  const path = pagePath(page)
  return {
    id: String(page.id),
    title: page.title,
    icon: page.icon,
    content: page.content,
    space_id: String(page.spaceId),
    space: page.space.name,
    parent_id: page.parentId === null ? null : String(page.parentId),
    version: page.version,
    created_at: page.createdAt,
    created_by: page.createdBy,
    updated_at: page.updatedAt,
    updated_by: page.updatedBy,
    path,
    url: publicUrl ? `${publicUrl}${path}` : null,
    backlinks: page.backlinks.map((b) => ({ id: String(b.id), title: b.title })),
  }
}

export function spacesTable(db: Db): AtelierTable {
  const rows = listSpaces(db).map((s) => ({ id: String(s.id), nom: s.name, slug: s.slug, description: s.description, pages: s.pageCount }))
  return {
    format: 'atelier-table/1',
    name: 'spaces',
    label: 'Espaces du wiki',
    columns: [
      { key: 'id', label: 'Id', type: 'string' },
      { key: 'nom', label: 'Nom', type: 'string' },
      { key: 'slug', label: 'Identifiant', type: 'string' },
      { key: 'description', label: 'Description', type: 'string' },
      { key: 'pages', label: 'Pages', type: 'number' },
    ],
    rows,
    total: rows.length,
    truncated: false,
  }
}

export function searchTable(db: Db, input: { query: string; space_id?: string; limit?: number }, publicUrl: string | null): AtelierTable {
  const limit = input.limit ?? 20
  const hits = searchPages(db, input.query, { limit, spaceId: input.space_id ? Number(input.space_id) : undefined })
  const rows = hits.map((h) => {
    const path = pagePath(h)
    return {
      id: String(h.id),
      titre: h.title,
      espace: h.spaceName,
      extrait: h.snippet.replaceAll(HIT_START, '').replaceAll(HIT_END, ''),
      maj_le: h.updatedAt,
      chemin: path,
      url: publicUrl ? `${publicUrl}${path}` : null,
    }
  })
  return {
    format: 'atelier-table/1',
    name: 'search',
    label: `Recherche « ${input.query} »`,
    columns: [
      { key: 'id', label: 'Id', type: 'string' },
      { key: 'titre', label: 'Titre', type: 'string' },
      { key: 'espace', label: 'Espace', type: 'string' },
      { key: 'extrait', label: 'Extrait', type: 'string' },
      { key: 'maj_le', label: 'Modifiée le', type: 'datetime' },
      { key: 'chemin', label: 'Chemin', type: 'string' },
      { key: 'url', label: 'Adresse', type: 'string' },
    ],
    rows,
    total: null,
    truncated: rows.length >= limit,
  }
}

export function pagesTable(
  db: Db,
  input: { space_id?: string; updated_since?: string; limit?: number },
  publicUrl: string | null,
): AtelierTable {
  const limit = input.limit ?? 200
  const where = ['p.deleted_at IS NULL']
  const params: unknown[] = []
  if (input.space_id) {
    where.push('p.space_id = ?')
    params.push(Number(input.space_id))
  }
  if (input.updated_since) {
    where.push('p.updated_at > ?')
    params.push(new Date(input.updated_since).toISOString())
  }
  const clause = where.join(' AND ')
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM pages p WHERE ${clause}`).get(...params) as { n: number }).n
  const rows = (
    db
      .prepare(
        `SELECT p.id, p.title, p.space_id, s.name AS space_name, p.parent_id, p.version, p.updated_at, p.updated_by
         FROM pages p JOIN spaces s ON s.id = p.space_id
         WHERE ${clause} ORDER BY p.updated_at DESC, p.id DESC LIMIT ?`,
      )
      .all(...params, limit) as {
      id: number
      title: string
      space_id: number
      space_name: string
      parent_id: number | null
      version: number
      updated_at: string
      updated_by: string
    }[]
  ).map((r) => {
    const path = pagePath({ id: r.id, slug: slugOf(r.title) })
    return {
      id: String(r.id),
      titre: r.title,
      espace_id: String(r.space_id),
      espace: r.space_name,
      parent_id: r.parent_id === null ? null : String(r.parent_id),
      version: r.version,
      maj_le: r.updated_at,
      maj_par: r.updated_by,
      chemin: path,
      url: publicUrl ? `${publicUrl}${path}` : null,
    }
  })
  return {
    format: 'atelier-table/1',
    name: 'pages',
    label: 'Pages du wiki',
    columns: [
      { key: 'id', label: 'Id', type: 'string' },
      { key: 'titre', label: 'Titre', type: 'string' },
      { key: 'espace_id', label: 'Id de l’espace', type: 'string' },
      { key: 'espace', label: 'Espace', type: 'string' },
      { key: 'parent_id', label: 'Page parente', type: 'string' },
      { key: 'version', label: 'Version', type: 'number' },
      { key: 'maj_le', label: 'Modifiée le', type: 'datetime' },
      { key: 'maj_par', label: 'Modifiée par', type: 'string' },
      { key: 'chemin', label: 'Chemin', type: 'string' },
      { key: 'url', label: 'Adresse', type: 'string' },
    ],
    rows,
    total,
    truncated: rows.length < total,
  }
}


function defaultSpaceId(db: Db): number {
  const space = listSpaces(db)[0]
  if (!space) throw notFound('Espace')
  return space.id
}

export function nodeCreatePage(
  db: Db,
  input: { title: string; content?: string; space_id?: string; parent_id?: string; icon?: string },
  user: string,
): PageDetail {
  let spaceId = input.space_id ? Number(input.space_id) : null
  const parentId = input.parent_id ? Number(input.parent_id) : null
  if (spaceId === null && parentId !== null) spaceId = getPage(db, parentId).spaceId
  return createPage(db, { spaceId: spaceId ?? defaultSpaceId(db), parentId, title: input.title, content: input.content ?? '', icon: input.icon }, user)
}

export function nodeAppend(db: Db, pageId: number, input: { content: string; heading?: string }, user: string): PageDetail {
  const page = getPage(db, pageId)
  return updatePage(
    db,
    pageId,
    { content: appendSection(page.content, input.content, input.heading), baseVersion: page.version, summary: input.heading ? `Ajout : ${input.heading}` : 'Ajout' },
    user,
  )
}

export function nodeReplace(db: Db, pageId: number, input: { content: string; title?: string }, user: string): PageDetail {
  const page = getPage(db, pageId)
  return updatePage(db, pageId, { content: input.content, title: input.title, baseVersion: page.version, summary: 'Réécriture (Atelier Nexus)' }, user)
}
