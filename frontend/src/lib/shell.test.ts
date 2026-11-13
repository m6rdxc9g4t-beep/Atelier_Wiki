import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { nextTheme, panelShortcut, RAIL_MAX_WIDTH, RAIL_QUERY } from './shell.ts'

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
  })
})
