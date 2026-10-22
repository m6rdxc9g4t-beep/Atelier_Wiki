import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { extractHeadings, frenchSpacing, openWikiLink, toggleTask, transformWikiLinks } from './markdown.ts'

describe('liens [[…]]', () => {
  it('transforme les liens hors du code', () => {
    const md = 'Voir [[Procédure d’été]] et [[Serveurs|les serveurs]], [[#12]].\n\n`[[pas un lien]]`\n\n```\n[[non plus]]\n```\n'
    assert.equal(
      transformWikiLinks(md),
      'Voir [Procédure d’été](wiki:Proc%C3%A9dure%20d%E2%80%99%C3%A9t%C3%A9) et [les serveurs](wiki:Serveurs), [#12](/p/12).\n\n`[[pas un lien]]`\n\n```\n[[non plus]]\n```\n',
    )
  })

  it('échappe les crochets du texte affiché', () => {
    assert.equal(transformWikiLinks('[[A|[note]]]'), '[\\[note](wiki:A)]')
  })

  it('repère un lien en cours de saisie', () => {
    assert.equal(openWikiLink('texte [[Proc'), 'Proc')
    assert.equal(openWikiLink('texte [['), '')
    assert.equal(openWikiLink('texte [[Fini]] et'), null)
  })
})

describe('titres et cases à cocher', () => {
  it('liste les titres hors code, identifiants uniques', () => {
    const md = '# Intro\n\n## Usage\n\n```\n## pas un titre\n```\n\n## Usage\n\n### **Détails** [[Page|ici]]\n'
    assert.deepEqual(extractHeadings(md), [
      { level: 1, text: 'Intro', id: 'intro' },
      { level: 2, text: 'Usage', id: 'usage' },
      { level: 2, text: 'Usage', id: 'usage-2' },
      { level: 3, text: 'Détails ici', id: 'details-ici' },
    ])
  })

  it('coche la n-ième case, en ignorant celles du code', () => {
    const md = '- [ ] a\n```\n- [ ] code\n```\n1. [x] b\n> - [ ] c'
    assert.equal(toggleTask(md, 0), '- [x] a\n```\n- [ ] code\n```\n1. [x] b\n> - [ ] c')
    assert.equal(toggleTask(md, 1), '- [ ] a\n```\n- [ ] code\n```\n1. [ ] b\n> - [ ] c')
    assert.equal(toggleTask(md, 2), '- [ ] a\n```\n- [ ] code\n```\n1. [x] b\n> - [x] c')
    assert.equal(toggleTask(md, 9), md)
  })
})

describe('typographie', () => {
  it('pose une espace fine insécable avant ; : ! ? et dans les guillemets', () => {
    assert.equal(frenchSpacing('Note : « Déplacer » ; oui !'), 'Note\u202f: «\u202fDéplacer\u202f»\u202f; oui\u202f!')
    assert.equal(frenchSpacing('http://exemple.fr:80'), 'http://exemple.fr:80')
  })
})
