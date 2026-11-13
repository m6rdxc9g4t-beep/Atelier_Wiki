import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

import { decodeEntities, extractHeadings, frenchSpacing, hitParts, openWikiLink, remarkLineBreaks, slugify, toggleTask, transformWikiLinks } from './markdown.ts'

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

// Cas relevés sur le wiki de l'utilisateur : « Taux &amp; Temps <br> Introduc… » affiché en clair.
describe('titres et extraits : du texte, jamais du balisage', () => {
  it('décode les entités comme le rendu de la page', () => {
    assert.equal(decodeEntities('Taux &amp; Temps &#233;t&#xE9; &lt;br&gt;'), 'Taux & Temps été <br>')
    assert.equal(decodeEntities('R&D, AT&T ; &inconnue; a&#2;b'), 'R&D, AT&T ; &inconnue; a b')
  })

  it('décode tout Latin-1 et l’alphabet grec, et jamais une propriété héritée d’un objet', () => {
    assert.equal(decodeEntities('&Eacute;cart &times; 2 &frac12; &ouml; &alpha; &Omega; &sigmaf; &minus;5 &rArr; a&nbsp;b'), 'Écart × 2 ½ ö α Ω ς −5 ⇒ a b')
    assert.equal(decodeEntities('&constructor; &toString; &valueOf;'), '&constructor; &toString; &valueOf;')
  })

  it('partage la table des entités du backend (les deux côtés nettoient pareil)', () => {
    const table = (source: string) => /const NAMED_ENTITIES: Record<string, string> = \{[\s\S]*?\n\}\n[\s\S]*?const ENTITY_RANGES[\s\S]*?\n\]\nfor [\s\S]*?\n\}\n/.exec(source)?.[0]?.replace(/\s+/g, ' ').trim()
    const front = table(readFileSync(new URL('./markdown.ts', import.meta.url), 'utf8'))
    const back = table(readFileSync(new URL('../../../backend/src/domain/markdown.ts', import.meta.url), 'utf8'))
    assert.ok(front && front.includes("amp: '&'") && front.includes('eacute') && front.includes('omega'))
    assert.equal(front, back)
  })

  it('la table des matières montre « & » et non « &amp; », sans « <br> », avec l’ancre du titre affiché', () => {
    const md = '## Taux &amp; Temps <br> Introduction\n\n## NRJ &amp; Abs\n\n## Types de tickets & OpenProject\n\n## E-S&nbsp;: synthèse<br/>du mois\n'
    assert.deepEqual(extractHeadings(md), [
      { level: 2, text: 'Taux & Temps Introduction', id: 'taux-temps-introduction' },
      { level: 2, text: 'NRJ & Abs', id: 'nrj-abs' },
      { level: 2, text: 'Types de tickets & OpenProject', id: 'types-de-tickets-openproject' },
      { level: 2, text: 'E-S : synthèse du mois', id: 'e-s-synthese-du-mois' },
    ])
  })

  /** Texte d'un titre tel que le rendu le calcule pour son ancre : texte des nœuds, un saut de ligne valant une espace. */
  function renderedHeadings(md: string): string[] {
    interface Node {
      type: string
      value?: string
      children?: Node[]
    }
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkLineBreaks)
    const tree = processor.runSync(processor.parse(md)) as Node
    const text = (node: Node): string => (node.type === 'break' ? ' ' : (node.value ?? (node.children ?? []).map(text).join('')))
    return (tree.children ?? []).filter((n) => n.type === 'heading').map((n) => slugify(text(n)))
  }

  it('donne aux titres la même ancre que le rendu de la page', () => {
    const md = '## Taux &amp; Temps <br> Introduction\n\n## R&amp;D : **bilan** &#233;t&#xE9;\n\n### a<br>b\n\n## &Eacute;nergie &alpha; &times; &frac12; co&ucirc;t&nbsp;: mot&shy;coup&eacute; &rarr; fin\n'
    assert.deepEqual(extractHeadings(md).map((h) => h.id), renderedHeadings(md))
    assert.equal(extractHeadings(md)[3]?.text, 'Énergie α × ½ coût : mot\u00adcoupé → fin')
  })

  it('« <br> » devient un saut de ligne dans une cellule de tableau ; toute autre balise reste du texte', () => {
    interface Node {
      type: string
      value?: string
      children?: Node[]
    }
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkLineBreaks)
    const md = '| A | B |\n|---|---|\n| R&amp;D | oui <br> non<BR/>peut-être <span>x</span> |\n'
    const tree = processor.runSync(processor.parse(md)) as Node
    const flat = (node: Node): Node[] => [node, ...(node.children ?? []).flatMap(flat)]
    const nodes = flat(tree)
    assert.equal(nodes.filter((n) => n.type === 'break').length, 2)
    assert.deepEqual(nodes.filter((n) => n.type === 'html').map((n) => n.value), ['<span>', '</span>'])
    assert.ok(nodes.some((n) => n.type === 'text' && n.value === 'R&D'), 'l’entité est décodée par le rendu')
  })

  it('découpe un extrait de recherche en texte et mots trouvés, sans jamais rien interpréter', () => {
    assert.deepEqual(hitParts('Voir I - \u0002Dashboard\u0003 puis <b>II</b> &amp; fin'), [
      { text: 'Voir I - ', hit: false },
      { text: 'Dashboard', hit: true },
      { text: ' puis <b>II</b> &amp; fin', hit: false },
    ])
    assert.deepEqual(hitParts('sans mot trouvé'), [{ text: 'sans mot trouvé', hit: false }])
    assert.deepEqual(hitParts(''), [])
  })

  it('retire un marqueur isolé au lieu de l’afficher', () => {
    assert.deepEqual(hitParts('début\u0003 et \u0002fin'), [{ text: 'début et fin', hit: false }])
    assert.deepEqual(hitParts('\u0002a\u0003\u0002b\u0003 \u0002c'), [
      { text: 'a', hit: true },
      { text: 'b', hit: true },
      { text: ' c', hit: false },
    ])
  })
})
