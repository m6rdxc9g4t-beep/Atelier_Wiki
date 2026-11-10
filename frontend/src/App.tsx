// Coquille de l'application : en-tête, barre latérale, vue de l'adresse courante, recherche ⌘K, raccourcis.

import { lazy, Suspense, useCallback, useEffect, useState } from 'react'

import { CommandPalette } from './components/CommandPalette.tsx'
import { AboutDialog, Topbar } from './components/Header.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { Skeleton, UiProvider } from './components/ui.tsx'
import { useWiki, WikiProvider } from './components/WikiContext.tsx'
import { navigate, useLocation, useRoute, type Route } from './lib/router.ts'
import { HistoryView } from './views/HistoryView.tsx'
import { HomeView, NotFoundView, SearchView, SpaceView, TrashView } from './views/OtherViews.tsx'
import { isTyping, PageView } from './views/PageView.tsx'

// L'éditeur (outils, conversion du HTML collé) n'est chargé qu'à la première écriture : la lecture reste légère.
const EditPageView = lazy(() => import('./views/EditorView.tsx').then((m) => ({ default: m.EditPageView })))
const NewPageView = lazy(() => import('./views/EditorView.tsx').then((m) => ({ default: m.NewPageView })))

function View({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <HomeView />
    case 'space':
      return <SpaceView slug={route.slug} />
    case 'page':
      return <PageView id={route.id} />
    case 'edit':
      return (
        <Suspense fallback={<Skeleton />}>
          <EditPageView id={route.id} />
        </Suspense>
      )
    case 'history':
      return <HistoryView id={route.id} version={route.version} />
    case 'new':
      return (
        <Suspense fallback={<Skeleton />}>
          <NewPageView spaceId={route.spaceId} parentId={route.parentId} title={route.title} />
        </Suspense>
      )
    case 'search':
      return <SearchView q={route.q} />
    case 'trash':
      return <TrashView />
    default:
      return <NotFoundView />
  }
}

/** Titre de la barre haute : la vue ouverte (le titre de la page reste dans le contenu). */
function viewTitle(route: Route, spaceName: string | undefined, spaces: { slug: string; name: string }[]): string {
  switch (route.name) {
    case 'home':
      return 'Accueil'
    case 'space':
      return spaces.find((s) => s.slug === route.slug)?.name ?? 'Espace'
    case 'page':
      return spaceName ?? 'Page'
    case 'edit':
      return 'Modifier la page'
    case 'history':
      return 'Historique'
    case 'new':
      return 'Nouvelle page'
    case 'search':
      return 'Recherche'
    case 'trash':
      return 'Corbeille'
    default:
      return 'Page introuvable'
  }
}

function Shell() {
  const route = useRoute()
  const { key } = useLocation()
  const { currentSpace, spaces } = useWiki()
  const [navOpen, setNavOpen] = useState(false)

  // Menu (écran étroit) refermé à chaque changement d'adresse.
  useEffect(() => setNavOpen(false), [key])

  // N : nouvelle page dans l'espace courant (hors saisie et hors éditeur).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open], .palette')) return
      if (e.key === 'n' && route.name !== 'edit' && route.name !== 'new') {
        e.preventDefault()
        navigate(currentSpace ? `/nouvelle?espace=${currentSpace.id}` : '/nouvelle')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [route, currentSpace])

  return (
    <div className="shell" data-nav={navOpen ? 'open' : 'closed'}>
      <a className="sr-only" href="#contenu">
        Aller au contenu
      </a>
      <aside className="sidebar" aria-label="Pages du wiki">
        <Sidebar route={route} onNavigate={() => setNavOpen(false)} />
      </aside>
      <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} />
      <div className="main-col">
        <Topbar title={viewTitle(route, currentSpace?.name, spaces)} navOpen={navOpen} onToggleNav={() => setNavOpen((o) => !o)} />
        <main className="main" id="contenu">
          <View route={route} />
        </main>
      </div>
      <AboutDialog />
    </div>
  )
}

export function App() {
  const [palette, setPalette] = useState<string | null>(null)
  const openPalette = useCallback((initial = '') => setPalette(initial), [])

  // ⌘K / Ctrl+K partout ; « / » hors saisie.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => (p === null ? '' : null))
      } else if (e.key === '/' && !isTyping(e.target) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setPalette('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <UiProvider>
      <WikiProvider openPalette={openPalette}>
        <Shell />
        {palette !== null && <CommandPalette initial={palette} onClose={() => setPalette(null)} />}
      </WikiProvider>
    </UiProvider>
  )
}
