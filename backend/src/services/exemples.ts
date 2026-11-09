// Exemples de la suite (exemples-suite/, format atelier-exemples/1) : histoires fictives communes à toutes les apps,
// générées par Atelier_Deploy (exemples/generer.py) et copiées telles quelles dans chaque dépôt.
//
// Pour le Wiki, une histoire apporte un espace et ses pages reliées par [[…]] : parcours de l'exemple dans la suite,
// bilans mensuels (chiffres des relevés convertis par Convert), procédures. Toute écriture passe par `createSpace` /
// `createPage` (index, liens, historique, événements). L'espace créé est noté dans `suite_examples` : le retrait
// supprime cet espace et ses pages, et rien d'autre.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Db } from '../db/database.js'
import { ApiError } from '../http/errors.js'
import { createPage, trashPage } from './pages.js'
import { createSpace, deleteSpace } from './spaces.js'

export const EXEMPLES_FORMAT = 'atelier-exemples/1'
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export interface ExempleEtape {
  app: string
  titre: string
  texte: string
}

export interface ExempleHistoire {
  id: string
  titre: string
  sous_titre: string
  secteur: string
  resume: string
  parcours: ExempleEtape[]
  espace: string
  pages: number
  charge: boolean
  spaceId: number | null
  /** Page d'entrée de l'exemple (« Parcours de l'exemple »), une fois chargé. */
  pageId: number | null
}

interface Part {
  format: string
  histoire: { id: string; titre: string }
  espace: { nom: string; icone: string; description: string }
  pages: { titre: string; parent: string | null; icone: string | null; contenu: string }[]
}

function readJson<T>(file: string): T | null {
  try {
    const data: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return data !== null && typeof data === 'object' && (data as { format?: unknown }).format === EXEMPLES_FORMAT ? (data as T) : null
  } catch {
    return null
  }
}

function readPart(dir: string, histoire: string): Part {
  const part = ID.test(histoire) ? readJson<Part>(join(dir, `${histoire}.json`)) : null
  if (part === null || !Array.isArray(part.pages)) throw new ApiError(404, 'NOT_FOUND', 'Exemple introuvable.')
  return part
}

function loaded(db: Db): Map<string, number> {
  const rows = db.prepare('SELECT histoire, space_id FROM suite_examples').all() as { histoire: string; space_id: number }[]
  return new Map(rows.map((r) => [r.histoire, r.space_id]))
}

function entryPage(db: Db, spaceId: number): number | null {
  const row = db
    .prepare('SELECT id FROM pages WHERE space_id = ? AND deleted_at IS NULL AND parent_id IS NULL ORDER BY position, id LIMIT 1')
    .get(spaceId) as { id: number } | undefined
  return row?.id ?? null
}

/** Histoires livrées avec cette installation (liste vide si le dossier est absent). */
export function listExemples(db: Db, dir: string): ExempleHistoire[] {
  const index = readJson<{ histoires?: (ExempleHistoire & { parcours?: ExempleEtape[] })[] }>(join(dir, 'index.json'))
  if (index === null) return []
  const state = loaded(db)
  const out: ExempleHistoire[] = []
  for (const h of index.histoires ?? []) {
    let part: Part
    try {
      part = readPart(dir, h.id)
    } catch {
      continue
    }
    const spaceId = state.get(h.id) ?? null
    out.push({
      id: h.id,
      titre: h.titre,
      sous_titre: h.sous_titre,
      secteur: h.secteur,
      resume: h.resume,
      parcours: h.parcours ?? [],
      espace: part.espace.nom,
      pages: part.pages.length,
      charge: spaceId !== null,
      spaceId,
      pageId: spaceId === null ? null : entryPage(db, spaceId),
    })
  }
  return out
}

/** Charge l'histoire une fois : un second appel renvoie l'espace déjà créé. */
export function loadExemple(db: Db, dir: string, histoire: string, user: string, now = new Date()): { spaceId: number; pageId: number | null; dejaCharge: boolean } {
  const part = readPart(dir, histoire)
  const existing = loaded(db).get(histoire)
  if (existing !== undefined) return { spaceId: existing, pageId: entryPage(db, existing), dejaCharge: true }

  return db.transaction(() => {
    const space = createSpace(db, { name: part.espace.nom, icon: part.espace.icone, description: part.espace.description }, now)
    db.prepare('INSERT INTO suite_examples (histoire, space_id, created_at) VALUES (?, ?, ?)').run(histoire, space.id, now.toISOString())
    const ids = new Map<string, number>()
    for (const p of part.pages) {
      const parentId = p.parent === null ? null : (ids.get(p.parent) ?? null)
      const page = createPage(db, { spaceId: space.id, parentId, title: p.titre, content: p.contenu, ...(p.icone ? { icon: p.icone } : {}) }, user, now)
      ids.set(p.titre, page.id)
    }
    return { spaceId: space.id, pageId: entryPage(db, space.id), dejaCharge: false }
  })()
}

/** Supprime l'espace créé par l'histoire et ses pages (sans passer par la corbeille). */
export function removeExemple(db: Db, dir: string, histoire: string, user: string, now = new Date()): void {
  readPart(dir, histoire)
  const spaceId = loaded(db).get(histoire)
  if (spaceId === undefined) throw new ApiError(404, 'NOT_FOUND', 'Cet exemple n’est pas chargé.')
  db.transaction(() => {
    const roots = db.prepare('SELECT id FROM pages WHERE space_id = ? AND parent_id IS NULL AND deleted_at IS NULL').all(spaceId) as { id: number }[]
    // Pages à la corbeille (événements wiki.page.deleted), puis l'espace, qui emporte les pages de sa corbeille.
    for (const { id } of roots) trashPage(db, id, user, now)
    if (db.prepare('SELECT 1 FROM spaces WHERE id = ?').get(spaceId)) deleteSpace(db, spaceId)
    db.prepare('DELETE FROM suite_examples WHERE histoire = ?').run(histoire)
  })()
}
