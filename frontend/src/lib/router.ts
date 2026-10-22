// Routeur minimal (History API) : quelques adresses lisibles, sans dépendance.
//   /                      accueil
//   /espace/<slug>         un espace
//   /p/<id>[-slug]         lecture d'une page
//   /p/<id>/modifier       édition
//   /p/<id>/historique     historique (?v=<version>)
//   /nouvelle              nouvelle page (?espace=<id>&parent=<id>&titre=<…>)
//   /recherche?q=…         résultats de recherche
//   /corbeille             corbeille

import { useSyncExternalStore, type MouseEvent } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'space'; slug: string }
  | { name: 'page'; id: number }
  | { name: 'edit'; id: number }
  | { name: 'history'; id: number; version: number | null }
  | { name: 'new'; spaceId: number | null; parentId: number | null; title: string }
  | { name: 'search'; q: string }
  | { name: 'trash' }
  | { name: 'notFound' }

const num = (value: string | null): number | null => {
  const n = Number(value)
  return value && Number.isSafeInteger(n) && n > 0 ? n : null
}

export function parseRoute(pathname: string, search: string): Route {
  const params = new URLSearchParams(search)
  const path = decodeURIComponent(pathname).replace(/\/+$/, '') || '/'
  if (path === '/') return { name: 'home' }
  if (path === '/corbeille') return { name: 'trash' }
  if (path === '/recherche') return { name: 'search', q: params.get('q') ?? '' }
  if (path === '/nouvelle') {
    return { name: 'new', spaceId: num(params.get('espace')), parentId: num(params.get('parent')), title: params.get('titre') ?? '' }
  }
  let m = /^\/espace\/([^/]+)$/.exec(path)
  if (m) return { name: 'space', slug: m[1]! }
  m = /^\/p\/(\d+)(?:-[^/]*)?(?:\/(modifier|historique))?$/.exec(path)
  if (m) {
    const id = Number(m[1])
    if (m[2] === 'modifier') return { name: 'edit', id }
    if (m[2] === 'historique') return { name: 'history', id, version: num(params.get('v')) }
    return { name: 'page', id }
  }
  return { name: 'notFound' }
}

type Guard = () => boolean
const listeners = new Set<() => void>()
/** Une vue avec des modifications non enregistrées peut refuser de quitter (confirmation). */
let leaveGuard: Guard | null = null

export function setLeaveGuard(guard: Guard | null): void {
  leaveGuard = guard
}

function emit() {
  for (const l of listeners) l()
}

window.addEventListener('popstate', emit)

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const current = location.pathname + location.search + location.hash
  if (to === current) return
  if (leaveGuard && !leaveGuard()) return
  if (options.replace) history.replaceState(null, '', to)
  else history.pushState(null, '', to)
  const [, hash] = to.split('#')
  if (!hash) window.scrollTo(0, 0)
  emit()
}

let snapshot = { path: location.pathname, search: location.search, key: location.pathname + location.search }
function getSnapshot() {
  const key = location.pathname + location.search
  if (key !== snapshot.key) snapshot = { path: location.pathname, search: location.search, key }
  return snapshot
}

export function useLocation() {
  return useSyncExternalStore((cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }, getSnapshot)
}

export function useRoute(): Route {
  const loc = useLocation()
  return parseRoute(loc.path, loc.search)
}

/** Clic sur un lien interne : navigation sans recharger (sauf ⌘/Ctrl/milieu → nouvel onglet). */
export function onLinkClick(event: MouseEvent<HTMLAnchorElement>, to: string): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  navigate(to)
}
