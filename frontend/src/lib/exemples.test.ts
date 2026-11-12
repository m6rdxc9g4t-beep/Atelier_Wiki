import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import type { ExempleHistoire } from './api.ts'
import { examplesStatus, oneAtATime, pickHistoire, routeInSpace, showExamplesOnHome, spaceAfterRemoval } from './exemples.ts'
import type { Route } from './router.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const histoire = (id: string, extra: Partial<ExempleHistoire> = {}): ExempleHistoire => ({
  id,
  titre: id,
  sous_titre: '',
  secteur: '',
  resume: '',
  parcours: [],
  espace: id,
  pages: 3,
  charge: false,
  spaceId: null,
  pageId: null,
  ...extra,
})

describe('exemples de la suite : où les proposer', () => {
  it('l’accueil ne les montre que dans un wiki sans aucune page', () => {
    assert.equal(showExamplesOnHome([]), true)
    assert.equal(showExamplesOnHome([{ pageCount: 0 }, { pageCount: 0 }]), true)
    assert.equal(showExamplesOnHome([{ pageCount: 0 }, { pageCount: 8 }]), false)
  })

  it('l’entrée est au pied de la barre latérale, au-dessus de l’auteur et du thème, et ouvre une fenêtre', () => {
    const sidebar = read('../components/Sidebar.tsx')
    const entry = sidebar.indexOf('Exemples de la suite\n        </button>')
    assert.ok(entry > 0, 'entrée « Exemples de la suite » absente de la barre latérale')
    assert.ok(entry > sidebar.indexOf('className="sidebar__scroll"'), 'l’entrée doit être sous la liste des pages')
    assert.ok(entry < sidebar.indexOf('className="sidebar__foot"'), 'l’entrée doit être au-dessus du thème')
    const button = sidebar.slice(sidebar.lastIndexOf('<button', entry), entry)
    assert.match(button, /className="nav-link"/, 'même style que les entrées de navigation')
    assert.match(button, /aria-haspopup="dialog"/)
    assert.match(button, /<ExamplesIcon aria-hidden \/>/, 'le nom accessible est le texte visible, pas l’icône')
  })

  it('son icône n’est pas le livre ouvert, marque du Wiki', () => {
    const source = read('../components/SuiteExamples.tsx')
    const icon = /export const ExamplesIcon = (\w+)/.exec(source)?.[1]
    assert.ok(icon, 'ExamplesIcon doit être déclarée')
    assert.notEqual(icon, 'BookOpen')
    assert.doesNotMatch(source, new RegExp(`BookOpen as ${icon}\\b`))
  })

  it('la fenêtre et l’accueil partagent la même logique (un seul endroit appelle l’API des exemples)', () => {
    const source = read('../components/SuiteExamples.tsx')
    for (const call of ['api.exemples(', 'api.loadExemple(', 'api.removeExemple(']) {
      assert.equal(source.split(call).length - 1, 1, `${call} doit n’être appelé qu’une fois`)
    }
    assert.equal(source.split('useSuiteExamples(').length - 1, 3, 'le hook est déclaré une fois et utilisé par les deux habillages')
    for (const file of ['../components/Sidebar.tsx', '../App.tsx', '../views/OtherViews.tsx']) {
      assert.doesNotMatch(read(file), /api\.(?:exemples|loadExemple|removeExemple)\(/, `${file} ne doit pas appeler l’API des exemples`)
    }
  })

  it('la fenêtre est une fenêtre modale native, nommée, fermée par Échap', () => {
    const source = read('../components/SuiteExamples.tsx')
    const dialog = source.slice(source.indexOf('<dialog'), source.indexOf('</dialog>'))
    assert.match(source, /ref\.current\?\.showModal\(\)/, 'showModal() : focus piégé, reste de la page inerte')
    assert.match(dialog, /aria-labelledby="examples-dialog-title"/)
    assert.match(dialog, /id="examples-dialog-title"/)
    assert.match(dialog, /onCancel=/)
    assert.match(dialog, />\s*Fermer\s*</)
  })

  it('la rangée d’actions de la fenêtre ne porte que des boutons (le texte « Espace · N pages » est dans le corps)', () => {
    // Avec ce texte dans la rangée, les trois boutons d'un exemple chargé ne tenaient plus sur une ligne (560 px).
    const source = read('../components/SuiteExamples.tsx')
    const dialog = source.slice(source.indexOf('<dialog'), source.indexOf('</dialog>'))
    const actions = dialog.indexOf('className="dialog__actions examples-dialog__actions"')
    assert.ok(actions > 0, 'rangée d’actions absente de la fenêtre')
    assert.doesNotMatch(dialog.slice(actions), /meta\(h\)/, 'pas de texte dans la rangée des boutons')
    assert.match(dialog.slice(dialog.indexOf('className="dialog__body"'), actions), /meta\(h\)/, 'le texte reste affiché, dans le corps')
    assert.doesNotMatch(read('../styles/wiki.css'), /\.examples-dialog__actions \.examples__meta/)
  })
})

describe('exemples de la suite : histoire affichée et état de la liste', () => {
  it('garde l’histoire mémorisée si elle existe encore, sinon la première', () => {
    const list = [histoire('studio'), histoire('ferme')]
    assert.equal(pickHistoire(list, 'ferme')?.id, 'ferme')
    assert.equal(pickHistoire(list, 'disparue')?.id, 'studio')
    assert.equal(pickHistoire(list, null)?.id, 'studio')
    assert.equal(pickHistoire([], 'ferme'), undefined)
  })

  it('distingue chargement, erreur, aucune histoire et liste prête', () => {
    assert.equal(examplesStatus({ data: undefined, error: null }), 'loading')
    assert.equal(examplesStatus({ data: undefined, error: new Error('Serveur injoignable') }), 'error')
    assert.equal(examplesStatus({ data: [], error: null }), 'empty')
    assert.equal(examplesStatus({ data: [histoire('studio')], error: null }), 'ready')
  })

  it('garde la liste affichée quand une relecture échoue', () => {
    assert.equal(examplesStatus({ data: [histoire('studio')], error: new Error('Serveur injoignable') }), 'ready')
  })
})

describe('exemples de la suite : après le retrait', () => {
  const wiki = {
    spaces: [
      { id: 1, slug: 'general' },
      { id: 3, slug: 'studio-garance' },
    ],
    titles: [
      { id: 10, spaceId: 1 },
      { id: 30, spaceId: 3 },
    ],
  }
  const at = (route: Route) => routeInSpace(route, 3, wiki)

  it('quitte la vue qui montrait l’espace retiré ou une de ses pages', () => {
    assert.equal(at({ name: 'space', slug: 'studio-garance' }), true)
    assert.equal(at({ name: 'page', id: 30 }), true)
    assert.equal(at({ name: 'edit', id: 30 }), true)
    assert.equal(at({ name: 'history', id: 30, version: 2 }), true)
    assert.equal(at({ name: 'new', spaceId: 3, parentId: null, title: '' }), true)
    assert.equal(at({ name: 'new', spaceId: null, parentId: 30, title: '' }), true)
  })

  it('ne quitte pas les autres vues', () => {
    assert.equal(at({ name: 'home' }), false)
    assert.equal(at({ name: 'trash' }), false)
    assert.equal(at({ name: 'search', q: 'garance' }), false)
    assert.equal(at({ name: 'notFound' }), false)
    assert.equal(at({ name: 'space', slug: 'general' }), false)
    assert.equal(at({ name: 'page', id: 10 }), false)
    assert.equal(at({ name: 'page', id: 999 }), false)
    assert.equal(at({ name: 'new', spaceId: 1, parentId: 10, title: '' }), false)
  })

  it('choisit un autre espace pour la barre latérale si l’espace courant est celui retiré', () => {
    const spaces = [{ id: 1 }, { id: 2 }, { id: 3 }]
    assert.equal(spaceAfterRemoval(spaces, 3, 3), 1)
    assert.equal(spaceAfterRemoval([{ id: 3 }, { id: 2 }], 3, 3), 2)
  })

  it('ne change rien si l’espace courant est un autre, si l’exemple n’a pas d’espace ou s’il était le seul', () => {
    const spaces = [{ id: 1 }, { id: 3 }]
    assert.equal(spaceAfterRemoval(spaces, 1, 3), null)
    assert.equal(spaceAfterRemoval(spaces, null, 3), null)
    assert.equal(spaceAfterRemoval(spaces, 3, null), null)
    assert.equal(spaceAfterRemoval([{ id: 3 }], 3, 3), null)
  })
})

describe('exemples de la suite : un bouton occupé garde le focus', () => {
  /** Appel en attente, terminé à la demande. */
  const pending = () => {
    let settle: { resolve: () => void; reject: (e: Error) => void } | undefined
    const promise = new Promise<void>((resolve, reject) => (settle = { resolve, reject }))
    return { promise, resolve: () => settle?.resolve(), reject: (e: Error) => settle?.reject(e) }
  }

  it('une activation pendant qu’une action court est ignorée', async () => {
    const run = oneAtATime()
    const call = pending()
    let started = 0
    const action = () => {
      started++
      return call.promise
    }
    const first = run(action)
    await run(action) // Entrée de nouveau sur le bouton resté focalisable : rien ne part
    assert.equal(started, 1)
    call.resolve()
    await first
    await run(async () => void started++)
    assert.equal(started, 2, 'une fois l’action finie, la suivante part')
  })

  it('après un échec, le bouton répond de nouveau', async () => {
    const run = oneAtATime()
    const call = pending()
    const first = run(() => call.promise)
    call.reject(new Error('serveur en erreur'))
    await assert.rejects(first, /serveur en erreur/)
    let retried = false
    await run(async () => void (retried = true))
    assert.equal(retried, true)
  })

  it('les boutons de l’exemple ne sont jamais `disabled` (ils perdraient le focus) mais `aria-disabled`', () => {
    const source = read('../components/SuiteExamples.tsx')
    const actions = source.slice(source.indexOf('function StoryActions'), source.indexOf('const meta ='))
    assert.equal(actions.split('<button').length - 1, 2, 'bouton principal et « Retirer »')
    assert.doesNotMatch(actions, /\sdisabled=/)
    assert.equal(actions.split('aria-disabled={ex.busy || undefined}').length - 1, 2)
    const css = read('../styles/wiki.css')
    assert.match(css, /\.btn\[aria-disabled=['"]true['"]\]/, 'même aspect qu’un bouton désactivé')
  })
})
