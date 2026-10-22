// Historique d'une page : chaque version enregistrée, ses changements par rapport à la précédente, retour en arrière.

import { diffLines } from 'diff'
import { RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Markdown } from '../components/Markdown.tsx'
import { ErrorNotice, Skeleton, useUi } from '../components/ui.tsx'
import { api, pagePath } from '../lib/api.ts'
import { invalidateAll, useAsync } from '../lib/data.ts'
import { formatDate, plural, timeAgo } from '../lib/format.ts'
import { navigate, onLinkClick } from '../lib/router.ts'
import { Breadcrumbs } from './PageView.tsx'

type Line = { sign: '+' | '−' | ' '; text: string } | { gap: number }

/** Lignes ajoutées / retirées, avec 3 lignes de contexte autour ; le reste est replié. */
export function diffRows(before: string, after: string, context = 3): Line[] {
  const raw: { sign: '+' | '−' | ' '; text: string }[] = []
  for (const part of diffLines(before, after)) {
    const sign = part.added ? '+' : part.removed ? '−' : ' '
    const lines = part.value.replace(/\n$/, '').split('\n')
    for (const text of lines) raw.push({ sign, text })
  }
  const keep = raw.map(() => false)
  raw.forEach((l, i) => {
    if (l.sign === ' ') return
    for (let j = Math.max(0, i - context); j <= Math.min(raw.length - 1, i + context); j++) keep[j] = true
  })
  const out: Line[] = []
  let hidden = 0
  raw.forEach((l, i) => {
    if (keep[i]) {
      if (hidden) out.push({ gap: hidden })
      hidden = 0
      out.push(l)
    } else hidden++
  })
  if (hidden) out.push({ gap: hidden })
  return out
}

export function HistoryView({ id, version }: { id: number; version: number | null }) {
  const { toast, confirm } = useUi()
  const page = useAsync(() => api.page(id), [id])
  const revisions = useAsync(() => api.revisions(id), [id])
  const list = revisions.data ?? []
  const selected = version ?? list[0]?.version ?? null
  const previous = list.find((r) => selected !== null && r.version < selected)?.version ?? null

  const current = useAsync(() => (selected ? api.revision(id, selected) : Promise.resolve(null)), [id, selected])
  const before = useAsync(() => (previous ? api.revision(id, previous) : Promise.resolve(null)), [id, previous])
  const [view, setView] = useState<'diff' | 'text'>('diff')

  const rows = useMemo(() => (current.data ? diffRows(before.data?.content ?? '', current.data.content) : []), [current.data, before.data])

  if (page.error) return <ErrorNotice error={page.error} onRetry={page.reload} />
  if (!page.data || !revisions.data) return <Skeleton />
  const p = page.data
  const latest = list[0]?.version
  const select = (v: number) => navigate(`${pagePath(p)}/historique?v=${v}`, { replace: true })

  const restore = async () => {
    if (!selected) return
    const ok = await confirm({
      title: `Revenir à la version ${selected} ?`,
      text: `La page reprend le titre et le texte de la version ${selected}. Rien n’est perdu : cela crée une nouvelle version, la ${(latest ?? 0) + 1}.`,
      confirmLabel: 'Revenir à cette version',
    })
    if (!ok) return
    try {
      const saved = await api.restoreRevision(p.id, selected)
      invalidateAll()
      toast(`Version ${selected} rétablie.`)
      navigate(pagePath(saved))
    } catch (error) {
      toast((error as Error).message, { tone: 'danger' })
    }
  }

  const titleChanged = before.data && current.data && before.data.title !== current.data.title

  return (
    <div>
      <header className="page-head">
        <div className="page-head__text">
          <Breadcrumbs page={p} />
          <h1 className="page-title">Historique de « {p.title} »</h1>
          <p className="page-meta">{plural(list.length, 'version enregistrée', 'versions enregistrées')}. Chaque enregistrement garde une copie complète de la page.</p>
        </div>
        <div className="toolbar">
          <a className="btn" href={pagePath(p)} onClick={(e) => onLinkClick(e, pagePath(p))}>
            Retour à la page
          </a>
        </div>
      </header>

      <div className="history">
        <ol className="history__list" aria-label="Versions">
          {list.map((r) => (
            <li key={r.version}>
              <button type="button" className="history__item" aria-current={r.version === selected} onClick={() => select(r.version)}>
                <strong>
                  Version {r.version}
                  {r.version === latest ? ' (actuelle)' : ''}
                </strong>
                <span title={formatDate(r.createdAt)}>
                  {r.author}, {timeAgo(r.createdAt)}
                </span>
                {r.summary && <span>{r.summary}</span>}
              </button>
            </li>
          ))}
        </ol>

        <section aria-live="polite" style={{ minWidth: 0 }}>
          <div className="toolbar" style={{ marginBottom: '1rem', justifyContent: 'space-between' }}>
            <div className="segmented" role="group" aria-label="Affichage de la version">
              <button type="button" aria-pressed={view === 'diff'} onClick={() => setView('diff')}>
                Changements
              </button>
              <button type="button" aria-pressed={view === 'text'} onClick={() => setView('text')}>
                Texte de la version
              </button>
            </div>
            {selected !== null && selected !== latest && (
              <button type="button" className="btn" onClick={restore}>
                <RotateCcw aria-hidden /> Revenir à cette version
              </button>
            )}
          </div>

          {current.error ? (
            <ErrorNotice error={current.error} onRetry={current.reload} />
          ) : !current.data || current.data.version !== selected ? (
            <Skeleton lines={8} />
          ) : view === 'text' ? (
            <div className="prose" style={{ maxWidth: 'var(--measure)' }}>
              <h1 style={{ marginTop: 0 }}>
                {current.data.icon} {current.data.title}
              </h1>
              <Markdown content={current.data.content} spaceId={p.spaceId} preview />
            </div>
          ) : (
            <>
              <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
                {previous ? `Par rapport à la version ${previous}.` : 'Première version : tout le texte est nouveau.'}
                {titleChanged && ` Titre : « ${before.data!.title} » devient « ${current.data.title} ».`}
              </p>
              {rows.length === 0 || rows.every((r) => 'gap' in r) ? (
                <div className="empty-page">Le texte n’a pas changé dans cette version.</div>
              ) : (
                <div className="diff" role="table" aria-label="Changements">
                  {rows.map((r, i) =>
                    'gap' in r ? (
                      <div key={i} className="diff__gap">
                        {plural(r.gap, 'ligne inchangée', 'lignes inchangées')}
                      </div>
                    ) : (
                      <div key={i} className="diff__line" data-sign={r.sign} role="row">
                        <span role="cell">{r.text || ' '}</span>
                      </div>
                    ),
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
