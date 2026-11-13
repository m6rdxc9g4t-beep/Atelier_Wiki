import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { appendSection, decodeEntities, excerpt, extractLinks, normalizeTitle, plainText, searchExcerpt, slugify, stripTags } from '../src/domain/markdown.js'

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

// Cas relevés sur le wiki de l'utilisateur : l'accueil affichait « Taux &amp; Temps <br> Introduc… » et « NRJ &amp; Abs… ».
describe('extraits : du texte, jamais du balisage', () => {
  const TABLE = [
    '| Indicateur | Formule | Remarque |',
    '|:--|:-:|--:|',
    '| Taux &amp; Temps | `heures / capacité` | Voir **I - Dashboard** <br> puis II - PdC |',
    '| NRJ &amp; Abs | somme des absences | <br/> à vérifier |',
  ].join('\n')

  it('décode les entités : nommées, décimales, hexadécimales ; une inconnue reste telle quelle', () => {
    assert.equal(decodeEntities('Taux &amp; Temps'), 'Taux & Temps')
    assert.equal(decodeEntities('&lt;br&gt; &quot;x&quot; &#233;t&#xE9; &euro;'), '<br> "x" été €')
    assert.equal(decodeEntities('R&D, AT&T ; &inconnue; &amp'), 'R&D, AT&T ; &inconnue; &amp')
    assert.equal(decodeEntities('a&nbsp;b'), 'a b')
  })

  it('décode tout Latin-1 et l’alphabet grec, pas seulement les entités les plus courantes', () => {
    assert.equal(decodeEntities('&Eacute;cart &times; 2 &frac12; &ouml; &Ucirc; &szlig; &sup2; &yuml;'), 'Écart × 2 ½ ö Û ß ² ÿ')
    assert.equal(decodeEntities('&alpha; &beta; &Omega; &sigmaf; &Sigma; &rho; &omega;'), 'α β Ω ς Σ ρ ω')
    assert.equal(decodeEntities('&minus;5 &asymp; &infin; &rArr; &check;'), '−5 ≈ ∞ ⇒ ✓')
    // Une entrée de la table l'emporte sur sa place dans Latin-1 : l'insécable devient une espace ordinaire.
    assert.equal(decodeEntities('a&nbsp;b'), 'a b')
  })

  it('ne prend pas une propriété héritée d’un objet pour une entité', () => {
    assert.equal(decodeEntities('&constructor; &toString; &valueOf; &__proto__;'), '&constructor; &toString; &valueOf; &__proto__;')
  })

  it('ne laisse passer aucun caractère de contrôle par une entité numérique', () => {
    assert.equal(decodeEntities('a&#2;b&#x3;c&#0;d&#x110000;e'), 'a b c d e')
  })

  it('retire les balises et garde le texte autour', () => {
    assert.equal(stripTags('Temps <br> Introduction').replace(/\s+/g, ' '), 'Temps Introduction')
    assert.equal(stripTags('a<br/>b<BR />c').replace(/\s+/g, ' '), 'a b c')
    assert.equal(stripTags('<span style="color:red">Alerte</span> <!-- note --> fin').replace(/\s+/g, ' ').trim(), 'Alerte fin')
    assert.equal(stripTags('voir <https://exemple.fr/a?b=1> et 3 < 5 > 2'), 'voir https://exemple.fr/a?b=1 et 3 < 5 > 2')
  })

  it('ne retire que les éléments HTML : un texte entre chevrons qui n’en est pas un reste du texte', () => {
    assert.equal(stripTags('Une liste Array<string> et Map<string, number>'), 'Une liste Array<string> et Map<string, number>')
    assert.equal(excerpt('Crée la branche <nom de la branche> puis ouvre <ton dossier>/<projet>.'), 'Crée la branche <nom de la branche> puis ouvre <ton dossier>/<projet>.')
    assert.equal(excerpt('a <b ou c> d, 3 <5 et x<y : <B>gras</B>, <font color="red">rouge</font><hr/>fin'), 'a d, 3 <5 et x<y : gras , rouge fin')
    assert.equal(excerpt('<details><summary>Voir</summary>le détail</details> <img src=x onerror=alert(1)> <script>alert(1)</script>'), 'Voir le détail alert(1)')
  })

  it('« &amp; » et « <br> » d’une table des matières deviennent du texte', () => {
    const md = '## Table des matières\n\n- [Introduction](#)\n- [VI - Taux &amp; Temps <br> Introduction](#)\n- [NRJ &amp; Abs](#)\n'
    assert.equal(excerpt(md), 'Table des matières Introduction VI - Taux & Temps Introduction NRJ & Abs')
  })

  it('un tableau Markdown ne garde que le texte de ses cellules', () => {
    assert.equal(excerpt(TABLE, 400), 'Indicateur Formule Remarque Taux & Temps Voir I - Dashboard puis II - PdC NRJ & Abs somme des absences à vérifier')
    assert.equal(plainText(TABLE, 'markdown', { code: 'keep' }), 'Indicateur Formule Remarque Taux & Temps heures / capacité Voir I - Dashboard puis II - PdC NRJ & Abs somme des absences à vérifier')
  })

  it('un titre avec « & » reste un « & », écrit tel quel ou en entité', () => {
    assert.equal(excerpt('# Types de tickets & OpenProject\n\nE-S & NbCol'), 'Types de tickets & OpenProject E-S & NbCol')
    assert.equal(excerpt('# Recherche &amp; développement'), 'Recherche & développement')
  })

  it('retire aussi cases à cocher, échappements et images, et resserre les espaces', () => {
    assert.equal(excerpt('- [x] Fait\n- [ ] À   faire\n\n![schéma](/a.png)\n\n1\\. Prix : 5 \\* 3 &nbsp;&nbsp; €'), 'Fait À faire 1. Prix : 5 3 €')
  })

  it('un texte qui parle de balises les garde comme du texte (entités décodées après le retrait des balises)', () => {
    assert.equal(excerpt('Écris &lt;br&gt; pour un saut de ligne.'), 'Écris <br> pour un saut de ligne.')
  })

  it('coupe après le nettoyage : jamais une entité ou une balise tranchée', () => {
    const cut = excerpt(`${'mot '.repeat(33)}Taux &amp; Temps <br> Introduction`, 140)
    assert.ok(cut.endsWith('…') && cut.length <= 140)
    assert.doesNotMatch(cut, /&[a-z]*;?$|<|>/)
  })

  it('LaTeX : commandes retirées, « \\& » rendu', () => {
    assert.equal(excerpt('\\section{Taux \\& Temps}\nTexte \\textbf{gras}.\\\\ Suite', 180, 'latex'), 'Taux & Temps Texte gras. Suite')
    assert.equal(plainText('\\section{Taux \\& Temps}', 'latex'), 'Taux & Temps')
  })
})

