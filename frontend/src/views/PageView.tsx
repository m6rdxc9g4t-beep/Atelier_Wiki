// Lecture d'une page : fil d'Ariane, titre, texte, sous-pages, liens entrants, fichiers, table des matières.

import {
  ChevronRight,
  Download,
  FilePlus2,
  FileText,
  FolderInput,
  History,
  Link2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Markdown } from '../components/Markdown.tsx'
import { rememberVisit } from '../components/CommandPalette.tsx'
import { MoveDialog } from '../components/MoveDialog.tsx'
import { ErrorNotice, Skeleton, useDismiss, useUi } from '../components/ui.tsx'
import { useWiki } from '../components/WikiContext.tsx'
import { api, ApiError, pagePath, type PageDetail } from '../lib/api.ts'
import { invalidate, invalidateAll, useAsync, useTopic } from '../lib/data.ts'
import { formatDate, formatSize, plural, timeAgo } from '../lib/format.ts'
import { extractHeadings, toggleTask } from '../lib/markdown.ts'
import { navigate, onLinkClick } from '../lib/router.ts'

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))
}

export function PageView({ id }: { id: number }) {
  const version = useTopic('page')
  const page = useAsync(() => api.page(id), [id, version])
  const { setCurrentSpaceId } = useWiki()

  const data = page.data?.id === id ? page.data : undefined

  useEffect(() => {
    if (!data || data.deletedAt) return
    setCurrentSpaceId(data.spaceId)
    rememberVisit(data)
    document.title = `${data.title} — Atelier Wiki`
  }, [data, setCurrentSpaceId])

  if (page.error && !data) {
    const gone = page.error instanceof ApiError && page.error.status === 404
    return (
      <div style={{ maxWidth: 'var(--measure)' }}>
        {gone ? (
          <div className="empty-page">
            <p style={{ margin: '0 0 0.8rem' }}>Cette page n’existe pas ou a été supprimée définitivement.</p>
            <a className="btn" href="/" onClick={(e) => onLinkClick(e, '/')}>
              Revenir à l’accueil
            </a>
          </div>
        ) : (
          <ErrorNotice error={page.error} onRetry={page.reload} />
        )}
      </div>
    )
  }
  if (!data) return <Skeleton />
  return <PageBody page={data} setPage={page.setData} />
}

