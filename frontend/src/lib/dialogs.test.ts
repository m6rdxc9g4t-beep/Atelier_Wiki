import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { focusReturn, paletteShortcut } from './dialogs.ts'

const el = (name: string, isConnected = true) => ({ name, isConnected })

describe('focus rendu à la fermeture d’une fenêtre', () => {
  const opener = el('Exemples de la suite')
  const fallback = el('Pages')

  it('revient au bouton qui a ouvert la fenêtre', () => {
    assert.equal(focusReturn({ opener, fallback, hidden: false }), opener)
  })

  it('y revient dans le rail comme dans le panneau : le pied de la barre latérale reste affiché', () => {
    // L'adresse a changé pendant la fenêtre, le panneau s'est refermé : « Exemples de la suite » est toujours là, en icône.
    assert.equal(focusReturn({ opener, fallback, hidden: false }), opener)
  })

  it('va au bouton « Pages » du rail quand le déclencheur est resté dans le panneau refermé', () => {
    assert.equal(focusReturn({ opener, fallback, hidden: true }), fallback)
  })

  it('va au repli quand le bouton n’est plus dans la page', () => {
    assert.equal(focusReturn({ opener: el('retiré', false), fallback, hidden: false }), fallback)
    assert.equal(focusReturn({ opener: null, fallback, hidden: false }), fallback)
  })

  it('ne vise jamais un élément retiré de la page', () => {
    assert.equal(focusReturn({ opener: el('retiré', false), fallback: el('retiré aussi', false), hidden: false }), null)
    assert.equal(focusReturn({ opener, fallback: null, hidden: true }), null)
  })
})

describe('raccourcis de la recherche rapide', () => {
  const key = (k: string, mods: { metaKey?: boolean; ctrlKey?: boolean } = {}) => ({ key: k, metaKey: false, ctrlKey: false, ...mods })
  const free = { typing: false, modal: false }

  it('⌘K et Ctrl+K ouvrent ou referment la recherche, même pendant une saisie', () => {
    assert.equal(paletteShortcut(key('k', { metaKey: true }), free), 'toggle')
    assert.equal(paletteShortcut(key('K', { ctrlKey: true }), free), 'toggle')
    assert.equal(paletteShortcut(key('k', { ctrlKey: true }), { typing: true, modal: false }), 'toggle')
  })

  it('« / » l’ouvre hors saisie seulement', () => {
    assert.equal(paletteShortcut(key('/'), free), 'open')
    assert.equal(paletteShortcut(key('/'), { typing: true, modal: false }), null)
    assert.equal(paletteShortcut(key('/', { ctrlKey: true }), free), null)
  })

  it('rien pendant qu’une fenêtre modale est ouverte : la recherche ne se monte pas derrière elle', () => {
    const modal = { typing: false, modal: true }
    assert.equal(paletteShortcut(key('/'), modal), null)
    assert.equal(paletteShortcut(key('k', { ctrlKey: true }), modal), null)
    assert.equal(paletteShortcut(key('k', { metaKey: true }), modal), null)
  })

  it('les autres touches ne font rien', () => {
    assert.equal(paletteShortcut(key('k'), free), null)
    assert.equal(paletteShortcut(key('n'), free), null)
  })
})
