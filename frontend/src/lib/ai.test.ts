import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { applyDraft, cannotGenerate, defaultMode, draftErrorMessage, draftRequest, elapsedLabel, statusNotice } from './ai.ts'

describe('rédaction assistée', () => {
  it('propose de retravailler seulement s’il y a du texte', () => {
    assert.equal(defaultMode(''), 'create')
    assert.equal(defaultMode('  \n'), 'create')
    assert.equal(defaultMode('## Texte'), 'rewrite')
  })

  it('n’envoie le texte actuel qu’en mode « retravailler »', () => {
    assert.deepEqual(draftRequest('create', ' Une FAQ ', '  ', '## Texte'), { mode: 'create', instructions: 'Une FAQ' })
    assert.deepEqual(draftRequest('create', 'Une FAQ', ' VPN ', ''), { mode: 'create', instructions: 'Une FAQ', title: 'VPN' })
    assert.deepEqual(draftRequest('rewrite', 'Résume', 'VPN', '## Texte'), { mode: 'rewrite', instructions: 'Résume', title: 'VPN', current: '## Texte' })
  })

  it('bloque « Générer » avec une raison claire', () => {
    assert.match(cannotGenerate('create', '  ', '') ?? '', /Écris/)
    assert.match(cannotGenerate('create', 'x'.repeat(4001), '') ?? '', /4000/)
    assert.match(cannotGenerate('rewrite', 'Résume', ' ') ?? '', /vide/)
    assert.match(cannotGenerate('rewrite', 'Résume', 'y'.repeat(50_001)) ?? '', /trop long/)
    assert.equal(cannotGenerate('rewrite', 'Résume', 'Texte'), null)
  })

  it('remplace ou ajoute à la fin', () => {
    assert.equal(applyDraft('Ancien', '\n## Nouveau\n', 'replace'), '## Nouveau\n')
    assert.equal(applyDraft('Ancien\n\n\n', '## Suite', 'append'), 'Ancien\n\n## Suite\n')
    assert.equal(applyDraft('  ', '## Suite', 'append'), '## Suite\n')
  })

  it('explique l’état de l’IA', () => {
    assert.equal(statusNotice(null, null), null)
    assert.equal(statusNotice({ available: true, model: 'llama3.1:8b', modelInstalled: true }, null), null)
    assert.match(statusNotice({ available: false, model: 'llama3.1:8b', modelInstalled: false }, null)?.text ?? '', /ne répond pas/)
    const missing = statusNotice({ available: true, model: 'llama3.1:8b', modelInstalled: false }, null)
    assert.equal(missing?.tone, 'danger')
    assert.match(missing?.text ?? '', /llama3\.1:8b/)
    assert.equal(statusNotice(null, new Error('Erreur 500.'))?.tone, 'warning')
  })

  it('rend les erreurs lisibles', () => {
    assert.equal(draftErrorMessage({ status: 504, code: 'AI_TIMEOUT', message: 'Trop long.' }), 'Trop long.')
    assert.equal(draftErrorMessage({ status: 503, code: 'AI_MODEL_MISSING', message: 'Modèle absent.' }), 'Modèle absent.')
    assert.match(draftErrorMessage({ status: 502, code: 'ERROR', message: 'Erreur 502.' }), /connexion a été coupée/)
    assert.match(draftErrorMessage({ status: 504, code: 'ERROR', message: 'Erreur 504.' }), /connexion a été coupée/)
    assert.equal(draftErrorMessage({ status: 500, code: 'INTERNAL', message: 'Erreur interne du Wiki.' }), 'Erreur interne du Wiki.')
  })

  it('affiche le temps écoulé', () => {
    assert.equal(elapsedLabel(4.7), '4 s')
    assert.equal(elapsedLabel(125), '2 min 05 s')
  })
})
