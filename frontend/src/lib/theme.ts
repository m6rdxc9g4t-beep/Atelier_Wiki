// Thème clair / sombre (docs/SUITE.md §1.5 d'Atelier Projets) : la préférence est commune à la suite.
// public/atelier-theme.js (copie verbatim de design-system/brand/) la lit et l'applique avant le premier rendu :
// sur <html>, data-theme="dark" ET la classe « dark » en sombre, data-theme="light" sans « dark » en clair.
// Le sélecteur du Wiki passe par window.atelierTheme.set(pref) et suit l'événement « atelier-theme ».

import { useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'

interface AtelierTheme {
  get: () => ThemePreference
  set: (preference: ThemePreference) => void
  resolved: () => 'light' | 'dark'
}

declare global {
  interface Window {
    atelierTheme?: AtelierTheme
  }
}

/** Ancienne clé propre au Wiki (avant la préférence commune à la suite). */
export const LEGACY_KEY = 'atelier-wiki:theme'
/** Clé commune de la suite hors VPS (atelier-theme.js). */
export const SUITE_KEY = 'atelier:theme'

const isPreference = (v: unknown): v is ThemePreference => v === 'light' || v === 'dark' || v === 'system'

/**
 * Reprend une fois l'ancienne préférence du Wiki : si la suite n'a encore rien retenu, elle devient la préférence
 * commune. L'ancienne clé est ensuite supprimée (plus rien ne la lit).
 */
export function migrateLegacyPreference(storage: Pick<Storage, 'getItem' | 'removeItem'>, set: (p: ThemePreference) => void): ThemePreference | null {
  let legacy: string | null
  try {
    legacy = storage.getItem(LEGACY_KEY)
  } catch {
    return null
  }
  if (legacy === null) return null
  let adopted: ThemePreference | null = null
  try {
    if (isPreference(legacy) && !isPreference(storage.getItem(SUITE_KEY))) {
      set(legacy)
      adopted = legacy
    }
    storage.removeItem(LEGACY_KEY)
  } catch {
    /* stockage indisponible : rien à reprendre */
  }
  return adopted
}

function current(): ThemePreference {
  const pref = window.atelierTheme?.get()
  return isPreference(pref) ? pref : 'system'
}

export function useTheme(): [ThemePreference, (p: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    const theme = window.atelierTheme
    if (theme && typeof localStorage !== 'undefined') migrateLegacyPreference(localStorage, theme.set)
    return current()
  })

  useEffect(() => {
    const onChange = () => setPreference(current())
    window.addEventListener('atelier-theme', onChange)
    document.addEventListener('visibilitychange', onChange)
    return () => {
      window.removeEventListener('atelier-theme', onChange)
      document.removeEventListener('visibilitychange', onChange)
    }
  }, [])

  const choose = (p: ThemePreference) => {
    if (window.atelierTheme) window.atelierTheme.set(p)
    else setPreference(p)
  }
  return [preference, choose]
}
