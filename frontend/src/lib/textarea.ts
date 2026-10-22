// Édition du texte Markdown dans un <textarea> : insertion qui garde l'annulation (⌘Z) du navigateur.

/** Remplace la sélection par `text` (annulable), puis sélectionne [selStart, selEnd] relatifs au début de l'insertion. */
export function insertText(area: HTMLTextAreaElement, text: string, select?: [number, number]): void {
  const start = area.selectionStart
  area.focus()
  // execCommand garde la pile d'annulation ; setRangeText sert de repli.
  const ok = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)
  if (!ok) {
    area.setRangeText(text, area.selectionStart, area.selectionEnd, 'end')
    area.dispatchEvent(new Event('input', { bubbles: true }))
  }
  if (select) area.setSelectionRange(start + select[0], start + select[1])
}

/** Entoure la sélection (ou un texte d'exemple sélectionné) : **gras**, *italique*, `code`… */
export function wrap(area: HTMLTextAreaElement, before: string, after: string, placeholder: string): void {
  const selected = area.value.slice(area.selectionStart, area.selectionEnd)
  const inner = selected || placeholder
  insertText(area, `${before}${inner}${after}`, [before.length, before.length + inner.length])
}

/** Ajoute (ou retire) un préfixe au début de chaque ligne sélectionnée : « - », « 1. », « > », « ## »… */
export function prefixLines(area: HTMLTextAreaElement, prefix: string | ((i: number) => string)): void {
  const value = area.value
  const lineStart = value.lastIndexOf('\n', area.selectionStart - 1) + 1
  let lineEnd = value.indexOf('\n', area.selectionEnd)
  if (lineEnd === -1) lineEnd = value.length
  const lines = value.slice(lineStart, lineEnd).split('\n')
  const make = (i: number) => (typeof prefix === 'string' ? prefix : prefix(i))
  const all = lines.every((l, i) => l.startsWith(make(i)))
  const next = lines.map((l, i) => (all ? l.slice(make(i).length) : `${make(i)}${l}`)).join('\n')
  area.setSelectionRange(lineStart, lineEnd)
  insertText(area, next, [0, next.length])
}

const LIST_RE = /^(\s*)(?:([-*+])\s+(\[[ xX]\]\s+)?|(\d+)([.)])\s+)/

/**
 * Entrée dans une liste : continue la liste (« - », « 1. » → « 2. », case à cocher vide),
 * ou la termine si la ligne ne contient que la puce. Renvoie false si rien n'a été fait.
 */
export function continueList(area: HTMLTextAreaElement): boolean {
  if (area.selectionStart !== area.selectionEnd) return false
  const value = area.value
  const caret = area.selectionStart
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1
  const line = value.slice(lineStart, caret)
  const m = LIST_RE.exec(line)
  if (!m) return false
  if (line.trim() === m[0].trim() && value.slice(caret, value.indexOf('\n', caret) === -1 ? value.length : value.indexOf('\n', caret)).trim() === '') {
    // Puce seule : on sort de la liste.
    area.setSelectionRange(lineStart, caret)
    insertText(area, '')
    return true
  }
  const indent = m[1] ?? ''
  const bullet = m[2] ? `${m[2]} ${m[3] ? '[ ] ' : ''}` : `${Number(m[4]) + 1}${m[5]} `
  insertText(area, `\n${indent}${bullet}`)
  return true
}

/** Position (en pixels, relative au textarea) du curseur : pour placer la liste de suggestions [[…]]. */
export function caretPosition(area: HTMLTextAreaElement): { top: number; left: number } {
  const mirror = document.createElement('div')
  const style = getComputedStyle(area)
  for (const prop of [
    'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize', 'whiteSpace', 'wordWrap', 'wordBreak',
  ] as const) {
    mirror.style[prop] = style[prop]
  }
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.textContent = area.value.slice(0, area.selectionStart)
  const marker = document.createElement('span')
  marker.textContent = '​'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const top = marker.offsetTop - area.scrollTop + parseFloat(style.lineHeight || '20')
  const left = marker.offsetLeft - area.scrollLeft
  mirror.remove()
  return { top, left }
}
