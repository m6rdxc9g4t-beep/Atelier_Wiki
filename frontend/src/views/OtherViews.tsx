// Accueil, espace, résultats de recherche, corbeille.

import { FilePlus2, FileText, Pin, RotateCcw, Search, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Highlight } from '../components/CommandPalette.tsx'
import { MOD_KEY } from '../components/Header.tsx'
import { ErrorNotice, Skeleton, useUi } from '../components/ui.tsx'
import { useWiki } from '../components/WikiContext.tsx'
import { api, pagePath, type PageSummary } from '../lib/api.ts'
import { invalidateAll, useAsync, useTopic } from '../lib/data.ts'
import { formatDate, plural, timeAgo } from '../lib/format.ts'
import { navigate, onLinkClick } from '../lib/router.ts'

function PageRow({ page, text, side }: { page: PageSummary; text?: React.ReactNode; side?: React.ReactNode }) {
  const to = pagePath(page)
  return (
    <li>
      <a className="row-link" href={to} onClick={(e) => onLinkClick(e, to)}>
        <span className="row-link__icon" aria-hidden>
          {page.icon || <FileText />}
        </span>
        <span className="row-link__body">
          <span className="row-link__title">{page.title}</span>
          {text && <span className="row-link__text">{text}</span>}
        </span>
        {side && <span className="row-link__side">{side}</span>}
      </a>
    </li>
  )
}

