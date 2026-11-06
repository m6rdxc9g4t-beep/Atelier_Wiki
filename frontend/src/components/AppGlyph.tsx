// Glyphes des apps de la suite (docs/SUITE.md §1.6) : mêmes dessins que le portail
// (Atelier_Deploy/portail/public/atelier-icons.svg, dérivés de Lucide, licence ISC). Wiki = « book-open ».

import type { ReactNode } from 'react'

import type { SuiteAppId } from '../lib/suite.ts'

const PATHS: Record<SuiteAppId, ReactNode> = {
  nexus: (
    <>
      <rect width="8" height="8" x="3" y="3" rx="2" />
      <path d="M7 11v4a2 2 0 0 0 2 2h4" />
      <rect width="8" height="8" x="13" y="13" rx="2" />
    </>
  ),
  viz: (
    <>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M18 17V9M13 17V5M8 17v-3" />
    </>
  ),
  tab: (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18" />
    </>
  ),
  projets: <path d="M6 5v11M12 5v6M18 5v14" />,
  wiki: (
    <>
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </>
  ),
  formulaire: (
    <>
      <rect width="8" height="4" x="8" y="2" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M12 11h4M12 16h4M8 11h.01M8 16h.01" />
    </>
  ),
}

/** Glyphe blanc posé dans `.atelier-brand__tile` (la tuile fixe la taille et l'épaisseur du trait). */
export function AppGlyph({ id }: { id: SuiteAppId }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[id]}
    </svg>
  )
}
