// Rendu d'une page écrite en LaTeX (chargé à la demande : l'analyseur et KaTeX ne pèsent que sur ces pages).
// Mêmes éléments que le rendu Markdown (liens [[…]], titres ancrés, code copiable, images agrandissables).

import { TriangleAlert } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import 'katex/dist/katex.min.css'

import { latexHeadings, latexToHast } from '../lib/latex.ts'
import type { Heading } from '../lib/markdown.ts'
import { useContentComponents, type MarkdownProps } from './Markdown.tsx'

export interface LatexProps extends Omit<MarkdownProps, 'onToggleTask'> {
  /** Titres de la page, pour la table des matières. */
  onHeadings?: (headings: Heading[]) => void
}

export default function Latex({ content, spaceId, preview, onHeadings }: LatexProps) {
  // Pendant la frappe, l'aperçu suit sans ralentir la saisie.
  const source = useDeferredValue(content)
  const result = useMemo(() => {
    try {
      return { tree: latexToHast(source), error: null }
    } catch (error) {
      return { tree: null, error: error as Error }
    }
  }, [source])
  const headings = useMemo(() => (result.tree ? latexHeadings(result.tree) : []), [result.tree])
  useEffect(() => onHeadings?.(headings), [headings, onHeadings])
  const { components, overlay } = useContentComponents({ spaceId, preview })

  if (!result.tree) {
    return (
      <div className="notice notice--danger" role="alert">
        <TriangleAlert aria-hidden />
        <div style={{ flex: 1 }}>Le LaTeX de cette page n’a pas pu être lu : {result.error?.message}</div>
      </div>
    )
  }
  return (
    <>
      {toJsxRuntime(result.tree, { Fragment, jsx, jsxs, components: components as never, ignoreInvalidStyle: true })}
      {overlay}
    </>
  )
}
