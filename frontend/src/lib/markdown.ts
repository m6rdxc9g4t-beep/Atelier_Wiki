// Règles du texte des pages côté interface. Les liens suivent les mêmes règles que le backend
// (backend/src/domain/markdown.ts) : [[Titre]], [[Titre|texte]], [[#12]], et jamais dans du code.

export function normalizeTitle(title: string): string {
  return title.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

export function slugify(text: string, fallback = 'section'): string {
  const slug = normalizeTitle(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '')
  return slug || fallback
}

/** Blocs de code clôturés, code en ligne, ou lien [[…]] : seul ce dernier est transformé. */
const TOKEN_RE = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$|`[^`\n]*`|\[\[([^\]\|\n]+?)(?:\|([^\]\n]+?))?\]\]/gm

/** Préfixe des liens internes avant résolution : wiki:<titre encodé>. */
export const WIKI_SCHEME = 'wiki:'

const escapeLabel = (label: string) => label.replace(/([\\[\]])/g, '\\$1')

/** [[Titre|texte]] → [texte](wiki:Titre) ; [[#12]] → [#12](/p/12). Le code reste intact. */
export function transformWikiLinks(markdown: string): string {
  return markdown.replace(TOKEN_RE, (match, _fence: string | undefined, target: string | undefined, label: string | undefined) => {
    if (target === undefined) return match
    const raw = target.trim()
    const text = (label ?? raw).trim()
    const byId = /^#(\d+)$/.exec(raw)
    if (byId) return `[${escapeLabel(text)}](/p/${byId[1]})`
    return `[${escapeLabel(text)}](${WIKI_SCHEME}${encodeURIComponent(raw)})`
  })
}

export interface Heading {
  level: number
  text: string
  id: string
}

/** Texte brut d'un titre Markdown (pour la table des matières). */
function plainInline(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\s+#+\s*$/, '')
    .trim()
}

/** Distributeur d'identifiants de titres : « usage », « usage-2 »… (même règle pour la table et le rendu). */
export function headingIds() {
  const seen = new Map<string, number>()
  return (text: string) => {
    const base = slugify(text)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}-${n}`
  }
}

/** Titres de niveau 1 à 4 hors blocs de code, pour la table des matières. */
export function extractHeadings(markdown: string): Heading[] {
  const next = headingIds()
  const out: Heading[] = []
  let fence: string | null = null
  for (const line of markdown.split('\n')) {
    const f = /^\s{0,3}(```|~~~)/.exec(line)
    if (f) {
      if (fence === null) fence = f[1]!
      else if (line.trim().startsWith(fence)) fence = null
      continue
    }
    if (fence) continue
    const m = /^\s{0,3}(#{1,4})\s+(.+)$/.exec(line)
    if (!m) continue
    const text = plainInline(m[2]!)
    if (text) out.push({ level: m[1]!.length, text, id: next(text) })
  }
  return out
}

const TASK_RE = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\])/

/** Coche ou décoche la n-ième case à cocher de la page (ordre du document, hors code). */
export function toggleTask(markdown: string, index: number): string {
  let fence: string | null = null
  let count = 0
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const f = /^\s{0,3}(?:>\s*)*(```|~~~)/.exec(line)
    if (f) {
      if (fence === null) fence = f[1]!
      else if (line.includes(fence)) fence = null
      continue
    }
    if (fence) continue
    const m = TASK_RE.exec(line)
    if (!m) continue
    if (count === index) {
      lines[i] = line.replace(TASK_RE, (_all, start: string, mark: string, end: string) => `${start}${mark === ' ' ? 'x' : ' '}${end}`)
      return lines.join('\n')
    }
    count++
  }
  return markdown
}

/** Lien en cours de saisie dans l'éditeur : « [[déb » juste avant le curseur. */
export function openWikiLink(textBeforeCursor: string): string | null {
  const m = /\[\[([^\]\[\n|]{0,80})$/.exec(textBeforeCursor)
  return m ? m[1]! : null
}

// ── Typographie française ────────────────────────────────────────────────────

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
}

/** Espace fine insécable avant « ; : ! ? » et à l'intérieur des guillemets : pas de ponctuation orpheline en début de ligne. */
export function frenchSpacing(text: string): string {
  return text
    .replace(/[ \u00a0]+([;:!?»])/g, '\u202f$1')
    .replace(/«[ \u00a0]+/g, '«\u202f')
}

/** Greffon remark : applique frenchSpacing aux nœuds de texte (jamais au code ni aux adresses). */
export function remarkFrenchSpacing() {
  const walk = (node: MdNode) => {
    if (node.type === 'text' && typeof node.value === 'string') node.value = frenchSpacing(node.value)
    if (node.type === 'code' || node.type === 'inlineCode') return
    node.children?.forEach(walk)
  }
  return (tree: MdNode) => walk(tree)
}
