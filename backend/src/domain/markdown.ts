// Règles pures sur le texte des pages : liens internes, titres normalisés, extraits.
// Le frontend applique les mêmes règles de liens (frontend/src/lib/markdown.ts et frontend/src/lib/latex.ts).

import { appendLatexSection, LATEX_PAGE_URL_RE, latexExcerpt, stripLatexCode, type PageFormat } from './format.js'

/** Titre normalisé pour comparer : minuscules, sans accents, espaces réduits. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Slug d'URL : `Guide d'installation` → `guide-d-installation`. */
export function slugify(text: string, fallback = 'page'): string {
  const slug = normalizeTitle(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return slug || fallback
}

export interface ExtractedLink {
  targetId: number | null
  /** Titre normalisé (lien [[Titre]]), sinon null. */
  targetTitle: string | null
}

/** `[[Titre]]` ou `[[Titre|texte affiché]]` (pas de `]` ni de saut de ligne dans le titre). */
export const WIKILINK_RE = /\[\[([^\]\|\n]+?)(?:\|([^\]\n]+?))?\]\]/g
/** Lien Markdown vers une page : `](/p/12)` ou `](/p/12-mon-titre)`. */
const PAGE_URL_RE = /\]\(\s*\/p\/(\d+)(?:-[a-z0-9-]*)?(?:[#?][^)\s]*)?\s*\)/g

/** Retire les blocs de code : un lien écrit dans un exemple de code n'est pas un lien. */
export function stripCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?(```|$)/g, '').replace(/~~~[\s\S]*?(~~~|$)/g, '').replace(/`[^`\n]*`/g, '')
}

/** Liens sortants d'une page, sans doublon. En LaTeX : [[…]] et \href{/p/12}{…}, hors verbatim et commentaires. */
export function extractLinks(content: string, format: PageFormat = 'markdown'): ExtractedLink[] {
  const text = format === 'latex' ? stripLatexCode(content) : stripCode(content)
  const seen = new Set<string>()
  const links: ExtractedLink[] = []
  for (const match of text.matchAll(WIKILINK_RE)) {
    const raw = (match[1] ?? '').trim()
    const byId = /^#(\d+)$/.exec(raw)
    const link: ExtractedLink = byId
      ? { targetId: Number(byId[1]), targetTitle: null }
      : { targetId: null, targetTitle: normalizeTitle(raw) }
    if (!link.targetId && !link.targetTitle) continue
    const key = `${link.targetId ?? ''}|${link.targetTitle ?? ''}`
    if (!seen.has(key)) {
      seen.add(key)
      links.push(link)
    }
  }
  for (const match of text.matchAll(format === 'latex' ? LATEX_PAGE_URL_RE : PAGE_URL_RE)) {
    const key = `${match[1]}|`
    if (!seen.has(key)) {
      seen.add(key)
      links.push({ targetId: Number(match[1]), targetTitle: null })
    }
  }
  return links
}

// ── Texte brut : extraits et résultats de recherche ─────────────────────────
// Un extrait est du texte, jamais du HTML : entités décodées (« &amp; » → « & »), balises retirées (« <br> »),
// syntaxe Markdown ou LaTeX retirée, espaces resserrés. Il est affiché tel quel (React l'échappe) et servi tel quel
// au nœud Atelier (Hub, Nexus) : c'est ici qu'il est nettoyé, une fois, pas chez chaque lecteur.

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', ndash: '–', mdash: '—',
  euro: '€', copy: '©', reg: '®', trade: '™', deg: '°', times: '×', divide: '÷', plusmn: '±', middot: '·', bull: '•',
  rarr: '→', larr: '←', harr: '↔', le: '≤', ge: '≥', ne: '≠', micro: 'µ', para: '¶', sect: '§', oelig: 'œ', OElig: 'Œ',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â', ccedil: 'ç', ugrave: 'ù', ucirc: 'û',
  icirc: 'î', iuml: 'ï', ocirc: 'ô', Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç',
}

/** Entités HTML → caractères : nommées courantes, décimales (`&#233;`) et hexadécimales (`&#xE9;`). Une entité inconnue reste telle quelle. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,11});/g, (match, body: string) => {
    if (body[0] !== '#') return NAMED_ENTITIES[body] ?? match
    const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
    // Jamais de caractère de contrôle (les marqueurs de la recherche en sont) ni de code hors d'Unicode.
    if (!Number.isInteger(code) || code < 0x20 || (code >= 0x7f && code < 0xa0) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ' '
    return String.fromCodePoint(code)
  })
}

/** Retire les balises HTML (`<br>`, `<span …>`, `</td>`, commentaires) : une espace à la place, le texte autour reste. */
export function stripTags(text: string): string {
  return text
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<((?:https?|mailto):[^\s<>]+)>/g, '$1')
    .replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/g, ' ')
}

