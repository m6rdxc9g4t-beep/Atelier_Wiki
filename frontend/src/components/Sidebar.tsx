// Barre latérale : choix de l'espace, arbre des pages (glisser-déposer pour ranger), accueil et corbeille.

import { Check, ChevronDown, ChevronRight, FileText, FolderPlus, Home, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'

import { api, pagePath, type PageSummary } from '../lib/api.ts'
import { invalidate, invalidateAll, useAsync, useTopic } from '../lib/data.ts'
import { plural } from '../lib/format.ts'
import { navigate, onLinkClick, type Route } from '../lib/router.ts'
import { useDismiss, useUi } from './ui.tsx'
import { useWiki } from './WikiContext.tsx'

const EXPANDED_KEY = 'atelier-wiki:expanded'

function loadExpanded(): Set<number> {
  try {
    return new Set((JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as number[]).filter(Number.isFinite))
  } catch {
    return new Set()
  }
}

export function activePageId(route: Route): number | null {
  return route.name === 'page' || route.name === 'edit' || route.name === 'history' ? route.id : null
}

export function Sidebar({ route, onNavigate }: { route: Route; onNavigate: () => void }) {
  const { currentSpace } = useWiki()
  const treeVersion = useTopic('tree')
  const tree = useAsync(() => (currentSpace ? api.tree(currentSpace.id) : Promise.resolve([] as PageSummary[])), [currentSpace?.id, treeVersion])
  const pages = tree.data ?? []
  const activeId = activePageId(route)

  const [expanded, setExpanded] = useState<Set<number>>(loadExpanded)
  const saveExpanded = useCallback((next: Set<number>) => {
    setExpanded(next)
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next].slice(-500)))
    } catch {
      /* rien */
    }
  }, [])

  const children = useMemo(() => {
    const map = new Map<number | null, PageSummary[]>()
    for (const p of pages) {
      const list = map.get(p.parentId) ?? []
      list.push(p)
      map.set(p.parentId, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position || a.id - b.id)
    return map
  }, [pages])

  const byId = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages])

  // Les parents de la page ouverte sont dépliés.
  useEffect(() => {
    if (activeId === null) return
    const missing: number[] = []
    let parent = byId.get(activeId)?.parentId ?? null
    const guard = new Set<number>()
    while (parent !== null && !guard.has(parent)) {
      guard.add(parent)
      if (!expanded.has(parent)) missing.push(parent)
      parent = byId.get(parent)?.parentId ?? null
    }
    if (missing.length) saveExpanded(new Set([...expanded, ...missing]))
  }, [activeId, byId, expanded, saveExpanded])

  const toggle = (id: number) => {
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    saveExpanded(next)
  }

  return (
    <>
      <div className="sidebar__scroll">
        <SpacePicker />
        <div className="tree-head">
          <span id="tree-label">Pages</span>
          {currentSpace && (
            <a
              className="btn btn--ghost btn--icon btn--sm"
              href={`/nouvelle?espace=${currentSpace.id}`}
              title="Nouvelle page (N)"
              aria-label="Nouvelle page dans cet espace"
              onClick={(e) => {
                onLinkClick(e, `/nouvelle?espace=${currentSpace.id}`)
                onNavigate()
              }}
            >
              <Plus />
            </a>
          )}
        </div>
        {tree.error ? (
          <p className="muted" style={{ padding: '0 0.6rem', fontSize: 13 }}>
            {tree.error.message}
          </p>
        ) : pages.length === 0 && !tree.loading ? (
          <p className="muted" style={{ padding: '0 0.6rem', fontSize: 13 }}>
            Cet espace est vide. Crée sa première page avec le bouton +.
          </p>
        ) : (
          <TreeLevel
            parentId={null}
            childrenOf={children}
            byId={byId}
            expanded={expanded}
            toggle={toggle}
            expand={(id) => !expanded.has(id) && saveExpanded(new Set([...expanded, id]))}
            activeId={activeId}
            onNavigate={onNavigate}
            depth={0}
          />
        )}
      </div>
      <nav className="sidebar__foot" aria-label="Navigation">
        <a className="nav-link" href="/" aria-current={route.name === 'home' ? 'page' : undefined} onClick={(e) => (onLinkClick(e, '/'), onNavigate())}>
          <Home aria-hidden /> Accueil
        </a>
        <a
          className="nav-link"
          href="/corbeille"
          aria-current={route.name === 'trash' ? 'page' : undefined}
          onClick={(e) => (onLinkClick(e, '/corbeille'), onNavigate())}
        >
          <Trash2 aria-hidden /> Corbeille
        </a>
      </nav>
    </>
  )
}

