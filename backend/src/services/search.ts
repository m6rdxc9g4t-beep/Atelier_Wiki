// Recherche plein texte (SQLite FTS5) : titres et contenus, accents ignorés, préfixes acceptés.

import type { Db } from '../db/database.js'
import { slugify } from '../domain/markdown.js'

/** Marqueurs du passage trouvé dans l'extrait (le frontend les remplace par <mark>, sans HTML côté serveur). */
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
  /** Extrait du contenu, passages trouvés entre HIT_START et HIT_END. */
  snippet: string
}

/**
 * Transforme la saisie en requête FTS5 sûre : chaque mot devient un terme entre guillemets, en préfixe.
 * Les opérateurs FTS5 tapés par l'utilisateur (OR, NEAR, *, ^…) sont ainsi traités comme du texte.
 */
export function toFtsQuery(input: string): string | null {
  const terms = input
    .normalize('NFC')
    .split(/[\s"'’`«»()\[\]{}:;,!?*^+\-/\\|<>=~@#$%&.]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 12)
  if (terms.length === 0) return null
  // « l'installation » → « installation » : les élisions d'une lettre n'apportent rien (sauf requête d'une lettre).
  const useful = terms.some((t) => t.length > 1) ? terms.filter((t) => t.length > 1) : terms
  return useful.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ')
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
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.icon, p.space_id, p.updated_at, s.name AS space_name,
              snippet(pages_fts, 1, '${HIT_START}', '${HIT_END}', '…', 18) AS snippet
       FROM pages_fts
       JOIN pages p ON p.id = pages_fts.rowid
       JOIN spaces s ON s.id = p.space_id
       WHERE pages_fts MATCH ? AND p.deleted_at IS NULL ${spaceClause}
       ORDER BY bm25(pages_fts, 8.0, 1.0)
       LIMIT ?`,
    )
    .all(...params) as { id: number; title: string; icon: string; space_id: number; updated_at: string; space_name: string; snippet: string }[]
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    slug: slugify(r.title),
    icon: r.icon,
    spaceId: r.space_id,
    spaceName: r.space_name,
    updatedAt: r.updated_at,
    snippet: cleanSnippet(r.snippet),
  }))
}

/** Extrait lisible : sans la syntaxe Markdown la plus bruyante, sur une ligne. */
function cleanSnippet(snippet: string): string {
  return snippet
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/[#>*_`|[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
