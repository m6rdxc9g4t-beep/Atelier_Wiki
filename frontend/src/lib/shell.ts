// Coquille : règles pures de la barre latérale (testées sans DOM).
// Même forme que dans Atelier Viz et Atelier Tab : barre de 232 px ; sous 1024 px, un rail d'icônes (Viz) d'où le
// panneau complet — espace et arbre des pages — s'ouvre par-dessus la page, en tiroir (Tab).

import type { ThemePreference } from './theme.ts'

/** Dernière largeur du rail d'icônes : la barre complète commence à 1024 px (palier `lg` de Viz). */
export const RAIL_MAX_WIDTH = 1023.98

/** Requête de média du rail : la même que dans `wiki.css` (vérifié par `design.test.ts`). */
export const RAIL_QUERY = `(max-width: ${RAIL_MAX_WIDTH}px)`

const THEME_ORDER: ThemePreference[] = ['system', 'light', 'dark']

/** Bouton de thème du rail : Système → Clair → Sombre → Système. */
export function nextTheme(preference: ThemePreference): ThemePreference {
  return THEME_ORDER[(THEME_ORDER.indexOf(preference) + 1) % THEME_ORDER.length]!
}

/**
 * Ce qui, ouvert par-dessus le panneau, reçoit Échap avant lui : fenêtre modale, recherche (⌘K), menu.
 * À lire **avant** que la touche ne soit traitée (écouteur en phase de capture) : la recherche et les menus se
 * referment en la traitant, et ne seraient plus là pour dire que la touche était pour eux.
 */
export const PANEL_LAYERS = 'dialog[open], .palette, [role="menu"]'

/**
 * Échap referme le panneau ouvert par-dessus la page — sauf si une fenêtre, la recherche ou un menu est ouvert :
 * la touche est alors pour eux (un menu du panneau se referme d'abord, le panneau à l'Échap suivant).
 */
export function panelShortcut(e: { key: string }, state: { open: boolean; layered: boolean }): 'close' | null {
  return e.key === 'Escape' && state.open && !state.layered ? 'close' : null
}

/**
 * Le panneau ouvert depuis le rail couvre la page (voile) : tant qu'il est ouvert, le reste de la page est inerte —
 * Tab ne sort pas vers des liens cachés sous le voile, et rien n'y est activable. Barre complète (≥ 1024 px) : jamais.
 */
export function panelCovers(state: { open: boolean; rail: boolean }): boolean {
  return state.open && state.rail
}

/**
 * Arbre des pages : seuls les premiers niveaux de sous-pages sont décalés. Au-delà, le retrait ne grandit plus, pour
 * qu'une ligne garde toujours la place de son titre dans les 232 px de la barre (rien n'y dépasse, rien n'y défile
 * en largeur).
 */
export const TREE_INDENT_LEVELS = 4

/** Niveau d'une liste de l'arbre (0 = racine de l'espace) : ses lignes sont-elles décalées par rapport au niveau parent ? */
export function treeIndented(depth: number): boolean {
  return depth >= 1 && depth <= TREE_INDENT_LEVELS
}
