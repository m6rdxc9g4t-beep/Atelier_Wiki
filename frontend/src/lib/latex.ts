// Rendu des pages écrites en LaTeX : texte LaTeX → arbre HTML (hast) nettoyé, prêt pour React.
// Chaîne : unified-latex (analyse + conversion) → nettoyage (aucune balise ni adresse dangereuse) → retouches du Wiki
// (titres, légendes, tableaux, liens [[…]]) → formules mises en forme par KaTeX. Aucun HTML brut n'est injecté.
// Les liens [[…]] suivent les mêmes règles que le backend (backend/src/domain/format.ts).

import { unifiedLatexToHast } from '@unified-latex/unified-latex-to-hast'
import { unifiedLatexFromString } from '@unified-latex/unified-latex-util-parse'
import type { Element, ElementContent, Root, RootContent, Text } from 'hast'
import { defaultSchema, sanitize, type Schema } from 'hast-util-sanitize'
import rehypeKatex from 'rehype-katex'
import { unified } from 'unified'
import { VFile } from 'vfile'

import { headingIds, type Heading, WIKI_SCHEME } from './markdown.ts'

/** Corps du document : ce qui est entre \begin{document} et \end{document}, sinon tout le texte. */
export function latexBody(latex: string): string {
  const start = /\\begin\{document\}/.exec(latex)
  if (!start) return latex
  const rest = latex.slice(start.index + start[0].length)
  const end = /\\end\{document\}/.exec(rest)
  return end ? rest.slice(0, end.index) : rest
}

/** Ce que le nettoyage laisse passer : le schéma de GitHub, plus les conteneurs de formules et les légendes. */
const SCHEMA: Schema = {
  ...defaultSchema,
  // Pas de préfixe « user-content- » : les ancres des titres sont posées par le rendu du Wiki.
  clobberPrefix: '',
  tagNames: [...(defaultSchema.tagNames ?? []), 'figure', 'figcaption', 'u'],
  attributes: {
    ...defaultSchema.attributes,
    span: [...(defaultSchema.attributes?.span ?? []), ['className', 'inline-math', 'macro-caption', 'argument', 'texttt']],
    div: [...(defaultSchema.attributes?.div ?? []), ['className', 'display-math', 'figure', 'environment']],
    td: [...(defaultSchema.attributes?.td ?? [])],
    th: [...(defaultSchema.attributes?.th ?? [])],
  },
}

const isElement = (node: RootContent | ElementContent | Root | undefined): node is Element => node?.type === 'element'
const hasClass = (node: Element, name: string) => {
  const cls = node.properties?.className
  return Array.isArray(cls) ? cls.includes(name) : cls === name
}

function textContent(node: Element | Root | ElementContent): string {
  if (node.type === 'text') return node.value
  if ('children' in node) return node.children.map((c) => textContent(c as ElementContent)).join('')
  return ''
}

const BLOCKS = new Set(['pre', 'table', 'figure', 'div', 'ul', 'ol', 'blockquote', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'hr'])

const isBlankRow = (row: Element) => row.children.every((c) => !isElement(c) || textContent(c).trim() === '')

/** `[[Titre]]`, `[[Titre|texte]]`, `[[#12]]` dans un texte → liens (wiki:Titre ou /p/12). */
const WIKILINK_RE = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g

function linkify(text: Text): ElementContent[] {
  const out: ElementContent[] = []
  let last = 0
  for (const m of text.value.matchAll(WIKILINK_RE)) {
    const raw = m[1]!.trim()
    const label = (m[2] ?? raw).trim()
    if (m.index! > last) out.push({ type: 'text', value: text.value.slice(last, m.index) })
    const byId = /^#(\d+)$/.exec(raw)
    out.push({
      type: 'element',
      tagName: 'a',
      properties: { href: byId ? `/p/${byId[1]}` : `${WIKI_SCHEME}${encodeURIComponent(raw)}` },
      children: [{ type: 'text', value: label }],
    })
    last = m.index! + m[0].length
  }
  if (last === 0) return [text]
  if (last < text.value.length) out.push({ type: 'text', value: text.value.slice(last) })
  return out
}

