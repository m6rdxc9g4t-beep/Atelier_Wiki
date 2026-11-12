// Fenêtres : à qui rendre le focus quand elles se ferment, et ce que font les raccourcis de la recherche pendant
// qu'une fenêtre est ouverte (règles pures, testées sans DOM).

/**
 * Le focus revient au déclencheur. S'il n'est plus atteignable — retiré de la page, ou resté dans le tiroir du
 * téléphone, refermé parce que l'adresse a changé pendant que la fenêtre était ouverte — il va au repli
 * (le bouton du menu), jamais nulle part.
 */
export function focusReturn<T extends { isConnected: boolean }>(options: {
  opener: T | null
  fallback: T | null
  /** La barre latérale est un tiroir (écran étroit). */
  drawer: boolean
  /** L'adresse a changé depuis l'ouverture : le tiroir se referme. */
  moved: boolean
}): T | null {
  const { opener, fallback, drawer, moved } = options
  if (opener?.isConnected && !(drawer && moved)) return opener
  return fallback?.isConnected ? fallback : null
}

/**
 * Raccourcis de la recherche rapide : ⌘K / Ctrl+K partout (ouvre ou referme), « / » hors saisie (ouvre).
 * Rien tant qu'une fenêtre modale est ouverte : la recherche se monterait derrière elle, invisible et hors d'atteinte,
 * puis surgirait à sa fermeture sans avoir été demandée.
 */
export function paletteShortcut(
  e: { key: string; metaKey: boolean; ctrlKey: boolean },
  state: {
    /** La touche est tapée dans un champ. */
    typing: boolean
    /** Une fenêtre modale (`dialog[open]`) est affichée. */
    modal: boolean
  },
): 'toggle' | 'open' | null {
  if (state.modal) return null
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') return 'toggle'
  if (e.key === '/' && !state.typing && !e.metaKey && !e.ctrlKey) return 'open'
  return null
}