describe('extrait d’un résultat de recherche', () => {
  const marks = { start: '[', end: ']' }

  it('entoure chaque mot trouvé : début de mot, accents et casse ignorés', () => {
    assert.equal(searchExcerpt('Pare-feu et éléphant, Éléphants du réseau.', ['ELEPHANT'], marks), 'Pare-feu et [éléphant], [Éléphants] du réseau.')
    assert.equal(searchExcerpt('Le réseau interne', ['res', 'interne'], marks), 'Le [réseau] [interne]')
    assert.equal(searchExcerpt('unréseau', ['res'], marks), 'unréseau')
  })

  it('part du début de la page quand rien n’est trouvé dans le texte (titre seul)', () => {
    assert.equal(searchExcerpt('Procédure complète.', ['sauvegarde'], marks), 'Procédure complète.')
    assert.equal(searchExcerpt('', ['x'], marks), '')
  })

  it('se place autour d’un mot loin dans la page, coupé sur des mots entiers', () => {
    const text = `${'début '.repeat(60)}voici le Taux & Temps du mois ${'fin '.repeat(60)}`.trim()
    const out = searchExcerpt(text, ['taux'], marks, 80)
    assert.match(out, /^….*\[Taux\] & Temps.*…$/)
    assert.ok(out.replace(/[[\]…]/g, '').length <= 80)
    assert.match(out, /^…début /, 'pas de mot coupé au début')
    assert.match(out, / fin…$/, 'pas de mot coupé à la fin')
  })

  it('montre le mot trouvé dans les deux premières lignes d’une liste étroite (téléphone)', () => {
    // Cas vu à 390 px : le mot finissait vers le 75e caractère d'un extrait coupé à une soixantaine.
    const text = 'Table des matières Introduction I - Dashboard II - PdC Estimation VI Taux & Temps Introduction Le module Projet suit le taux de charge.'
    const out = searchExcerpt(text, ['taux'], marks)
    assert.equal(out, '…II - PdC Estimation VI [Taux] & Temps Introduction Le module Projet suit le [taux] de charge.')
    assert.ok(out.indexOf(']') <= 50, 'le premier mot trouvé finit dans les cinquante premiers caractères')
    // Un mot déjà dans les deux premières lignes : l'extrait part du début de la page, sans « … » de tête.
    const near = 'Le module Projet suit le taux de charge et le temps passé, semaine après semaine, pour chaque équipe.'
    assert.equal(searchExcerpt(near, ['taux'], marks), near.replace('taux', '[taux]'))
    // Quel que soit l'endroit du mot, il finit dans les cinquante premiers caractères de l'extrait.
    for (let before = 0; before < 200; before += 7) {
      const far = searchExcerpt(`${'mot '.repeat(before)}zygomatique ${'suite '.repeat(40)}`, ['zygo'], marks)
      assert.ok(far.indexOf(']') <= 50, `mot après ${before * 4} caractères : ${far.slice(0, 70)}`)
    }
  })
})
