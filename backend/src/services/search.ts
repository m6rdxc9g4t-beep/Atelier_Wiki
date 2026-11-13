// Recherche plein texte (SQLite FTS5) : titres et contenus, accents ignorés, préfixes acceptés.

import type { Db } from '../db/database.js'
import { isPageFormat } from '../domain/format.js'
import { plainText, searchExcerpt, slugify } from '../domain/markdown.js'

/** Marqueurs des mots trouvés dans l'extrait (le frontend les remplace par <mark>, sans HTML côté serveur). */
export const HIT_START = '\u0002'
export const HIT_END = '\u0003'

export interface SearchHit {
  id: number
  title: string
  slug: string
  icon: string
  spaceId: number
  spaceName: string
  updatedAt: string
  /** Extrait du contenu en texte brut (ni balises, ni entités, ni syntaxe), mots trouvés entre HIT_START et HIT_END. */
  snippet: string
}

/**
 * Transforme la saisie en requête FTS5 sûre : chaque mot devient un terme entre guillemets, en préfixe.
 * Les opérateurs FTS5 tapés par l'utilisateur (OR, NEAR, *, ^…) sont ainsi traités comme du texte.
 */
export function toFtsQuery(input: string): string | null {
  const terms = searchTerms(input)
  return terms.length === 0 ? null : terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ')
}

/** Mots cherchés (12 au plus), sans ponctuation ni opérateurs. */
export function searchTerms(input: string): string[] {
  const terms = input
    .normalize('NFC')
    .split(/[\s"'’`«»()\[\]{}:;,!?*^+\-/\\|<>=~@#$%&.]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 12)
  // « l'installation » → « installation » : les élisions d'une lettre n'apportent rien (sauf requête d'une lettre).
  return terms.some((t) => t.length > 1) ? terms.filter((t) => t.length > 1) : terms
}

export function searchPages(db: Db, query: string, options: { limit?: number; spaceId?: number } = {}): SearchHit[] {
  const fts = toFtsQuery(query)
  if (!fts) return []
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100)
  const params: unknown[] = [fts]
  let spaceClause = ''
  if (options.spaceId !== undefined) {
    spaceClause = 'AND p.space_id = ?'
    params.push(options.spaceId)
  }
  params.push(limit)
  const terms = searchTerms(query)
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.icon, p.space_id, p.updated_at, p.content, p.format, s.name AS space_name
       FROM pages_fts
       JOIN pages p ON p.id = pages_fts.rowid
       JOIN spaces s ON s.id = p.space_id
       WHERE pages_fts MATCH ? AND p.deleted_at IS NULL ${spaceClause}
       ORDER BY bm25(pages_fts, 8.0, 1.0)
       LIMIT ?`,
    )
    .all(...params) as { id: number; title: string; icon: string; space_id: number; updated_at: string; content: string; format: string; space_name: string }[]
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    slug: slugify(r.title),
    icon: r.icon,
    spaceId: r.space_id,
    spaceName: r.space_name,
    updatedAt: r.updated_at,
    // L'extrait est taillé dans le texte brut de la page, pas dans sa source : l'index cherche dans la source, où
    // un extrait coupé au mot près laisserait des morceaux de balises et d'entités (« amp; », « br> »).
    snippet: searchExcerpt(plainText(r.content, isPageFormat(r.format) ? r.format : 'markdown', { code: 'keep' }), terms, { start: HIT_START, end: HIT_END }),
  }))
}
