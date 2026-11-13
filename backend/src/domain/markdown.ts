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
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', zwj: '\u200d', zwnj: '\u200c',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', lsaquo: '‹', rsaquo: '›', hellip: '…', ndash: '–', mdash: '—',
  euro: '€', trade: '™', bull: '•', permil: '‰', dagger: '†', prime: '′', Prime: '″', oelig: 'œ', OElig: 'Œ', Yuml: 'Ÿ', check: '✓', cross: '✗',
  rarr: '→', larr: '←', uarr: '↑', darr: '↓', harr: '↔', rArr: '⇒', lArr: '⇐', hArr: '⇔',
  le: '≤', ge: '≥', ne: '≠', asymp: '≈', equiv: '≡', minus: '−', infin: '∞', sum: '∑', prod: '∏', radic: '√', part: '∂', isin: '∈', empty: '∅',
}
// Tout Latin-1 (U+00A0 à U+00FF : « &eacute; », « &times; », « &deg; »…) et l'alphabet grec, dans l'ordre d'Unicode.
const ENTITY_RANGES: [first: number, names: string][] = [
  [0xa0, 'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest'],
  [0xc0, 'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig'],
  [0xe0, 'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'],
  [0x391, 'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho'],
  [0x3a3, 'Sigma Tau Upsilon Phi Chi Psi Omega'],
  [0x3b1, 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega'],
]
for (const [first, names] of ENTITY_RANGES) {
  names.split(' ').forEach((name, i) => {
    // Une entrée de la table du dessus l'emporte (« &nbsp; » devient une espace ordinaire).
    if (!Object.hasOwn(NAMED_ENTITIES, name)) NAMED_ENTITIES[name] = String.fromCodePoint(first + i)
  })
}

/** Entités HTML → caractères : nommées (table ci-dessus), décimales (`&#233;`) et hexadécimales (`&#xE9;`). Une entité inconnue reste telle quelle. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,11});/g, (match, body: string) => {
    // `Object.hasOwn` : « &constructor; » ou « &toString; » ne sont pas des entités (propriétés héritées de tout objet).
    if (body[0] !== '#') return Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body]! : match
    const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
    // Jamais de caractère de contrôle (les marqueurs de la recherche en sont) ni de code hors d'Unicode.
    if (!Number.isInteger(code) || code < 0x20 || (code >= 0x7f && code < 0xa0) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ' '
    return String.fromCodePoint(code)
  })
}

/** Éléments HTML, actuels et anciens : seuls leurs noms font une balise. */
const HTML_TAGS = new Set(
  (
    'a abbr acronym address area article aside audio b base bdi bdo big blockquote body br button canvas caption center cite code col colgroup ' +
    'data datalist dd del details dfn dialog dir div dl dt em embed fieldset figcaption figure font footer form frame frameset h1 h2 h3 h4 h5 h6 ' +
    'head header hgroup hr html i iframe img input ins kbd label legend li link main map mark marquee menu meta meter nav nobr noscript object ol ' +
    'optgroup option output p param picture pre progress q rp rt ruby s samp script search section select slot small source span strike strong ' +
    'style sub summary sup svg table tbody td template textarea tfoot th thead time title tr track tt u ul var video wbr'
  ).split(' '),
)

/**
 * Retire les balises HTML (`<br>`, `<span …>`, `</td>`, commentaires) : une espace à la place, le texte autour reste.
 * Ce qui n'est pas un élément HTML reste du texte, comme dans la page : `Array<string>`, « <nom de la branche> ».
 */
export function stripTags(text: string): string {
  return text
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<((?:https?|mailto):[^\s<>]+)>/g, '$1')
    .replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*)?\/?>/g, (match, name: string) => (HTML_TAGS.has(name.toLowerCase()) ? ' ' : match))
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
 * Place du premier mot trouvé dans un extrait : une liste coupe l'extrait à deux lignes, soit une soixantaine de
 * caractères au téléphone. Le mot doit finir dans les `EXCERPT_LEAD` premiers ; sinon l'extrait commence
 * `EXCERPT_BEFORE` caractères avant lui.
 */
const EXCERPT_LEAD = 50
const EXCERPT_BEFORE = 30

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
  if (first && first.to > EXCERPT_LEAD) {
    // Le mot trouvé ne tiendrait pas dans les deux premières lignes : la fenêtre commence un peu avant lui, sur un
    // début de mot.
    from = Math.max(0, first.from - EXCERPT_BEFORE)
    if (from > 0 && plain[from - 1] !== ' ') {
      const space = plain.indexOf(' ', from)
      if (space >= 0 && space < first.from) from = space + 1
    }
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
