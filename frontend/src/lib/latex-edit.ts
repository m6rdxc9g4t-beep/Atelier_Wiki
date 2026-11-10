// Écriture du LaTeX dans l'éditeur : outils de mise en forme (environnements, \item), pièces jointes.

import { insertText } from './textarea.ts'

/** Échappe les caractères spéciaux du LaTeX dans un texte (nom de fichier, légende…). */
export function escapeLatex(text: string): string {
  return text.replace(/[\\{}%$&#_^~]/g, (c) => (c === '\\' ? '\\textbackslash{}' : c === '^' ? '\\^{}' : c === '~' ? '\\~{}' : `\\${c}`))
}

/** Texte inséré pour une pièce jointe : une figure pour une image, un lien pour un fichier. */
export function latexAttachment(att: { name: string; url: string; isImage: boolean }): string {
  const name = escapeLatex(att.name.replace(/\.[a-z0-9]+$/i, ''))
  if (att.isImage) {
    return `\\begin{figure}\n  \\centering\n  \\includegraphics[width=\\linewidth]{${att.url}}\n  \\caption{${name}}\n\\end{figure}\n`
  }
  return `\\href{${att.url}}{📎 ${escapeLatex(att.name)}}`
}

/**
 * Environnement autour des lignes sélectionnées. Avec `item`, chaque ligne non vide devient un \item
 * (itemize, enumerate) ; sans sélection, un modèle à compléter.
 */
export function environmentText(env: string, selected: string, item: boolean, placeholder: string): string {
  const lines = selected ? selected.split('\n') : [placeholder]
  const body = item
    ? lines.filter((l) => l.trim()).map((l) => `  \\item ${l.trim().replace(/^\\item\s*/, '')}`)
    : lines.map((l) => `  ${l}`)
  return `\\begin{${env}}\n${body.join('\n')}\n\\end{${env}}`
}

export function latexEnvironment(area: HTMLTextAreaElement, env: string, item: boolean, placeholder: string): void {
  const start = area.value.lastIndexOf('\n', area.selectionStart - 1) + 1
  let end = area.value.indexOf('\n', area.selectionEnd)
  if (end === -1) end = area.value.length
  const selected = area.selectionStart === area.selectionEnd ? '' : area.value.slice(start, end)
  if (selected) area.setSelectionRange(start, end)
  const text = environmentText(env, selected, item, placeholder)
  // Sans sélection : le texte d'exemple est sélectionné, prêt à être remplacé.
  const at = selected ? null : text.indexOf(placeholder)
  insertText(area, text, at === null ? undefined : [at, at + placeholder.length])
}

const ITEM_RE = /^(\s*)\\item\b\s?/

/** Entrée sur une ligne « \item … » : nouvelle ligne \item ; sur un \item vide, on le retire. Renvoie false sinon. */
export function continueItem(area: HTMLTextAreaElement): boolean {
  if (area.selectionStart !== area.selectionEnd) return false
  const value = area.value
  const caret = area.selectionStart
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1
  const line = value.slice(lineStart, caret)
  const m = ITEM_RE.exec(line)
  if (!m) return false
  if (line.trim() === '\\item') {
    area.setSelectionRange(lineStart, caret)
    insertText(area, '')
    return true
  }
  insertText(area, `\n${m[1] ?? ''}\\item `)
  return true
}

/** Tableau LaTeX vide (deux colonnes, ligne d'en-tête). */
export const LATEX_TABLE = '\\begin{tabular}{|l|l|}\n  \\hline\n  Colonne & Colonne \\\\\n  \\hline\n   &  \\\\\n  \\hline\n\\end{tabular}\n'
