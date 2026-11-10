import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'

import Database from 'better-sqlite3'
import type { FastifyInstance } from 'fastify'

import { migrate, MIGRATIONS, openDatabase, type Db } from '../src/db/database.js'
import { appendLatexSection, latexBody, latexDocument, latexExcerpt, stripLatexCode } from '../src/domain/format.js'
import { appendSection, excerpt, extractLinks } from '../src/domain/markdown.js'
import { ApiError } from '../src/http/errors.js'
import { createPage, getPage, getRevision, restoreRevision, updatePage } from '../src/services/pages.js'
import { createSpace } from '../src/services/spaces.js'
import { json, testApp } from './helpers.js'

describe('LaTeX : règles pures', () => {
  it('ignore commentaires, verbatim et \\verb pour chercher les liens', () => {
    const tex = [
      'Voir [[Procédure]] et \\href{/p/7-guide}{le guide}.',
      '% [[Commentée]]',
      'Taux de 5\\% [[Gardée]]',
      '\\begin{verbatim}[[Dans le code]]\\end{verbatim}',
      '\\verb|[[Aussi du code]]|',
    ].join('\n')
    assert.ok(!stripLatexCode(tex).includes('Commentée'))
    assert.ok(stripLatexCode(tex).includes('[[Gardée]]'))
    assert.deepEqual(extractLinks(tex, 'latex'), [
      { targetId: null, targetTitle: 'procedure' },
      { targetId: null, targetTitle: 'gardee' },
      { targetId: 7, targetTitle: null },
    ])
    // En Markdown, \href n'est pas un lien vers une page.
    assert.deepEqual(extractLinks('\\href{/p/7}{x}', 'markdown'), [])
  })

  it('produit un extrait en texte brut, sans préambule ni commandes', () => {
    const tex = '\\documentclass{article}\n\\begin{document}\n\\section{Objectif}\nUn \\textbf{rapport} clair~: $x^2$.\n\\includegraphics[width=5cm]{/api/attachments/1/a.png}\n\\end{document}'
    assert.equal(latexBody(tex).trim().startsWith('\\section'), true)
    assert.equal(latexExcerpt(tex), 'Objectif Un rapport clair : $x^2$.')
    assert.equal(excerpt(tex, 180, 'latex'), latexExcerpt(tex))
  })

  it('ajoute une section, avant \\end{document} s’il existe', () => {
    assert.equal(appendLatexSection('Début', 'Suite', 'Notes & 50 %'), 'Début\n\n\\section*{Notes \\& 50 \\%}\n\nSuite\n')
    assert.equal(
      appendSection('\\begin{document}\nA\n\\end{document}\n', 'B', null, 'latex'),
      '\\begin{document}\nA\n\nB\n\n\\end{document}\n',
    )
    assert.equal(appendSection('A', 'B', 'T'), 'A\n\n## T\n\nB\n')
  })

  it('exporte un document compilable', () => {
    const doc = latexDocument('Rapport_Q3', 'Texte')
    assert.match(doc, /^\\documentclass/)
    assert.match(doc, /\\title\{Rapport\\_Q3\}/)
    assert.match(doc, /\\begin\{document\}\n\\maketitle\n\nTexte\n\n\\end\{document\}\n$/)
    assert.equal(latexDocument('X', '\\documentclass{book}\nY\n\n'), '\\documentclass{book}\nY\n')
  })
})

