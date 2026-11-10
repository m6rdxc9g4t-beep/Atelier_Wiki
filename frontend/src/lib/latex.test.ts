import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Element, Root } from 'hast'

import { environmentText, escapeLatex, latexAttachment } from './latex-edit.ts'
import { latexBody, latexHeadings, latexToHast } from './latex.ts'

/** Éléments de l'arbre, dans l'ordre du document. */
function elements(tree: Root | Element): Element[] {
  const out: Element[] = []
  for (const child of tree.children) {
    if (child.type !== 'element') continue
    out.push(child, ...elements(child))
  }
  return out
}
const text = (node: Element | Root): string =>
  node.children.map((c) => (c.type === 'text' ? c.value : c.type === 'element' ? text(c) : '')).join('')
const byTag = (tree: Root, tag: string) => elements(tree).filter((e) => e.tagName === tag)

describe('rendu LaTeX', () => {
  it('ne garde que le corps du document', () => {
    assert.equal(latexBody('\\documentclass{article}\n\\begin{document}\nA\n\\end{document}\n'), '\nA\n')
    assert.equal(latexBody('Pas de préambule'), 'Pas de préambule')
  })

  it('titres : \\section → h2, \\subsection → h3, avec les identifiants de la table des matières', () => {
    const tree = latexToHast('\\section{Vue d’ensemble}\nTexte.\n\\subsection*{Détail}\n\\section{Vue d’ensemble}')
    assert.deepEqual(
      elements(tree).filter((e) => /^h\d$/.test(e.tagName)).map((e) => e.tagName),
      ['h2', 'h3', 'h2'],
    )
    assert.deepEqual(latexHeadings(tree), [
      { level: 2, text: 'Vue d’ensemble', id: 'vue-d-ensemble' },
      { level: 3, text: 'Détail', id: 'detail' },
      { level: 2, text: 'Vue d’ensemble', id: 'vue-d-ensemble-2' },
    ])
  })

  it('liens [[…]] hors code et formules ; \\href gardé ; javascript: retiré', () => {
    const tree = latexToHast(
      'Voir [[Module Finance]], [[#12]] et [[Serveurs|les serveurs]]. \\href{/p/8}{module} \\href{javascript:alert(1)}{piège}\n\\begin{verbatim}[[code]]\\end{verbatim}',
    )
    const links = byTag(tree, 'a').map((a) => [a.properties.href, text(a)])
    assert.deepEqual(links, [
      ['wiki:Module%20Finance', 'Module Finance'],
      ['/p/12', '#12'],
      ['wiki:Serveurs', 'les serveurs'],
      ['/p/8', 'module'],
      [undefined, 'piège'],
    ])
    assert.equal(text(byTag(tree, 'pre')[0]!), '[[code]]')
  })

  it('formules mises en forme par KaTeX, en ligne et en bloc', () => {
    const tree = latexToHast('Soit $x^2$.\n\n$$\\frac{a}{b}$$')
    const classes = elements(tree).map((e) => String(e.properties.className ?? ''))
    assert.ok(classes.includes('katex'))
    assert.ok(classes.includes('katex-display'))
  })

  it('tableau : traits retirés, première ligne en en-tête ; figure avec légende', () => {
    const tree = latexToHast(
      '\\begin{tabular}{|l|l|}\\hline Préfixe & Couche \\\\ \\hline SRC & Système source \\\\ \\hline\\end{tabular}\n' +
        '\\begin{figure}\\centering\\includegraphics[width=\\linewidth]{/api/attachments/3/schema.png}\\caption{Le schéma}\\end{figure}',
    )
    assert.deepEqual(byTag(tree, 'th').map((c) => text(c).trim()), ['Préfixe', 'Couche'])
    assert.deepEqual(byTag(tree, 'td').map((c) => text(c).trim()), ['SRC', 'Système source'])
    assert.equal(byTag(tree, 'img')[0]?.properties.src, '/api/attachments/3/schema.png')
    assert.equal(text(byTag(tree, 'figcaption')[0]!), 'Le schéma')
  })

  it('\\texttt devient du code ; listes resserrées', () => {
    const tree = latexToHast('\\begin{itemize}\\item Tables \\texttt{TRF\\_}\\end{itemize}')
    assert.equal(text(byTag(tree, 'code')[0]!), 'TRF_')
    assert.equal(byTag(tree, 'li')[0]!.children.some((c) => c.type === 'element' && c.tagName === 'p'), false)
  })

  it('aucune balise dangereuse ne passe', () => {
    const tree = latexToHast('\\begin{verbatim}<script>alert(1)</script>\\end{verbatim} <img src=x onerror=alert(1)>')
    assert.equal(byTag(tree, 'script').length, 0)
    assert.ok(elements(tree).every((e) => !Object.keys(e.properties).some((k) => k.startsWith('on'))))
  })
})

describe('écriture LaTeX', () => {
  it('échappe les caractères spéciaux', () => {
    assert.equal(escapeLatex('Rapport_Q3 & 50 % ~ #1'), 'Rapport\\_Q3 \\& 50 \\% \\~{} \\#1')
  })

  it('insère une figure pour une image, un lien pour un fichier', () => {
    assert.equal(
      latexAttachment({ name: 'flux_données.png', url: '/api/attachments/4/flux.png', isImage: true }),
      '\\begin{figure}\n  \\centering\n  \\includegraphics[width=\\linewidth]{/api/attachments/4/flux.png}\n  \\caption{flux\\_données}\n\\end{figure}\n',
    )
    assert.equal(latexAttachment({ name: 'cr.pdf', url: '/api/attachments/5/cr.pdf', isImage: false }), '\\href{/api/attachments/5/cr.pdf}{📎 cr.pdf}')
  })

  it('entoure les lignes d’un environnement, en \\item pour les listes', () => {
    assert.equal(environmentText('itemize', 'un\n\ndeux', true, 'x'), '\\begin{itemize}\n  \\item un\n  \\item deux\n\\end{itemize}')
    assert.equal(environmentText('quote', '', false, 'citation'), '\\begin{quote}\n  citation\n\\end{quote}')
  })
})
