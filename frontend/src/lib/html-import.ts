// Import de pages venues d'ailleurs (OpenProject, Confluence, un site…) : le HTML devient du Markdown.
// Le Wiki n'interprète jamais le HTML brut ; on le convertit donc au collage, ou après coup dans une page
// qui en contient déjà (bouton « Convertir le HTML »). Les images restées sur l'autre outil sont repérées.

import { gfm } from '@joplin/turndown-plugin-gfm'
import type { Root, RootContent } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import TurndownService from 'turndown'
import { unified } from 'unified'

/** Images d'OpenProject : `/api/v3/attachments/828/content` n'existe que sur le serveur OpenProject. */
export const OPENPROJECT_IMAGE_RE = /\/api\/v3\/attachments\/(\d+)\/content/g

/** Balises qui signalent un vrai contenu mis en forme (et pas, par exemple, du code copié depuis un éditeur). */
const RICH_HTML_RE = /<(table|img|h[1-6]|ul|ol|li|strong|b|em|a\s|blockquote|figure)\b/i

/** Le HTML d'un collage vaut-il une conversion ? (sinon on colle le texte brut, comme avant). */
export function isRichHtml(html: string): boolean {
  return RICH_HTML_RE.test(html)
}

function service(escape: boolean): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  })
  td.use(gfm)
  // Texte déjà en Markdown autour du HTML : ne pas échapper ses ** ou ses [[…]].
  if (!escape) td.escape = (text: string) => text
  // Méta-données, scripts et styles ne sont pas du contenu.
  td.remove(['script', 'style', 'meta', 'link', 'title', 'noscript'])
  // Image : texte de remplacement lisible ; celles d'OpenProject sont signalées dans le texte.
  td.addRule('image', {
    filter: 'img',
    replacement: (_content, node) => {
      const el = node as HTMLElement
      const src = (el.getAttribute('src') ?? '').trim()
      if (!src) return ''
      const alt = (el.getAttribute('alt') ?? '').replace(/[[\]\n]/g, ' ').trim()
      const op = /\/api\/v3\/attachments\/(\d+)\/content/.exec(src)
      const label = alt || (op ? `Image OpenProject ${op[1]} à recoller` : 'image')
      return `![${label}](${src})`
    },
  })
  // Figure : son contenu (tableau, image) puis sa légende en italique.
  td.addRule('figcaption', {
    filter: 'figcaption',
    replacement: (content) => (content.trim() ? `\n\n*${content.trim()}*\n\n` : ''),
  })
  return td
}

/** HTML (collé depuis une page web ou OpenProject) → Markdown. */
export function htmlToMarkdown(html: string): string {
  return tidy(service(true).turndown(html))
}

/** Espaces en fin de ligne, lignes vides en trop, puces « -   » de Turndown ramenées à « - ». */
const tidy = (md: string) =>
  md
    .replace(/[ \t]+\n/g, '\n')
    .replace(/^(\s*)([-*+]|\d+\.)[ ]{2,}(?=\S)/gm, '$1$2 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

function containsHtml(node: RootContent): boolean {
  if (node.type === 'html') return true
  if (node.type === 'code' || node.type === 'inlineCode') return false
  return 'children' in node && (node.children as RootContent[]).some(containsHtml)
}

/**
 * Convertit le HTML écrit au milieu d'un texte Markdown (pages copiées depuis OpenProject) : chaque bloc qui en contient
 * est réécrit en Markdown ; le reste du texte et le code ne bougent pas. Renvoie le texte et le nombre de blocs convertis.
 */
export function convertEmbeddedHtml(markdown: string): { text: string; blocks: number } {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root
  const targets = tree.children.filter(containsHtml)
  let text = markdown
  // De la fin vers le début : les positions des blocs restants ne bougent pas.
  for (const node of [...targets].reverse()) {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) continue
    const converted = tidy(service(false).turndown(markdown.slice(start, end)))
    text = `${text.slice(0, start)}${converted}${text.slice(end)}`
  }
  return { text, blocks: targets.length }
}

/** Le texte contient-il du HTML à convertir (hors code) ? */
export function hasEmbeddedHtml(markdown: string): boolean {
  if (!/<[a-z][\s\S]*?>/i.test(markdown)) return false
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root
  return tree.children.some(containsHtml)
}

/** Numéros des images d'OpenProject encore référencées dans le texte (à recoller dans le Wiki). */
export function openProjectImages(markdown: string): number[] {
  return [...new Set([...markdown.matchAll(OPENPROJECT_IMAGE_RE)].map((m) => Number(m[1])))]
}