describe('format des pages', () => {
  let db: Db
  let space: number

  beforeEach(() => {
    db = openDatabase(':memory:')
    space = createSpace(db, { name: 'Docs' }).id
  })

  it('crée en Markdown par défaut, en LaTeX sur demande ; refuse un format inconnu', () => {
    assert.equal(createPage(db, { spaceId: space, title: 'A' }, 'moi').format, 'markdown')
    const tex = createPage(db, { spaceId: space, title: 'B', content: 'Voir [[A]]', format: 'latex' }, 'moi')
    assert.equal(tex.format, 'latex')
    assert.deepEqual(getPage(db, createPage(db, { spaceId: space, title: 'A2' }, 'moi').id).backlinks, [])
    assert.throws(
      () => createPage(db, { spaceId: space, title: 'C', format: 'word' as never }, 'moi'),
      (e) => e instanceof ApiError && e.status === 422,
    )
  })

  it('change de format comme une modification, gardée dans l’historique et restaurable', () => {
    const page = createPage(db, { spaceId: space, title: 'Rapport', content: '# Titre' }, 'moi')
    const v2 = updatePage(db, page.id, { content: '\\section{Titre}', format: 'latex', baseVersion: 1 }, 'moi')
    assert.equal(v2.format, 'latex')
    assert.equal(v2.version, 2)
    assert.equal(getRevision(db, page.id, 1).format, 'markdown')
    assert.equal(getRevision(db, page.id, 2).format, 'latex')
    // Changer seulement le format est une modification.
    assert.equal(updatePage(db, page.id, { format: 'markdown', baseVersion: 2 }, 'moi').version, 3)
    const back = restoreRevision(db, page.id, 2, 'moi')
    assert.equal(back.format, 'latex')
    assert.equal(back.content, '\\section{Titre}')
  })

  it('les liens d’une page LaTeX alimentent les rétroliens', () => {
    const target = createPage(db, { spaceId: space, title: 'Cible' }, 'moi')
    createPage(db, { spaceId: space, title: 'Source', content: `\\href{/p/${target.id}}{ici} % [[Cible]]`, format: 'latex' }, 'moi')
    assert.deepEqual(getPage(db, target.id).backlinks.map((b) => b.title), ['Source'])
  })

  it('la migration 3 garde les pages existantes en Markdown', () => {
    // Base d'avant le format : migrations 1 et 2 seulement, avec une page et une version.
    const old = new Database(':memory:')
    old.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
    old.exec(MIGRATIONS[0]!)
    old.exec(MIGRATIONS[1]!)
    old.prepare('INSERT INTO schema_migrations VALUES (1, ?), (2, ?)').run('x', 'x')
    old.exec("INSERT INTO spaces (id, slug, name, created_at, updated_at) VALUES (1, 'g', 'G', 'x', 'x')")
    old.exec("INSERT INTO pages (id, space_id, title, content, created_by, updated_by, created_at, updated_at) VALUES (1, 1, 'P', 'texte', 'moi', 'moi', 'x', 'x')")
    old.exec("INSERT INTO page_revisions (page_id, version, title, content, author, created_at) VALUES (1, 1, 'P', 'texte', 'moi', 'x')")
    migrate(old)
    assert.equal(getPage(old, 1).format, 'markdown')
    assert.equal(getRevision(old, 1, 1).format, 'markdown')
    assert.throws(() => old.exec("UPDATE pages SET format = 'word' WHERE id = 1"), /CHECK/)
  })
})

describe('API : format', () => {
  let app: FastifyInstance

  before(async () => {
    ;({ app } = await testApp({ seed: true }))
  })
  after(() => app.close())

  it('crée une page LaTeX, l’exporte en .tex ; format inconnu → 422', async () => {
    const spaces = (await app.inject(json('GET', '/api/spaces'))).json() as { id: number }[]
    const res = await app.inject(json('POST', '/api/pages', { spaceId: spaces[0]!.id, title: 'Note maths', content: '$a^2+b^2=c^2$', format: 'latex' }))
    assert.equal(res.statusCode, 201)
    const page = res.json() as { id: number; format: string }
    assert.equal(page.format, 'latex')
    const tex = await app.inject(json('GET', `/api/pages/${page.id}/export`))
    assert.match(tex.headers['content-type'] as string, /application\/x-tex/)
    assert.match(tex.headers['content-disposition'] as string, /note-maths\.tex/)
    assert.match(tex.body, /\\begin\{document\}[\s\S]*\$a\^2\+b\^2=c\^2\$/)

    const bad = await app.inject(json('POST', '/api/pages', { spaceId: spaces[0]!.id, title: 'X', format: 'word' }))
    assert.equal(bad.statusCode, 422)
    const put = await app.inject(json('PUT', `/api/pages/${page.id}`, { format: 'markdown', baseVersion: 1 }))
    assert.equal(put.json().format, 'markdown')
  })

  it('nœud Atelier : crée en LaTeX, renvoie le format, ajoute une section \\section*', async () => {
    const created = await app.inject(
      json('POST', '/api/atelier/pages', { title: 'CR LaTeX', content: 'Début', format: 'latex' }, { 'idempotency-key': 'fmt:1' }),
    )
    assert.equal(created.statusCode, 201)
    const page = created.json() as { id: string; format: string }
    assert.equal(page.format, 'latex')
    const appended = await app.inject(
      json('POST', `/api/atelier/pages/${page.id}/append`, { content: 'Suite', heading: 'Décisions' }, { 'idempotency-key': 'fmt:2' }),
    )
    assert.equal(appended.json().content, 'Début\n\n\\section*{Décisions}\n\nSuite\n')
    const manifest = (await app.inject(json('GET', '/api/atelier/manifest'))).json() as { actions: { id: string; input_schema: { properties: Record<string, unknown> } }[] }
    const create = manifest.actions.find((a) => a.id === 'pages.create')!
    assert.ok('format' in create.input_schema.properties)
  })
})
