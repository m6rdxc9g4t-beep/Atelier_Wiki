import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { openDatabase, type Db } from '../src/db/database.js'
import { ApiError } from '../src/http/errors.js'
import {
  createPage,
  getPage,
  getRevision,
  listRevisions,
  listTrash,
  movePage,
  purgeExpiredTrash,
  purgePage,
  restorePage,
  restoreRevision,
  spaceTree,
  trashPage,
  updatePage,
} from '../src/services/pages.js'
import { searchPages } from '../src/services/search.js'
import { seedIfEmpty } from '../src/services/seed.js'
import { createSpace, deleteSpace, listSpaces } from '../src/services/spaces.js'

const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof ApiError, `ApiError attendue, reçu ${String(error)}`)
    return { status: error.status, code: error.code }
  }
  assert.fail('une erreur était attendue')
}

describe('espaces et pages', () => {
  let db: Db
  let space: number

  beforeEach(() => {
    db = openDatabase(':memory:')
    space = createSpace(db, { name: 'Technique', icon: '🛠️' }).id
  })

  it('refuse deux espaces de même nom (sans casse ni accents)', () => {
    assert.deepEqual(code(() => createSpace(db, { name: 'TECHNIQUE' })), { status: 409, code: 'CONFLICT' })
    assert.equal(createSpace(db, { name: 'Technique 2' }).slug, 'technique-2')
  })

  it('crée une page, la range à la fin de ses frères et garde la version 1 dans l’historique', () => {
    const a = createPage(db, { spaceId: space, title: 'A' }, 'alice')
    const b = createPage(db, { spaceId: space, title: 'B' }, 'alice')
    const first = createPage(db, { spaceId: space, title: 'Premier', index: 0 }, 'alice')
    assert.deepEqual(spaceTree(db, space).map((p) => p.title), ['Premier', 'A', 'B'])
    assert.equal(a.version, 1)
    assert.equal(listRevisions(db, b.id).length, 1)
    assert.equal(getPage(db, first.id).createdBy, 'alice')
  })

  it('incrémente la version, refuse une modification faite sur une version dépassée', () => {
    const page = createPage(db, { spaceId: space, title: 'Doc', content: 'v1' }, 'alice')
    const v2 = updatePage(db, page.id, { content: 'v2', baseVersion: 1, summary: 'relecture' }, 'bob')
    assert.equal(v2.version, 2)
    assert.equal(v2.updatedBy, 'bob')
    // Rien de changé : pas de nouvelle version.
    assert.equal(updatePage(db, page.id, { content: 'v2', baseVersion: 2 }, 'bob').version, 2)
    // Bob part de la version 1 alors qu'on est en 2.
    assert.deepEqual(code(() => updatePage(db, page.id, { content: 'autre', baseVersion: 1 }, 'carole')), { status: 409, code: 'CONFLICT' })
    assert.deepEqual(listRevisions(db, page.id).map((r) => [r.version, r.author, r.summary]), [
      [2, 'bob', 'relecture'],
      [1, 'alice', 'Création'],
    ])
  })

  it('regroupe dans l’historique les cases cochées à la suite par la même personne', () => {
    const page = createPage(db, { spaceId: space, title: 'Liste', content: '- [ ] a\n- [ ] b' }, 'alice')
    const t0 = new Date('2026-10-22T10:00:00Z')
    updatePage(db, page.id, { content: '- [x] a\n- [ ] b', baseVersion: 1, summary: 'Case cochée' }, 'alice', t0)
    updatePage(db, page.id, { content: '- [x] a\n- [x] b', baseVersion: 2, summary: 'Case cochée' }, 'alice', new Date(t0.getTime() + 60_000))
    updatePage(db, page.id, { content: '- [ ] a\n- [x] b', baseVersion: 3, summary: 'Case cochée' }, 'bob', new Date(t0.getTime() + 120_000))
    assert.deepEqual(listRevisions(db, page.id).map((r) => [r.version, r.author]), [
      [4, 'bob'],
      [3, 'alice'],
      [1, 'alice'],
    ])
    assert.equal(getPage(db, page.id).version, 4, 'la version avance quand même (verrou optimiste)')
  })

  it('revient à une ancienne version en créant une nouvelle version', () => {
    const page = createPage(db, { spaceId: space, title: 'Doc', content: 'original' }, 'alice')
    updatePage(db, page.id, { title: 'Doc renommé', content: 'modifié', baseVersion: 1 }, 'bob')
    const restored = restoreRevision(db, page.id, 1, 'carole')
    assert.equal(restored.version, 3)
    assert.equal(restored.title, 'Doc')
    assert.equal(restored.content, 'original')
    assert.equal(getRevision(db, page.id, 3).summary, 'Retour à la version 1')
  })

  it('calcule le fil d’Ariane, les enfants et les liens entrants (par titre et par id)', () => {
    const parent = createPage(db, { spaceId: space, title: 'Serveurs' }, 'a')
    const child = createPage(db, { spaceId: space, parentId: parent.id, title: 'Procédure de sauvegarde' }, 'a')
    const grandChild = createPage(db, { spaceId: space, parentId: child.id, title: 'Restauration' }, 'a')
    createPage(db, { spaceId: space, title: 'Lien titre', content: 'Voir [[procedure de SAUVEGARDE]].' }, 'a')
    createPage(db, { spaceId: space, title: 'Lien id', content: `Voir [ici](/p/${child.id}-x).` }, 'a')
    createPage(db, { spaceId: space, title: 'Lien en code', content: '`[[Procédure de sauvegarde]]`' }, 'a')

    const detail = getPage(db, child.id)
    assert.deepEqual(detail.breadcrumbs.map((b) => b.title), ['Serveurs'])
    assert.deepEqual(detail.children.map((c) => c.id), [grandChild.id])
    assert.deepEqual(detail.backlinks.map((b) => b.title), ['Lien id', 'Lien titre'])

    // Après un renommage, les liens [[ancien titre]] ne pointent plus vers la page ; les liens par id, si.
    updatePage(db, child.id, { title: 'Sauvegardes', baseVersion: 1 }, 'a')
    assert.deepEqual(getPage(db, child.id).backlinks.map((b) => b.title), ['Lien id'])
  })

  it('déplace une page (et ses sous-pages) sans permettre de cycle', () => {
    const other = createSpace(db, { name: 'Procédures' }).id
    const a = createPage(db, { spaceId: space, title: 'A' }, 'x')
    const b = createPage(db, { spaceId: space, parentId: a.id, title: 'B' }, 'x')
    const c = createPage(db, { spaceId: space, title: 'C' }, 'x')
    assert.deepEqual(code(() => movePage(db, a.id, { parentId: b.id }, 'x')), { status: 422, code: 'VALIDATION' })
    assert.deepEqual(code(() => movePage(db, a.id, { parentId: a.id }, 'x')), { status: 422, code: 'VALIDATION' })

    movePage(db, a.id, { spaceId: other, parentId: null }, 'x')
    assert.equal(getPage(db, b.id).spaceId, other, 'la sous-page suit')
    assert.deepEqual(spaceTree(db, space).map((p) => [p.title, p.position]), [['C', 0]])

    movePage(db, c.id, { spaceId: other, parentId: a.id, index: 0 }, 'x')
    assert.deepEqual(getPage(db, a.id).children.map((p) => p.title), ['C', 'B'])
  })

  it('met à la corbeille avec les sous-pages, restaure, purge', () => {
    const a = createPage(db, { spaceId: space, title: 'A', content: 'zèbre' }, 'x')
    const b = createPage(db, { spaceId: space, parentId: a.id, title: 'B' }, 'x')
    assert.equal(trashPage(db, a.id, 'bob'), 2)
    assert.equal(spaceTree(db, space).length, 0)
    assert.deepEqual(searchPages(db, 'zebre'), [])
    assert.deepEqual(listTrash(db).map((t) => [t.title, t.pages, t.deletedBy]), [['A', 2, 'bob']])
    // Une sous-page seule n'est pas une entrée de la corbeille.
    assert.deepEqual(code(() => restorePage(db, b.id, 'x')), { status: 404, code: 'NOT_FOUND' })
    assert.deepEqual(code(() => updatePage(db, a.id, { content: 'x', baseVersion: 1 }, 'x')), { status: 410, code: 'NOT_FOUND' })

    restorePage(db, a.id, 'bob')
    assert.deepEqual(spaceTree(db, space).map((p) => p.title).sort(), ['A', 'B'])
    assert.equal(searchPages(db, 'zebre').length, 1)

    trashPage(db, a.id, 'bob')
    assert.equal(purgePage(db, a.id), 2)
    assert.equal(listTrash(db).length, 0)
    assert.deepEqual(code(() => getPage(db, b.id)), { status: 404, code: 'NOT_FOUND' })
  })

  it('restaure à la racine une page dont le parent est encore à la corbeille', () => {
    const a = createPage(db, { spaceId: space, title: 'A' }, 'x')
    const b = createPage(db, { spaceId: space, parentId: a.id, title: 'B' }, 'x')
    trashPage(db, b.id, 'x')
    trashPage(db, a.id, 'x')
    const restored = restorePage(db, b.id, 'x')
    assert.equal(restored.parentId, null)
  })

  it('vide la corbeille après le délai', () => {
    const a = createPage(db, { spaceId: space, title: 'Vieux' }, 'x')
    trashPage(db, a.id, 'x', new Date('2026-01-01T00:00:00Z'))
    assert.equal(purgeExpiredTrash(db, 30, new Date('2026-01-20T00:00:00Z')), 0)
    assert.equal(purgeExpiredTrash(db, 30, new Date('2026-02-15T00:00:00Z')), 1)
  })

  it('ne supprime qu’un espace vide et garde au moins un espace', () => {
    const other = createSpace(db, { name: 'Autre' }).id
    const p = createPage(db, { spaceId: other, title: 'P' }, 'x')
    assert.deepEqual(code(() => deleteSpace(db, other)), { status: 409, code: 'CONFLICT' })
    trashPage(db, p.id, 'x')
    deleteSpace(db, other)
    assert.deepEqual(listSpaces(db).map((s) => s.name), ['Technique'])
    assert.deepEqual(code(() => deleteSpace(db, space)), { status: 409, code: 'CONFLICT' })
  })
})

