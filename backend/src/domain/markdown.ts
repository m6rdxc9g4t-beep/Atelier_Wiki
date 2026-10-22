// Règles pures sur le texte des pages : liens internes, titres normalisés, extraits.
// Le frontend applique les mêmes règles de liens (frontend/src/lib/wikilinks.ts).

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

/** Liens sortants d'une page, sans doublon. */
export function extractLinks(markdown: string): ExtractedLink[] {
  const text = stripCode(markdown)
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
  for (const match of text.matchAll(PAGE_URL_RE)) {
    const key = `${match[1]}|`
    if (!seen.has(key)) {
      seen.add(key)
      links.push({ targetId: Number(match[1]), targetTitle: null })
    }
  }
  return links
}

/** Texte brut court (aperçus des listes) : sans syntaxe Markdown. */
export function excerpt(markdown: string, max = 180): string {
  const text = stripCode(markdown)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(WIKILINK_RE, (_m, title: string, label?: string) => (label ?? title).trim())
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|?[-:| ]+\|?\s*$/gm, '')
    .replace(/[*_~`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** Ajoute une section à la fin d'une page (action `pages.append`). */
export function appendSection(content: string, addition: string, heading?: string | null): string {
  const block = heading?.trim() ? `## ${heading.trim()}\n\n${addition.trim()}` : addition.trim()
  const base = content.replace(/\s+$/, '')
  return base ? `${base}\n\n${block}\n` : `${block}\n`
}
