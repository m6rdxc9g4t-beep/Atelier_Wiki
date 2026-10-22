// État partagé par toute l'interface : espaces, index des titres (liens [[…]]), espace courant, auteur.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { api, type Space, type TitleEntry } from '../lib/api.ts'
import { useAsync, useTopic } from '../lib/data.ts'
import { normalizeTitle } from '../lib/markdown.ts'

interface WikiContextValue {
  spaces: Space[]
  spacesLoaded: boolean
  titles: TitleEntry[]
  /** Titre normalisé → page (liens [[Titre]]). */
  titleIndex: Map<string, TitleEntry>
  currentSpace: Space | null
  setCurrentSpaceId: (id: number) => void
  user: string
  openPalette: (initial?: string) => void
}

const WikiContext = createContext<WikiContextValue | null>(null)

export function useWiki(): WikiContextValue {
  const value = useContext(WikiContext)
  if (!value) throw new Error('WikiProvider manquant')
  return value
}

const SPACE_KEY = 'atelier-wiki:space'

export function WikiProvider({ children, openPalette }: { children: ReactNode; openPalette: (initial?: string) => void }) {
  const spacesVersion = useTopic('spaces')
  const titlesVersion = useTopic('titles')
  const spaces = useAsync(() => api.spaces(), [spacesVersion])
  const titles = useAsync(() => api.titles(), [titlesVersion])
  const me = useAsync(() => api.me(), [])

  const [spaceId, setSpaceId] = useState<number | null>(() => {
    try {
      return Number(localStorage.getItem(SPACE_KEY)) || null
    } catch {
      return null
    }
  })

  const setCurrentSpaceId = useCallback((id: number) => {
    setSpaceId(id)
    try {
      localStorage.setItem(SPACE_KEY, String(id))
    } catch {
      /* rien */
    }
  }, [])

  const list = spaces.data ?? []
  const currentSpace = list.find((s) => s.id === spaceId) ?? list[0] ?? null

  // Espace supprimé ou inconnu : on retombe sur le premier.
  useEffect(() => {
    if (currentSpace && currentSpace.id !== spaceId) setSpaceId(currentSpace.id)
  }, [currentSpace, spaceId])

  const titleIndex = useMemo(() => {
    const map = new Map<string, TitleEntry>()
    for (const t of titles.data ?? []) {
      const key = normalizeTitle(t.title)
      // Deux pages de même titre : le lien vise d'abord celle de l'espace courant.
      const existing = map.get(key)
      if (!existing || (t.spaceId === currentSpace?.id && existing.spaceId !== currentSpace.id)) map.set(key, t)
    }
    return map
  }, [titles.data, currentSpace?.id])

  const value: WikiContextValue = {
    spaces: list,
    spacesLoaded: spaces.data !== undefined,
    titles: titles.data ?? [],
    titleIndex,
    currentSpace,
    setCurrentSpaceId,
    user: me.data?.user ?? '',
    openPalette,
  }

  return <WikiContext.Provider value={value}>{children}</WikiContext.Provider>
}