describe('recherche', () => {
  it('trouve sans accents, par préfixe, titres d’abord, et neutralise la syntaxe FTS', () => {
    const db = openDatabase(':memory:')
    const space = createSpace(db, { name: 'Général' }).id
    createPage(db, { spaceId: space, title: 'Notes diverses', content: 'On parle de sauvegarde ici, une fois.' }, 'x')
    createPage(db, { spaceId: space, title: 'Sauvegardes du serveur', content: 'Procédure complète.' }, 'x')
    createPage(db, { spaceId: space, title: 'Réseau', content: 'Pare-feu et éléphant.' }, 'x')

    assert.deepEqual(searchPages(db, 'sauveg').map((h) => h.title), ['Sauvegardes du serveur', 'Notes diverses'])
    assert.deepEqual(searchPages(db, 'ELEPHANT').map((h) => h.title), ['Réseau'])
    assert.ok(searchPages(db, 'elephant')[0]!.snippet.includes('\u0002éléphant\u0003'))
    assert.deepEqual(searchPages(db, 'procedure complete').map((h) => h.title), ['Sauvegardes du serveur'])
    for (const nasty of ['"', 'OR', 'NEAR(', '*', 'a AND', ')(', "l'"]) {
      assert.doesNotThrow(() => searchPages(db, nasty), nasty)
    }
    assert.deepEqual(searchPages(db, '   '), [])
  })
})

describe('premier démarrage', () => {
  it('crée l’espace Général et la page d’accueil une seule fois', () => {
    const db = openDatabase(':memory:')
    assert.equal(seedIfEmpty(db), true)
    assert.equal(seedIfEmpty(db), false)
    const tree = spaceTree(db, listSpaces(db)[0]!.id)
    assert.deepEqual(tree.map((p) => p.title), ['Bienvenue sur le Wiki', 'Syntaxe Markdown'])
    // La page d'aide cite la page d'accueil : lien entrant.
    assert.deepEqual(getPage(db, tree[0]!.id).backlinks.map((b) => b.title), ['Syntaxe Markdown'])
  })
})