/** Retouches du Wiki sur l'arbre nettoyé. */
function polish(parent: Root | Element): void {
  const next: (RootContent | ElementContent)[] = []
  // Textes voisins fusionnés : l'analyseur découpe « [[Titre]] » en plusieurs morceaux.
  const merged: (RootContent | ElementContent)[] = []
  for (const child of parent.children) {
    const prev = merged[merged.length - 1]
    if (child.type === 'text' && prev?.type === 'text') prev.value += child.value
    else merged.push(child.type === 'text' ? { ...child } : child)
  }
  for (const child of merged) {
    if (child.type === 'text') {
      // Pas de lien dans le code ni dans une formule.
      const inCode = isElement(parent as Element) && ['pre', 'code'].includes((parent as Element).tagName)
      const inMath = isElement(parent as Element) && (hasClass(parent as Element, 'inline-math') || hasClass(parent as Element, 'display-math'))
      next.push(...(inCode || inMath ? [child] : linkify(child)))
      continue
    }
    if (!isElement(child)) {
      next.push(child)
      continue
    }
    // Niveaux de titres : \section → h2 (le h1 est le titre de la page), \subsection → h3, \subsubsection → h4…
    const level = /^h([1-6])$/.exec(child.tagName)
    if (level) child.tagName = `h${Math.min(6, Math.max(2, Number(level[1]) - 1))}`
    // Formules : classes attendues par KaTeX (rehype-katex).
    if (hasClass(child, 'inline-math')) child.properties.className = ['math-inline']
    if (hasClass(child, 'display-math')) child.properties.className = ['math-display']
    // \caption{…} → légende de la figure.
    if (hasClass(child, 'macro-caption')) {
      const args = child.children.filter(isElement)
      child.tagName = 'figcaption'
      child.properties = {}
      child.children = args.length ? args[args.length - 1]!.children : child.children
    }
    // \texttt{…} → code en ligne.
    if (child.tagName === 'span' && hasClass(child, 'texttt')) {
      child.tagName = 'code'
      child.properties = {}
    }
    // Figure : <figure> avec sa légende.
    if (child.tagName === 'div' && hasClass(child, 'figure')) {
      child.tagName = 'figure'
      child.properties = {}
    }
    // Tableaux : les \hline laissent des lignes vides ; la première ligne devient l'en-tête si elle est suivie d'un trait.
    if (child.tagName === 'table') tidyTable(child)
    // \item : un seul paragraphe dans l'élément de liste → le texte directement (listes resserrées, comme en Markdown).
    if (child.tagName === 'li') {
      const blocks = child.children.filter((c) => !(c.type === 'text' && !c.value.trim()))
      if (blocks.length === 1 && isElement(blocks[0]) && blocks[0].tagName === 'p') child.children = blocks[0].children
    }
    polish(child)
    // Paragraphes vides laissés autour des listes et des formules.
    if (child.tagName === 'p' && child.children.every((c) => c.type === 'text' && !c.value.trim())) continue
    // Un paragraphe ne peut pas contenir de bloc (code, tableau…) : il devient un simple conteneur.
    if (child.tagName === 'p' && child.children.some((c) => isElement(c) && BLOCKS.has(c.tagName))) child.tagName = 'div'
    next.push(child)
  }
  parent.children = next as typeof parent.children
}

function tidyTable(table: Element): void {
  const body = table.children.find((c): c is Element => isElement(c) && c.tagName === 'tbody')
  if (!body) return
  const rows = body.children.filter((c): c is Element => isElement(c) && c.tagName === 'tr')
  // Une ligne d'en-tête si la première ligne remplie est suivie d'un \hline (ligne vide) et d'autres lignes.
  const firstFilled = rows.findIndex((r) => !isBlankRow(r))
  const headed = firstFilled >= 0 && rows[firstFilled + 1] && isBlankRow(rows[firstFilled + 1]!) && rows.slice(firstFilled + 2).some((r) => !isBlankRow(r))
  const filled = rows.filter((r) => !isBlankRow(r))
  if (headed) {
    const head = filled.shift()!
    head.children = head.children.map((c) => (isElement(c) ? { ...c, tagName: 'th' } : c))
    table.children = [
      { type: 'element', tagName: 'thead', properties: {}, children: [head] },
      { ...body, children: filled },
    ]
  } else {
    body.children = filled
  }
}

/** Texte LaTeX → arbre HTML sûr (formules comprises). */
export function latexToHast(latex: string): Root {
  // unified-latex embarque sa propre version de unified : types incompatibles, comportement identique.
  const processor = unified()
    .use(unifiedLatexFromString as never)
    .use(unifiedLatexToHast as never, { skipHtmlValidation: true } as never) as unknown as { parse(text: string): unknown; runSync(tree: unknown): unknown }
  const raw = processor.runSync(processor.parse(latexBody(latex))) as Root
  const clean = sanitize(raw, SCHEMA) as Root
  polish(clean)
  // Une formule fausse s'affiche en rouge avec son texte, sans casser la page.
  rehypeKatex({ strict: false, trust: false })(clean, new VFile())
  return clean
}

/** Titres de niveau 2 à 4 de l'arbre, avec les mêmes identifiants que le rendu (table des matières). */
export function latexHeadings(tree: Root): Heading[] {
  const next = headingIds()
  const out: Heading[] = []
  const walk = (node: Root | Element) => {
    for (const child of node.children) {
      if (!isElement(child)) continue
      const level = /^h([2-4])$/.exec(child.tagName)
      if (level) {
        const text = textContent(child).replace(/\s+/g, ' ').trim()
        if (text) out.push({ level: Number(level[1]), text, id: next(text) })
        continue
      }
      walk(child)
    }
  }
  walk(tree)
  return out
}
