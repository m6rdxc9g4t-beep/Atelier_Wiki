import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { focusReturn } from './dialogs.ts'

const el = (name: string, isConnected = true) => ({ name, isConnected })

describe('focus rendu à la fermeture d’une fenêtre', () => {
  const opener = el('Exemples de la suite')
  const fallback = el('Ouvrir le menu')

  it('revient au bouton qui a ouvert la fenêtre', () => {
    assert.equal(focusReturn({ opener, fallback, drawer: false, moved: false }), opener)
  })

  it('y revient aussi sur ordinateur quand l’adresse a changé (la barre latérale reste affichée)', () => {
    assert.equal(focusReturn({ opener, fallback, drawer: false, moved: true }), opener)
  })

  it('y revient dans le tiroir du téléphone resté ouvert', () => {
    assert.equal(focusReturn({ opener, fallback, drawer: true, moved: false }), opener)
  })

  it('va au bouton du menu quand le tiroir s’est refermé (adresse changée pendant la fenêtre)', () => {
    assert.equal(focusReturn({ opener, fallback, drawer: true, moved: true }), fallback)
  })

  it('va au repli quand le bouton n’est plus dans la page', () => {
    assert.equal(focusReturn({ opener: el('retiré', false), fallback, drawer: false, moved: false }), fallback)
    assert.equal(focusReturn({ opener: null, fallback, drawer: false, moved: false }), fallback)
  })

  it('ne vise jamais un élément retiré de la page', () => {
    assert.equal(focusReturn({ opener: el('retiré', false), fallback: el('retiré aussi', false), drawer: false, moved: false }), null)
    assert.equal(focusReturn({ opener, fallback: null, drawer: true, moved: true }), null)
  })
})
