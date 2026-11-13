import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { nextTheme, PANEL_LAYERS, panelCovers, panelShortcut, RAIL_MAX_WIDTH, RAIL_QUERY, TREE_INDENT_LEVELS, treeIndented } from './shell.ts'

describe('coquille : rail d’icônes et panneau des pages', () => {
  it('le rail s’arrête juste sous 1024 px, comme dans Atelier Viz', () => {
    assert.ok(RAIL_MAX_WIDTH < 1024 && RAIL_MAX_WIDTH > 1023)
    assert.equal(RAIL_QUERY, '(max-width: 1023.98px)')
  })

  it('le bouton de thème du rail fait le tour des trois préférences', () => {
    assert.equal(nextTheme('system'), 'light')
    assert.equal(nextTheme('light'), 'dark')
    assert.equal(nextTheme('dark'), 'system')
  })

  it('Échap referme le panneau ouvert, et lui seul', () => {
    assert.equal(panelShortcut({ key: 'Escape' }, { open: true, layered: false }), 'close')
    assert.equal(panelShortcut({ key: 'Escape' }, { open: false, layered: false }), null)
    assert.equal(panelShortcut({ key: 'Enter' }, { open: true, layered: false }), null)
  })

  it('Échap est d’abord pour la fenêtre, la recherche ou le menu ouvert par-dessus', () => {
    assert.equal(panelShortcut({ key: 'Escape' }, { open: true, layered: true }), null)
    // Les trois sont reconnus : fenêtre modale, recherche (⌘K), menu (espaces).
    assert.deepEqual(PANEL_LAYERS.split(', '), ['dialog[open]', '.palette', '[role="menu"]'])
  })

  it('le panneau ouvert depuis le rail rend le reste de la page inerte, la barre complète jamais', () => {
    assert.equal(panelCovers({ open: true, rail: true }), true)
    assert.equal(panelCovers({ open: false, rail: true }), false)
    assert.equal(panelCovers({ open: true, rail: false }), false)
    assert.equal(panelCovers({ open: false, rail: false }), false)
  })
})

describe('arbre des pages : retrait plafonné', () => {
  it('décale les premiers niveaux de sous-pages, puis plus aucun', () => {
    assert.equal(treeIndented(0), false, 'la racine de l’espace n’est pas décalée')
    for (let depth = 1; depth <= TREE_INDENT_LEVELS; depth++) assert.equal(treeIndented(depth), true, `niveau ${depth}`)
    for (const depth of [TREE_INDENT_LEVELS + 1, 8, 12, 30]) assert.equal(treeIndented(depth), false, `niveau ${depth}`)
  })
})