function PageBody({ page, setPage }: { page: PageDetail; setPage: (p: PageDetail) => void }) {
  const { toast, confirm } = useUi()
  const [moving, setMoving] = useState(false)
  const headings = useMemo(() => extractHeadings(page.content), [page.content])
  const editPath = `${pagePath(page)}/modifier`

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || page.deletedAt) return
      if (e.key === 'e') {
        e.preventDefault()
        navigate(editPath)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editPath, page.deletedAt])

  const toggleTaskAt = useCallback(
    async (index: number) => {
      const content = toggleTask(page.content, index)
      if (content === page.content) return
      setPage({ ...page, content })
      try {
        const saved = await api.updatePage(page.id, { content, baseVersion: page.version, summary: 'Case cochée' })
        setPage(saved)
        invalidate('home')
      } catch (error) {
        toast((error as Error).message, { tone: 'danger' })
        invalidate('page')
      }
    },
    [page, setPage, toast],
  )

  const togglePin = async () => {
    try {
      setPage(await api.pin(page.id, !page.pinned))
      invalidate('home')
      toast(page.pinned ? 'Page désépinglée de l’accueil.' : 'Page épinglée sur l’accueil.')
    } catch (error) {
      toast((error as Error).message, { tone: 'danger' })
    }
  }

  const trash = async () => {
    const extra = page.children.length ? ` Ses ${plural(page.children.length, 'sous-page part', 'sous-pages partent')} avec elle.` : ''
    const ok = await confirm({
      title: `Mettre « ${page.title} » à la corbeille ?`,
      text: `Tu pourras la restaurer depuis la corbeille pendant 30 jours.${extra}`,
      confirmLabel: 'Mettre à la corbeille',
      danger: true,
    })
    if (!ok) return
    try {
      await api.trashPage(page.id)
      invalidateAll()
      const parent = page.breadcrumbs[page.breadcrumbs.length - 1]
      navigate(parent ? pagePath(parent) : `/espace/${page.space.slug}`)
      toast(`« ${page.title} » est dans la corbeille.`, {
        action: {
          label: 'Annuler',
          run: () =>
            void api.restoreTrash(page.id).then(() => {
              invalidateAll()
              navigate(pagePath(page))
            }),
        },
      })
    } catch (error) {
      toast((error as Error).message, { tone: 'danger' })
    }
  }

  const copyLink = () => {
    void navigator.clipboard?.writeText(`${location.origin}${pagePath(page)}`).then(() => toast('Lien copié.'))
  }

  if (page.deletedAt) return <TrashedPage page={page} />

  return (
    <div className="page-grid">
      <article style={{ minWidth: 0 }}>
        <header className="page-head page-head--stack">
          <div className="page-head__top">
            <Breadcrumbs page={page} />
            <div className="toolbar">
              <a className="btn btn--primary" href={editPath} onClick={(e) => onLinkClick(e, editPath)} aria-keyshortcuts="E" title="Modifier (E)">
                <Pencil aria-hidden /> Modifier
              </a>
              <a
                className="btn btn--icon"
                href={`/nouvelle?espace=${page.spaceId}&parent=${page.id}`}
                onClick={(e) => onLinkClick(e, `/nouvelle?espace=${page.spaceId}&parent=${page.id}`)}
                title="Ajouter une sous-page"
                aria-label="Ajouter une sous-page"
              >
                <FilePlus2 />
              </a>
              <button type="button" className="btn btn--icon" onClick={togglePin} aria-pressed={page.pinned} title={page.pinned ? 'Désépingler de l’accueil' : 'Épingler sur l’accueil'} aria-label={page.pinned ? 'Désépingler de l’accueil' : 'Épingler sur l’accueil'}>
                {page.pinned ? <PinOff /> : <Pin />}
              </button>
              <MoreMenu
                items={[
                  { icon: <History aria-hidden />, label: 'Historique', run: () => navigate(`${pagePath(page)}/historique`) },
                  { icon: <FolderInput aria-hidden />, label: 'Déplacer…', run: () => setMoving(true) },
                  { icon: <Link2 aria-hidden />, label: 'Copier le lien', run: copyLink },
                  { icon: <Download aria-hidden />, label: 'Exporter en Markdown', run: () => (location.href = `/api/pages/${page.id}/export`) },
                  { icon: <Trash2 aria-hidden />, label: 'Mettre à la corbeille…', run: trash, danger: true },
                ]}
              />
            </div>
          </div>
          <h1 className="page-title">
            {page.icon && <span className="page-title__icon" aria-hidden>{page.icon}</span>}
            <span>{page.title}</span>
          </h1>
          <p className="page-meta">
            Modifiée {timeAgo(page.updatedAt)} par {page.updatedBy}.{' '}
            <a href={`${pagePath(page)}/historique`} onClick={(e) => onLinkClick(e, `${pagePath(page)}/historique`)} title={formatDate(page.updatedAt)}>
              {plural(page.version, 'version', 'versions')}
            </a>
          </p>
        </header>

        {page.content.trim() ? (
          <div className="prose">
            <Markdown content={page.content} spaceId={page.spaceId} onToggleTask={toggleTaskAt} />
          </div>
        ) : (
          <div className="empty-page">
            Cette page est vide.{' '}
            <a href={editPath} onClick={(e) => onLinkClick(e, editPath)}>
              Écris son contenu
            </a>{' '}
            (touche <kbd>E</kbd>).
          </div>
        )}

        {page.children.length > 0 && (
          <section className="section" aria-labelledby="children-title">
            <h2 id="children-title" className="section__title">
              Sous-pages
            </h2>
            <ul className="row-list">
              {page.children.map((c) => (
                <li key={c.id}>
                  <a className="row-link" href={pagePath(c)} onClick={(e) => onLinkClick(e, pagePath(c))}>
                    <span className="row-link__icon" aria-hidden>
                      {c.icon || <FileText />}
                    </span>
                    <span className="row-link__body">
                      <span className="row-link__title">{c.title}</span>
                      {c.excerpt && <span className="row-link__text">{c.excerpt}</span>}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {page.backlinks.length > 0 && (
          <section className="section" aria-labelledby="backlinks-title">
            <h2 id="backlinks-title" className="section__title">
              Pages qui citent celle-ci
            </h2>
            <ul className="row-list">
              {page.backlinks.map((b) => (
                <li key={b.id}>
                  <a className="row-link" href={pagePath(b)} onClick={(e) => onLinkClick(e, pagePath(b))}>
                    <span className="row-link__icon" aria-hidden>
                      {b.icon || <Link2 />}
                    </span>
                    <span className="row-link__body">
                      <span className="row-link__title">{b.title}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Attachments pageId={page.id} version={page.version} />
      </article>

      <aside className="toc" aria-label="Sur cette page">
        {headings.length > 1 && <Toc headings={headings} />}
        <div className="toc__aside muted">
          <span>Créée {timeAgo(page.createdAt)} par {page.createdBy}.</span>
          <span>Espace {page.space.name}.</span>
        </div>
      </aside>

      {moving && (
        <MoveDialog
          page={page}
          onClose={() => setMoving(false)}
          onMoved={(moved) => {
            setMoving(false)
            setPage(moved)
            invalidateAll()
            toast('Page déplacée.')
          }}
        />
      )}
    </div>
  )
}

export function Breadcrumbs({ page }: { page: PageDetail }) {
  const spaceHref = `/espace/${page.space.slug}`
  return (
    <nav aria-label="Fil d’Ariane">
      <ol className="crumbs">
        <li>
          <a href={spaceHref} onClick={(e) => onLinkClick(e, spaceHref)}>
            {page.space.icon} {page.space.name}
          </a>
        </li>
        {page.breadcrumbs.map((b) => (
          <li key={b.id} style={{ display: 'contents' }}>
            <ChevronRight aria-hidden />
            <a href={pagePath(b)} onClick={(e) => onLinkClick(e, pagePath(b))}>
              {b.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

function Toc({ headings }: { headings: { level: number; text: string; id: string }[] }) {
  const [active, setActive] = useState<string | null>(null)
  const top = Math.min(...headings.map((h) => h.level))

  useEffect(() => {
    const elements = headings.map((h) => document.getElementById(h.id)).filter((el): el is HTMLElement => el !== null)
    if (!elements.length || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-64px 0px -65% 0px' },
    )
    elements.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [headings])

  return (
    <>
      <p className="toc__title">Sur cette page</p>
      <ol>
        {headings.map((h) => (
          <li key={h.id} data-level={Math.min(4, h.level - top + 2)}>
            <a href={`#${h.id}`} data-active={active === h.id}>
              {h.text}
            </a>
          </li>
        ))}
      </ol>
    </>
  )
}

function Attachments({ pageId, version }: { pageId: number; version: number }) {
  const files = useAsync(() => api.attachments(pageId), [pageId, version])
  const list = (files.data ?? []).filter((f) => !f.isImage)
  if (!list.length) return null
  return (
    <section className="section" aria-labelledby="files-title">
      <h2 id="files-title" className="section__title">
        Fichiers joints
      </h2>
      <ul className="row-list">
        {list.map((f) => (
          <li key={f.id}>
            <a className="row-link" href={f.url} target="_blank" rel="noreferrer">
              <span className="row-link__icon" aria-hidden>
                <Paperclip />
              </span>
              <span className="row-link__body">
                <span className="row-link__title">{f.name}</span>
              </span>
              <span className="row-link__side">{formatSize(f.size)}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

function TrashedPage({ page }: { page: PageDetail }) {
  const { toast } = useUi()
  return (
    <div style={{ maxWidth: 'var(--measure)' }}>
      <h1 className="page-title">{page.title}</h1>
      <div className="empty-page" style={{ marginTop: '1.2rem' }}>
        <p style={{ margin: '0 0 0.8rem' }}>Cette page est dans la corbeille.</p>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            try {
              await api.restoreTrash(page.id)
              invalidateAll()
              toast('Page restaurée.')
            } catch (error) {
              toast((error as Error).message, { tone: 'danger' })
              navigate('/corbeille')
            }
          }}
        >
          <RotateCcw aria-hidden /> Restaurer
        </button>
      </div>
    </div>
  )
}

interface MenuEntry {
  icon: React.ReactNode
  label: string
  run: () => void
  danger?: boolean
}

export function MoreMenu({ items }: { items: MenuEntry[] }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = useCallback((restore: boolean) => {
    setOpen(false)
    if (restore) trigger.current?.focus()
  }, [])
  useDismiss(open, close, root)
  return (
    <div style={{ position: 'relative' }} ref={root}>
      <button ref={trigger} type="button" className="btn btn--icon" aria-label="Plus d’actions" title="Plus d’actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal />
      </button>
      {open && (
        <div role="menu" className="popover" style={{ top: 'calc(100% + 6px)', right: 0, minWidth: 220 }}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="menu-item"
              style={item.danger ? { color: 'var(--danger)' } : undefined}
              onClick={() => {
                close(false)
                item.run()
              }}
            >
              {item.icon}
              <span className="menu-item__body">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
