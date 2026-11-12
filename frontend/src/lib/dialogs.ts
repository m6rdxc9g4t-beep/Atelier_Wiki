// Fenêtres : à qui rendre le focus quand elles se ferment (règle pure, testée sans DOM).

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
