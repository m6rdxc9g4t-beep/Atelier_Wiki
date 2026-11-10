// Contenu d'une page selon son format : Markdown (rendu immédiat) ou LaTeX (rendu chargé à la demande).

import { lazy, Suspense } from 'react'

import type { PageFormat } from '../lib/api.ts'
import type { Heading } from '../lib/markdown.ts'
import { Markdown, type MarkdownProps } from './Markdown.tsx'
import { Skeleton } from './ui.tsx'

const Latex = lazy(() => import('./Latex.tsx'))

interface PageContentProps extends MarkdownProps {
  format: PageFormat
  /** LaTeX seulement : titres de la page (table des matières). En Markdown, ils se lisent dans le texte. */
  onHeadings?: (headings: Heading[]) => void
}

export function PageContent({ format, onHeadings, onToggleTask, ...props }: PageContentProps) {
  if (format === 'latex') {
    return (
      <Suspense fallback={<Skeleton lines={6} />}>
        <Latex {...props} onHeadings={onHeadings} />
      </Suspense>
    )
  }
  return <Markdown {...props} onToggleTask={onToggleTask} />
}
