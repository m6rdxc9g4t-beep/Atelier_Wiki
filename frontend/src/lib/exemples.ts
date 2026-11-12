// « Exemples de la suite » : règles pures de l'interface (où les proposer, quoi afficher, quand quitter une vue).
// Les appels d'API et l'affichage sont dans components/SuiteExamples.tsx (une seule logique, deux habillages :
// la fenêtre ouverte depuis le pied de la barre latérale, et la carte de l'accueil d'un wiki sans page).

import type { ExempleHistoire } from './api.ts'
import type { Route } from './router.ts'

/**
 * L'accueil ne propose les exemples que tant que le wiki n'a aucune page : il n'a alors rien d'autre à montrer.
 * Dès qu'une page existe, l'entrée au pied de la barre latérale suffit (présente sur toutes les vues).
 */
export function showExamplesOnHome(spaces: readonly { pageCount: number }[]): boolean {
  return spaces.every((s) => s.pageCount === 0)
}

/** Histoire affichée : celle mémorisée si elle existe encore, sinon la première. */
export function pickHistoire(histoires: readonly ExempleHistoire[], selected: string | null): ExempleHistoire | undefined {
  return histoires.find((h) => h.id === selected) ?? histoires[0]
}

export type ExamplesStatus = 'loading' | 'error' | 'empty' | 'ready'

/** État de la liste des histoires. Une liste déjà reçue reste affichée pendant une relecture, même en échec. */
export function examplesStatus(list: { data: readonly unknown[] | undefined; error: Error | null }): ExamplesStatus {
  if (list.data?.length) return 'ready'
  if (list.error) return 'error'
  return list.data ? 'empty' : 'loading'
}

/**
 * La vue ouverte appartient-elle à cet espace ? Sert au retrait d'un exemple : son espace disparaît, la vue qui
 * montrait une de ses pages n'aurait plus rien à afficher, on revient à l'accueil.
 */
export function routeInSpace(
  route: Route,
  spaceId: number,
  wiki: { spaces: readonly { id: number; slug: string }[]; titles: readonly { id: number; spaceId: number }[] },
): boolean {
  const pageInSpace = (id: number | null) => id !== null && wiki.titles.some((t) => t.id === id && t.spaceId === spaceId)
  switch (route.name) {
    case 'space':
      return wiki.spaces.some((s) => s.id === spaceId && s.slug === route.slug)
    case 'page':
    case 'edit':
    case 'history':
      return pageInSpace(route.id)
    case 'new':
      return route.spaceId === spaceId || pageInSpace(route.parentId)
    default:
      return false
  }
}

/**
 * Espace à afficher dans la barre latérale quand celui d'un exemple retiré était l'espace courant : le premier des
 * autres (comme le repli du Wiki). Choisi avant de relire les données : la barre ne demande jamais les pages d'un
 * espace supprimé. `null` : rien à changer.
 */
export function spaceAfterRemoval(spaces: readonly { id: number }[], currentId: number | null, removedId: number | null): number | null {
  if (removedId === null || currentId !== removedId) return null
  return spaces.find((s) => s.id !== removedId)?.id ?? null
}