export function HomeView() {
  const version = useTopic('home')
  const home = useAsync(() => api.home(), [version])
  const { user, currentSpace } = useWiki()

  useEffect(() => {
    document.title = 'Atelier Wiki'
  }, [])

  if (home.error) return <ErrorNotice error={home.error} onRetry={home.reload} />
  if (!home.data) return <Skeleton />
  const { spaces, pinned, recent } = home.data
  const total = spaces.reduce((n, s) => n + s.pageCount, 0)
  const newHref = currentSpace ? `/nouvelle?espace=${currentSpace.id}` : '/nouvelle'

  return (
    <div className="home">
      <div className="page-head" style={{ alignItems: 'flex-end' }}>
        <div className="page-head__text">
          <h1 className="home__title">{user ? `Bonjour ${user}` : 'Le wiki de la suite'}</h1>
          <p className="home__lead">
            {total === 0
              ? 'Le wiki est vide. Écris la première page : une procédure, une note technique, un compte rendu.'
              : `${plural(total, 'page', 'pages')} dans ${plural(spaces.length, 'espace', 'espaces')}. Cherche avec ${MOD_KEY} K, écris avec N.`}
          </p>
        </div>
        <a className="btn btn--primary" href={newHref} onClick={(e) => onLinkClick(e, newHref)}>
          <FilePlus2 aria-hidden /> Nouvelle page
        </a>
      </div>

      <div className="home__grid" style={{ marginTop: 0 }}>
        <section aria-labelledby="recent-title">
          <h2 id="recent-title" className="section__title">
            Modifiées récemment
          </h2>
          {recent.length ? (
            <ul className="row-list">
              {recent.map((p) => (
                <PageRow key={p.id} page={p} text={p.excerpt || <em>Page vide</em>} side={<span title={formatDate(p.updatedAt)}>{timeAgo(p.updatedAt)}</span>} />
              ))}
            </ul>
          ) : (
            <div className="empty-page">Aucune page pour l’instant.</div>
          )}
        </section>

        <div>
          {pinned.length > 0 && (
            <section aria-labelledby="pinned-title" style={{ marginBottom: '2.2rem' }}>
              <h2 id="pinned-title" className="section__title">
                <Pin width={13} height={13} aria-hidden style={{ verticalAlign: -1 }} /> Épinglées
              </h2>
              <ul className="row-list">
                {pinned.map((p) => (
                  <PageRow key={p.id} page={p} side={p.spaceName} />
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="spaces-title">
            <h2 id="spaces-title" className="section__title">
              Espaces
            </h2>
            <ul className="space-list">
              {spaces.map((s) => (
                <li key={s.id}>
                  <a className="space-tile" href={`/espace/${s.slug}`} onClick={(e) => onLinkClick(e, `/espace/${s.slug}`)}>
                    <span className="space-picker__icon" aria-hidden>
                      {s.icon || '📁'}
                    </span>
                    <span className="space-tile__body">
                      <span className="space-tile__name">{s.name}</span>
                      <span className="space-tile__meta" style={{ display: 'block' }}>
                        {s.description || plural(s.pageCount, 'page', 'pages')}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

export function SpaceView({ slug }: { slug: string }) {
  const { spaces, spacesLoaded, setCurrentSpaceId } = useWiki()
  const space = spaces.find((s) => s.slug === slug)
  const treeVersion = useTopic('tree')
  const tree = useAsync(() => (space ? api.tree(space.id) : Promise.resolve([] as PageSummary[])), [space?.id, treeVersion])
  const { toast } = useUi()
  const [editing, setEditing] = useState(false)
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (!space) return
    setCurrentSpaceId(space.id)
    document.title = `${space.name} — Atelier Wiki`
  }, [space, setCurrentSpaceId])

  if (!spacesLoaded) return <Skeleton />
  if (!space) return <NotFoundView />
  const top = (tree.data ?? []).filter((p) => p.parentId === null)
  const newHref = `/nouvelle?espace=${space.id}`

  return (
    <div style={{ maxWidth: 'var(--measure)' }}>
      <header className="page-head">
        <div className="page-head__text">
          <h1 className="page-title">
            <span className="page-title__icon" aria-hidden>
              {space.icon || '📁'}
            </span>
            <span>{space.name}</span>
          </h1>
          {editing ? (
            <form
              style={{ marginTop: '0.8rem', display: 'flex', gap: '0.5rem' }}
              onSubmit={async (e) => {
                e.preventDefault()
                try {
                  await api.updateSpace(space.id, { description })
                  invalidateAll()
                  setEditing(false)
                } catch (error) {
                  toast((error as Error).message, { tone: 'danger' })
                }
              }}
            >
              <input className="field" autoFocus value={description} onChange={(e) => setDescription(e.target.value)} placeholder="À quoi sert cet espace ?" maxLength={500} aria-label="Description de l’espace" />
              <button type="submit" className="btn btn--primary">
                Enregistrer
              </button>
              <button type="button" className="btn" onClick={() => setEditing(false)}>
                Annuler
              </button>
            </form>
          ) : (
            <p className="page-meta">
              {space.description || 'Pas encore de description.'}{' '}
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  setDescription(space.description)
                  setEditing(true)
                }}
              >
                {space.description ? 'Modifier' : 'Ajouter une description'}
              </button>
            </p>
          )}
        </div>
        <a className="btn btn--primary" href={newHref} onClick={(e) => onLinkClick(e, newHref)}>
          <FilePlus2 aria-hidden /> Nouvelle page
        </a>
      </header>
      {tree.error && <ErrorNotice error={tree.error} onRetry={tree.reload} />}
      {top.length ? (
        <ul className="row-list">
          {top.map((p) => (
            <PageRow key={p.id} page={p} side={<span title={formatDate(p.updatedAt)}>{timeAgo(p.updatedAt)}</span>} />
          ))}
        </ul>
      ) : (
        !tree.loading && (
          <div className="empty-page">
            Cet espace est vide.{' '}
            <a href={newHref} onClick={(e) => onLinkClick(e, newHref)}>
              Écris sa première page
            </a>
            .
          </div>
        )
      )}
    </div>
  )
}

export function SearchView({ q }: { q: string }) {
  const [value, setValue] = useState(q)
  const results = useAsync(() => (q.trim() ? api.search(q, 50) : Promise.resolve([])), [q])
  useEffect(() => {
    setValue(q)
    document.title = q ? `« ${q} » — Recherche — Atelier Wiki` : 'Recherche — Atelier Wiki'
  }, [q])
  const hits = results.data ?? []

  return (
    <div style={{ maxWidth: 'var(--measure)' }}>
      <form
        role="search"
        className="page-head"
        style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}
        onSubmit={(e) => {
          e.preventDefault()
          navigate(`/recherche?q=${encodeURIComponent(value.trim())}`, { replace: true })
        }}
      >
        <input className="field" style={{ height: 42, fontSize: 16 }} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Chercher dans le wiki" aria-label="Chercher dans le wiki" autoFocus />
        <button type="submit" className="btn btn--primary" style={{ height: 42 }}>
          <Search aria-hidden /> Chercher
        </button>
      </form>
      {results.error && <ErrorNotice error={results.error} onRetry={results.reload} />}
      {q.trim() && results.data && (
        <p className="muted" style={{ fontSize: 13.5, marginTop: 0 }}>
          {hits.length ? `${plural(hits.length, 'page trouvée', 'pages trouvées')} pour « ${q} ».` : `Aucune page ne contient « ${q} ». Essaie un autre mot, ou crée la page.`}
        </p>
      )}
      {hits.length > 0 && (
        <ul className="row-list">
          {hits.map((h) => (
            <PageRow key={h.id} page={{ ...h, parentId: null, position: 0, pinned: false, version: 0, updatedBy: '' }} text={<Highlight text={h.snippet} />} side={h.spaceName} />
          ))}
        </ul>
      )}
      {q.trim() && results.data && !hits.length && (
        <a className="btn" href={`/nouvelle?titre=${encodeURIComponent(q)}`} onClick={(e) => onLinkClick(e, `/nouvelle?titre=${encodeURIComponent(q)}`)}>
          <FilePlus2 aria-hidden /> Créer la page « {q} »
        </a>
      )}
    </div>
  )
}

export function TrashView() {
  const version = useTopic('trash')
  const trash = useAsync(() => api.trash(), [version])
  const { toast, confirm } = useUi()

  useEffect(() => {
    document.title = 'Corbeille — Atelier Wiki'
  }, [])

  if (trash.error) return <ErrorNotice error={trash.error} onRetry={trash.reload} />
  if (!trash.data) return <Skeleton />
  const { entries, days } = trash.data

  const restore = async (id: number, title: string) => {
    try {
      const page = await api.restoreTrash(id)
      invalidateAll()
      toast(`« ${title} » est restaurée.`, { action: { label: 'Ouvrir', run: () => navigate(pagePath(page)) } })
    } catch (error) {
      toast((error as Error).message, { tone: 'danger' })
    }
  }

  const purge = async (id: number, title: string, pages: number) => {
    const ok = await confirm({
      title: `Supprimer définitivement « ${title} » ?`,
      text: `${pages > 1 ? `Elle et ses ${pages - 1} sous-page(s) seront effacées` : 'Elle sera effacée'}, historique compris. Impossible de revenir en arrière.`,
      confirmLabel: 'Supprimer définitivement',
      danger: true,
    })
    if (!ok) return
    try {
      await api.purgeTrash(id)
      invalidateAll()
    } catch (error) {
      toast((error as Error).message, { tone: 'danger' })
    }
  }

  return (
    <div style={{ maxWidth: 'var(--measure)' }}>
      <header className="page-head">
        <div className="page-head__text">
          <h1 className="page-title">Corbeille</h1>
          <p className="page-meta">Les pages supprimées y restent {days} jours, avec leurs sous-pages et leur historique, puis sont effacées.</p>
        </div>
      </header>
      {entries.length === 0 ? (
        <div className="empty-page">La corbeille est vide.</div>
      ) : (
        <ul className="row-list">
          {entries.map((t) => (
            <li key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.4rem' }}>
              <span className="row-link__icon" aria-hidden>
                {t.icon || <Trash2 width={16} height={16} />}
              </span>
              <span className="row-link__body">
                <span className="row-link__title">{t.title}</span>
                <span className="row-link__text">
                  {t.spaceName}, supprimée {timeAgo(t.deletedAt)} par {t.deletedBy}
                  {t.pages > 1 ? `, avec ${plural(t.pages - 1, 'sous-page', 'sous-pages')}` : ''}.
                </span>
              </span>
              <button type="button" className="btn btn--sm" onClick={() => restore(t.id, t.title)}>
                <RotateCcw aria-hidden /> Restaurer
              </button>
              <button type="button" className="btn btn--sm btn--danger" onClick={() => purge(t.id, t.title, t.pages)}>
                Supprimer
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function NotFoundView() {
  return (
    <div className="empty-page" style={{ maxWidth: 'var(--measure)' }}>
      <p style={{ margin: '0 0 0.8rem' }}>Cette adresse ne mène à aucune page du wiki.</p>
      <a className="btn" href="/" onClick={(e) => onLinkClick(e, '/')}>
        Revenir à l’accueil
      </a>
    </div>
  )
}
