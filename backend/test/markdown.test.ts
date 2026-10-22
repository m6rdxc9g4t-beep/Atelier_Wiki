import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { appendSection, excerpt, extractLinks, normalizeTitle, slugify } from '../src/domain/markdown.js'

describe('markdown', () => {
  it('normalise les titres sans casse ni accents', () => {
    assert.equal(normalizeTitle('  Procédure   d’Été '), 'procedure d’ete')
    assert.equal(normalizeTitle('ÉLÉPHANT'), 'elephant')
  })

  it('fabrique des slugs lisibles', () => {
    assert.equal(slugify("Guide d'installation (VPS)"), 'guide-d-installation-vps')
    assert.equal(slugify('!!!'), 'page')
  })

  it('extrait les liens [[…]], [[…|…]], [[#id]] et /p/id sans doublon', () => {
    const links = extractLinks('Voir [[Procédure]] et [[procedure|ici]], [[#12]], [la page](/p/7-ma-page) et [[Autre]].')
    assert.deepEqual(links, [
      { targetId: null, targetTitle: 'procedure' },
      { targetId: 12, targetTitle: null },
      { targetId: null, targetTitle: 'autre' },
      { targetId: 7, targetTitle: null },
    ])
  })

  it('ignore les liens écrits dans du code', () => {
    assert.deepEqual(extractLinks('`[[Pas un lien]]`\n```\n[[Non plus]]\n```\n[[Oui]]'), [{ targetId: null, targetTitle: 'oui' }])
  })

  it('produit un extrait en texte brut', () => {
    assert.equal(excerpt('# Titre\n\n**Gras** et [[Page|lien]] et [x](http://a)'), 'Titre Gras et lien et x')
    assert.ok(excerpt('a'.repeat(300), 20).endsWith('…'))
  })

  it('ajoute une section à la fin', () => {
    assert.equal(appendSection('Texte\n\n', 'Ajout', 'Compte rendu'), 'Texte\n\n## Compte rendu\n\nAjout\n')
    assert.equal(appendSection('', 'Ajout'), 'Ajout\n')
  })
})
