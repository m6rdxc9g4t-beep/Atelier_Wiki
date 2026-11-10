// Format d'écriture d'une page : Markdown (défaut) ou LaTeX. Règles pures propres au LaTeX : texte sans code
// (pour chercher les liens), extrait en texte brut, ajout d'une section.
// Le frontend applique les mêmes règles de liens (frontend/src/lib/latex.ts).

export const PAGE_FORMATS = ['markdown', 'latex'] as const
export type PageFormat = (typeof PAGE_FORMATS)[number]

export const isPageFormat = (value: unknown): value is PageFormat => PAGE_FORMATS.includes(value as PageFormat)

/** Environnements dont le contenu est du code, jamais du texte : un lien écrit dedans n'est pas un lien. */
const VERBATIM_ENVS = ['verbatim', 'verbatim*', 'lstlisting', 'minted', 'comment']
const ENV_RE = new RegExp(
  String.raw`\\begin\{(${VERBATIM_ENVS.map((e) => e.replace('*', '\\*')).join('|')})\}[\s\S]*?(?:\\end\{\1\}|$)`,
  'g',
)

/** Retire commentaires (`% …`, sauf `\%`), environnements verbatim et `\verb|…|`. */
export function stripLatexCode(latex: string): string {
  return latex
    .replace(ENV_RE, '')
    .replace(/\\verb\*?([^a-zA-Z\s])[\s\S]*?\1/g, '')
    .replace(/(^|[^\\])%[^\n]*/g, '$1')
}

/** Lien LaTeX vers une page : `\href{/p/12}{…}` ou `\href{/p/12-mon-titre}{…}`. */
export const LATEX_PAGE_URL_RE = /\\href\{\s*\/p\/(\d+)(?:-[a-z0-9-]*)?(?:[#?][^}\s]*)?\s*\}/g

/** Corps du document : ce qui est entre \begin{document} et \end{document}, sinon tout le texte. */
export function latexBody(latex: string): string {
  const start = /\\begin\{document\}/.exec(latex)
  if (!start) return latex
  const rest = latex.slice(start.index + start[0].length)
  const end = /\\end\{document\}/.exec(rest)
  return end ? rest.slice(0, end.index) : rest
}

/** Texte brut court d'une page LaTeX (aperçus des listes) : sans commandes ni accolades. */
export function latexExcerpt(latex: string, max = 180): string {
  const text = stripLatexCode(latexBody(latex))
    .replace(/\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g, (_m, title: string, label?: string) => (label ?? title).trim())
    .replace(/\\(?:includegraphics|label|ref|eqref|cite|url|input|include|usepackage|documentclass)\*?(?:\[[^\]]*\])?\{[^}]*\}/g, '')
    .replace(/\\href\{[^}]*\}/g, '')
    .replace(/\\(?:begin|end)\{[^}]*\}(?:\[[^\]]*\])?/g, ' ')
    .replace(/\\item\b(?:\[[^\]]*\])?/g, ' ')
    .replace(/\\\\/g, ' ')
    .replace(/\\([%$&#_{}])/g, '$1')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, '')
    .replace(/[{}~]/g, (c) => (c === '~' ? ' ' : ''))
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

const escapeLatex = (text: string) => text.replace(/([\\{}%$&#_^~])/g, (c) => (c === '\\' ? '\\textbackslash{}' : `\\${c}`))

/** Ajoute une section à la fin d'une page LaTeX (avant \end{document} s'il y en a un). */
export function appendLatexSection(content: string, addition: string, heading?: string | null): string {
  const block = heading?.trim() ? `\\section*{${escapeLatex(heading.trim())}}\n\n${addition.trim()}` : addition.trim()
  const end = /\\end\{document\}\s*$/.exec(content)
  if (end) {
    const base = content.slice(0, end.index).replace(/\s+$/, '')
    return `${base}\n\n${block}\n\n\\end{document}\n`
  }
  const base = content.replace(/\s+$/, '')
  return base ? `${base}\n\n${block}\n` : `${block}\n`
}

/** Document LaTeX complet pour l'export : la page telle quelle si elle a son préambule, sinon un article minimal. */
export function latexDocument(title: string, content: string): string {
  if (/\\documentclass/.test(content)) return `${content.replace(/\s+$/, '')}\n`
  return [
    '\\documentclass[11pt]{article}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage[french]{babel}',
    '\\usepackage{amsmath,amssymb,graphicx,hyperref}',
    '',
    `\\title{${escapeLatex(title)}}`,
    '\\date{}',
    '',
    '\\begin{document}',
    '\\maketitle',
    '',
    content.replace(/\s+$/, ''),
    '',
    '\\end{document}',
    '',
  ].join('\n')
}
