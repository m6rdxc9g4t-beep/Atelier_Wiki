// Coquille de l'application : barre latérale (rail d'icônes sous 1024 px, panneau des pages par-dessus), barre haute,
// vue de l'adresse courante, recherche ⌘K, raccourcis.

import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { CommandPalette } from './components/CommandPalette.tsx'
import { AboutDialog, Topbar } from './components/Header.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { SuiteExamplesDialog } from './components/SuiteExamples.tsx'
import { Skeleton, UiProvider } from './components/ui.tsx'
import { useWiki, WikiProvider } from './components/WikiContext.tsx'
import { focusReturn, paletteShortcut } from './lib/dialogs.ts'
import { PANEL_LAYERS, panelCovers, panelShortcut, RAIL_QUERY } from './lib/shell.ts'
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

function watchRail(notify: () => void) {
  const media = window.matchMedia(RAIL_QUERY)
  media.addEventListener('change', notify)
  return () => media.removeEventListener('change', notify)
}

/** La fenêtre est-elle assez étroite pour le rail d'icônes (sous 1024 px) ? */
function useRail(): boolean {
  return useSyncExternalStore(watchRail, () => window.matchMedia(RAIL_QUERY).matches)
}

function Shell() {
  const route = useRoute()
  const { key } = useLocation()
  const { currentSpace, spaces } = useWiki()
  const [navOpen, setNavOpen] = useState(false)
  const rail = useRail()
  // Tant que le panneau couvre la page, le reste est inerte (règle : `panelCovers`).
  const covered = panelCovers({ open: navOpen, rail })

  // Panneau des pages (ouvert par-dessus la page depuis le rail) : refermé à chaque changement d'adresse, et quand la
  // fenêtre s'élargit jusqu'à la barre complète.
  useEffect(() => setNavOpen(false), [key, rail])

  const sidebar = useRef<HTMLElement>(null)
  const closeNav = useCallback(() => setNavOpen(false), [])
  const railMode = () => window.matchMedia(RAIL_QUERY).matches

  // À l'ouverture, le focus entre dans le panneau (le bouton « Pages » du rail vient de disparaître) ; quand il se
  // referme alors que le focus y était resté — Échap, « Replier », voile — il revient à ce bouton.
  const wasOpen = useRef(false)
  useEffect(() => {
    const aside = sidebar.current
    if (!aside || !railMode()) {
      wasOpen.current = navOpen
      return
    }
    if (navOpen) aside.querySelector<HTMLElement>('[data-panel-close]')?.focus()
    else if (wasOpen.current && (document.activeElement === document.body || aside.contains(document.activeElement))) {
      aside.querySelector<HTMLElement>('[data-panel-open]')?.focus()
    }
    wasOpen.current = navOpen
  }, [navOpen])

  // Échap referme le panneau (règle : `panelShortcut`). Écouteur en phase de capture : ce qui est ouvert par-dessus
  // est lu avant de traiter la touche — la recherche et les menus se referment en la recevant, et à la remontée ils
  // ne seraient plus là : un seul Échap refermait alors la recherche et le panneau.
  useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (panelShortcut(e, { open: railMode(), layered: document.querySelector(PANEL_LAYERS) !== null }) === 'close') {
        e.preventDefault()
        setNavOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [navOpen])

  // « Exemples de la suite » : fenêtre ouverte depuis le pied de la barre latérale. À sa fermeture, le focus revient
  // au bouton qui l'a ouverte (il reste affiché dans le rail) ; s'il n'est plus affiché, au bouton « Pages » du rail.
  const [examples, setExamples] = useState<{ opener: HTMLElement } | null>(null)
  const closeExamples = useCallback(() => setExamples(null), [])
  const shownExamples = useRef(examples)
  useEffect(() => {
    const closed = shownExamples.current
    shownExamples.current = examples
    if (examples || !closed) return
    const fallback = sidebar.current?.querySelector<HTMLElement>('[data-panel-open]') ?? null
    focusReturn<HTMLElement>({ opener: closed.opener, fallback, hidden: closed.opener.getClientRects().length === 0 })?.focus()
  }, [examples])

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
      <a className="sr-only" href="#contenu" inert={covered}>
        Aller au contenu
      </a>
      <aside ref={sidebar} className="sidebar" aria-label="Pages du wiki">
        <Sidebar
          route={route}
          panelOpen={navOpen}
          onOpenPanel={() => setNavOpen(true)}
          onClosePanel={closeNav}
          onNavigate={closeNav}
          onOpenExamples={(opener) => setExamples({ opener })}
        />
      </aside>
      <div className="sidebar-backdrop" onClick={closeNav} />
      <div className="main-col" inert={covered}>
        <Topbar title={viewTitle(route, currentSpace?.name, spaces)} />
        <main className="main" id="contenu">
          <View route={route} />
        </main>
      </div>
      <AboutDialog />
      {examples && <SuiteExamplesDialog onClose={closeExamples} />}
    </div>
  )
}

export function App() {
  const [palette, setPalette] = useState<string | null>(null)

  // Qui avait le focus à l'ouverture de la recherche le retrouve à sa fermeture (bouton « Rechercher… », éditeur) :
  // sinon il se perd sur la page — et sous 1024 px, hors du panneau resté ouvert. Retenu avant l'ouverture : le champ
  // de la recherche prend le focus dès qu'il est monté.
  const paletteOpener = useRef<HTMLElement | null>(null)
  const rememberFocus = () => {
    if (document.querySelector('.palette')) return
    const active = document.activeElement
    paletteOpener.current = active instanceof HTMLElement && active !== document.body ? active : null
  }
  const paletteOpen = palette !== null
  useEffect(() => {
    if (paletteOpen) return
    const opener = paletteOpener.current
    paletteOpener.current = null
    // Déclencheur retiré ou plus affiché (l'adresse a changé, le panneau s'est refermé) : rien, le panneau s'en charge.
    if (opener) focusReturn<HTMLElement>({ opener, fallback: null, hidden: opener.getClientRects().length === 0 })?.focus()
  }, [paletteOpen])

  const openPalette = useCallback((initial = '') => {
    rememberFocus()
    setPalette(initial)
  }, [])

  // ⌘K / Ctrl+K partout ; « / » hors saisie ; rien sous une fenêtre modale (règle : `paletteShortcut`).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = paletteShortcut(e, { typing: isTyping(e.target), modal: document.querySelector('dialog[open]') !== null })
      if (!action) return
      e.preventDefault()
      rememberFocus()
      setPalette((p) => (action === 'toggle' && p !== null ? null : ''))
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