// ── Choix de l'espace ───────────────────────────────────────────────────────

function SpacePicker() {
  const { spaces, currentSpace, setCurrentSpaceId } = useWiki()
  const { prompt, confirm, toast } = useUi()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = useCallback((restore: boolean) => {
    setOpen(false)
    if (restore) trigger.current?.focus()
  }, [])
  useDismiss(open, close, root)

  const create = async () => {
    close(false)
    const name = await prompt({ title: 'Nouvel espace', text: 'Un espace regroupe des pages sur un même sujet (Technique, Procédures, Réunions…).', confirmLabel: 'Créer l’espace', placeholder: 'Nom de l’espace' })
    if (!name) return
    try {
      const space = await api.createSpace({ name, icon: '📁' })
      invalidate('spaces', 'home')
      setCurrentSpaceId(space.id)
      navigate(`/espace/${space.slug}`)
    } catch (error) {
      toast((error as Error).message, { tone: 'danger' })
    }
  }

  const rename = async () => {
    close(false)
    if (!currentSpace) return
    const name = await prompt({ title: 'Renommer l’espace', confirmLabel: 'Renommer', initial: currentSpace.name })
    if (!name || name === currentSpace.name) return
    try {
      await api.updateSpace(currentSpace.id, { name })
      invalidate('spaces', 'home')
    } catch (error) {
      toast((error as Error).message, { tone: 'danger' })
    }
  }

  const remove = async () => {
    close(false)
    if (!currentSpace) return
    const ok = await confirm({
      title: `Supprimer l’espace « ${currentSpace.name} » ?`,
      text: 'Seul un espace vide peut être supprimé. Les pages de cet espace déjà dans la corbeille seront supprimées définitivement.',
      confirmLabel: 'Supprimer l’espace',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deleteSpace(currentSpace.id)
      invalidateAll()
      toast('Espace supprimé.')
      navigate('/')
    } catch (error) {
      toast((error as Error).message, { tone: 'danger' })
    }
  }

  return (
    <div className="space-picker" ref={root}>
      <button ref={trigger} type="button" className="space-picker__button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="space-picker__icon" aria-hidden>
          {currentSpace?.icon || '📁'}
        </span>
        <span className="space-picker__name">
          {currentSpace?.name ?? 'Chargement…'}
          {currentSpace && <span className="space-picker__meta">{plural(currentSpace.pageCount, 'page', 'pages')}</span>}
        </span>
        <ChevronDown aria-hidden width={16} height={16} />
      </button>
      {open && (
        <div role="menu" className="popover" style={{ top: 'calc(100% + 6px)', left: 0, right: 0 }}>
          <div className="menu-heading">Espaces</div>
          {spaces.map((s) => (
            <a
              key={s.id}
              role="menuitemradio"
              aria-checked={s.id === currentSpace?.id}
              className="menu-item"
              href={`/espace/${s.slug}`}
              onClick={(e) => {
                setCurrentSpaceId(s.id)
                onLinkClick(e, `/espace/${s.slug}`)
                close(false)
              }}
            >
              <span aria-hidden style={{ width: 18, textAlign: 'center' }}>
                {s.icon || '📁'}
              </span>
              <span className="menu-item__body">
                <span className="menu-item__text">{s.name}</span>
              </span>
              {s.id === currentSpace?.id && <Check aria-hidden />}
            </a>
          ))}
          <div className="menu-sep" />
          <button type="button" role="menuitem" className="menu-item" onClick={create}>
            <FolderPlus aria-hidden /> Nouvel espace…
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={rename}>
            <Pencil aria-hidden /> Renommer cet espace…
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={remove} disabled={spaces.length <= 1}>
            <Trash2 aria-hidden /> Supprimer cet espace…
          </button>
        </div>
      )}
    </div>
  )
}

// ── Arbre ───────────────────────────────────────────────────────────────────

type DropZone = 'before' | 'inside' | 'after'
const DRAG_TYPE = 'application/x-atelier-wiki-page'
let dragging: number | null = null

interface TreeProps {
  parentId: number | null
  childrenOf: Map<number | null, PageSummary[]>
  byId: Map<number, PageSummary>
  expanded: Set<number>
  toggle: (id: number) => void
  expand: (id: number) => void
  activeId: number | null
  onNavigate: () => void
  depth: number
}

function isDescendant(byId: Map<number, PageSummary>, id: number, ancestor: number): boolean {
  let current = byId.get(id)?.parentId ?? null
  const guard = new Set<number>()
  while (current !== null && !guard.has(current)) {
    if (current === ancestor) return true
    guard.add(current)
    current = byId.get(current)?.parentId ?? null
  }
  return false
}

function TreeLevel(props: TreeProps) {
  const list = props.childrenOf.get(props.parentId) ?? []
  return (
    <ul className="tree" role={props.depth === 0 ? 'tree' : 'group'} aria-labelledby={props.depth === 0 ? 'tree-label' : undefined}>
      {list.map((page) => (
        <TreeNode key={page.id} page={page} {...props} />
      ))}
    </ul>
  )
}

function TreeNode({ page, ...props }: TreeProps & { page: PageSummary }) {
  const { toast } = useUi()
  const kids = props.childrenOf.get(page.id) ?? []
  const open = props.expanded.has(page.id)
  const [drop, setDrop] = useState<DropZone | null>(null)
  const [isDragging, setDragging] = useState(false)
  const href = pagePath(page)

  const zone = (e: DragEvent<HTMLDivElement>): DropZone => {
    const rect = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - rect.top) / rect.height
    return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside'
  }

  const canDrop = () => dragging !== null && dragging !== page.id && !isDescendant(props.byId, page.id, dragging)

  const onDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const where = drop ?? zone(e)
    setDrop(null)
    const id = dragging
    dragging = null
    if (id === null || id === page.id || isDescendant(props.byId, page.id, id)) return
    let parentId: number | null
    let index: number | undefined
    if (where === 'inside') {
      parentId = page.id
      props.expand(page.id)
    } else {
      parentId = page.parentId
      const siblings = (props.childrenOf.get(page.parentId) ?? []).filter((p) => p.id !== id)
      index = siblings.findIndex((p) => p.id === page.id) + (where === 'after' ? 1 : 0)
    }
    try {
      await api.movePage(id, { parentId, index })
      invalidate('tree', 'page', 'home')
    } catch (error) {
      toast((error as Error).message, { tone: 'danger' })
    }
  }

  return (
    <li role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={props.activeId === page.id}>
      <div
        className="tree-row"
        data-active={props.activeId === page.id}
        data-drop={drop ?? undefined}
        data-dragging={isDragging || undefined}
        draggable
        onDragStart={(e) => {
          dragging = page.id
          setDragging(true)
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData(DRAG_TYPE, String(page.id))
          e.dataTransfer.setData('text/plain', page.title)
        }}
        onDragEnd={() => {
          dragging = null
          setDragging(false)
          setDrop(null)
        }}
        onDragOver={(e) => {
          if (!canDrop()) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          const z = zone(e)
          if (z !== drop) setDrop(z)
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={onDrop}
      >
        <button
          type="button"
          className={`tree-toggle${kids.length ? '' : ' tree-toggle--leaf'}`}
          aria-expanded={open}
          aria-label={open ? `Replier ${page.title}` : `Déplier ${page.title}`}
          tabIndex={kids.length ? 0 : -1}
          onClick={() => props.toggle(page.id)}
        >
          <ChevronRight aria-hidden />
        </button>
        <a
          className="tree-link"
          href={href}
          aria-current={props.activeId === page.id ? 'page' : undefined}
          onClick={(e) => {
            onLinkClick(e, href)
            props.onNavigate()
          }}
        >
          <span className="tree-icon" aria-hidden>
            {page.icon || <FileText />}
          </span>
          <span className="tree-link__title">{page.title}</span>
        </a>
        <a
          className="btn btn--ghost btn--icon btn--sm tree-add"
          href={`/nouvelle?espace=${page.spaceId}&parent=${page.id}`}
          title="Ajouter une sous-page"
          aria-label={`Ajouter une sous-page à ${page.title}`}
          onClick={(e) => {
            onLinkClick(e, `/nouvelle?espace=${page.spaceId}&parent=${page.id}`)
            props.onNavigate()
          }}
        >
          <Plus />
        </a>
      </div>
      {kids.length > 0 && open && <TreeLevel {...props} parentId={page.id} depth={props.depth + 1} />}
    </li>
  )
}