/**
 * Texte brut d'une page, sur une ligne. `code: 'keep'` garde le texte des blocs de code (recherche : ce qu'on y
 * cherche doit pouvoir s'y montrer) ; par défaut ils sont retirés (aperçus).
 */
export function plainText(content: string, format: PageFormat = 'markdown', options: { code?: 'drop' | 'keep' } = {}): string {
  // Caractères de contrôle retirés d'abord : les marqueurs des mots trouvés (recherche) en sont, une page ne peut pas en poser.
  const text = content.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  return format === 'latex' ? latexExcerpt(text, Number.POSITIVE_INFINITY) : markdownText(text, options.code === 'keep')
}

function markdownText(content: string, keepCode: boolean): string {
  const source = keepCode ? content.replace(/^\s{0,3}(?:```|~~~)[^\n]*$/gm, '') : stripCode(content)
  return decodeEntities(
    stripTags(source)
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(WIKILINK_RE, (_m, title: string, label?: string) => (label ?? title).trim())
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
      .replace(/^\s*(?:\[[ xX]\]\s+)/gm, '')
      .replace(/^\s*\|?[-:| ]+\|?\s*$/gm, '')
      .replace(/\\([\\`*_{}[\]()#+\-.!|<>~&])/g, '$1')
      .replace(/[*_~`|]/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

/** Texte brut court (aperçus des listes) : sans balises, entités, syntaxe Markdown ni commandes LaTeX. */
export function excerpt(markdown: string, max = 180, format: PageFormat = 'markdown'): string {
  return truncate(plainText(markdown, format), max)
}

/** Mot replié pour comparer comme l'index de recherche : sans accents, en minuscules. */
const fold = (word: string) => word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * Extrait d'un résultat de recherche, taillé dans le texte brut autour du premier mot trouvé ; chaque mot trouvé
 * (début de mot, accents ignorés, comme l'index) est entouré de `start` / `end`. Sans mot trouvé dans le texte
 * (titre seul, balisage) : le début de la page.
 */
export function searchExcerpt(plain: string, terms: string[], marks: { start: string; end: string }, max = 160): string {
  const wanted = terms.flatMap((t) => fold(t).split(/[^\p{L}\p{N}]+/u)).filter(Boolean)
  const hits: { from: number; to: number }[] = []
  if (wanted.length) {
    for (const m of plain.matchAll(/[\p{L}\p{N}]+/gu)) {
      const word = fold(m[0])
      if (wanted.some((w) => word.startsWith(w))) hits.push({ from: m.index, to: m.index + m[0].length })
    }
  }
  let from = 0
  const first = hits[0]
  if (first && first.to > max - 20) {
    // Le mot trouvé est loin : la fenêtre commence un peu avant lui, sur un début de mot.
    from = Math.max(0, first.from - 50)
    const space = plain.indexOf(' ', from)
    if (from > 0 && space >= 0 && space < first.from) from = space + 1
  }
  let to = Math.min(plain.length, from + max)
  if (to < plain.length) {
    const space = plain.lastIndexOf(' ', to)
    if (space > from + max / 2) to = space
  }
  let out = ''
  let at = from
  for (const hit of hits) {
    if (hit.from < from || hit.to > to) continue
    out += `${plain.slice(at, hit.from)}${marks.start}${plain.slice(hit.from, hit.to)}${marks.end}`
    at = hit.to
  }
  out += plain.slice(at, to)
  return `${from > 0 ? '…' : ''}${out.trim()}${to < plain.length ? '…' : ''}`
}

/** Ajoute une section à la fin d'une page (action `pages.append`) : `## Titre` en Markdown, `\section*{Titre}` en LaTeX. */
export function appendSection(content: string, addition: string, heading?: string | null, format: PageFormat = 'markdown'): string {
  if (format === 'latex') return appendLatexSection(content, addition, heading)
  const block = heading?.trim() ? `## ${heading.trim()}\n\n${addition.trim()}` : addition.trim()
  const base = content.replace(/\s+$/, '')
  return base ? `${base}\n\n${block}\n` : `${block}\n`
}
