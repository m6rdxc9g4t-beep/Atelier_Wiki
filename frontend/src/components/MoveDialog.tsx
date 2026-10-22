// Déplacer une page (et ses sous-pages) : espace et page parente. Équivalent clavier du glisser-déposer de l'arbre.

import { useEffect, useMemo, useRef, useState } from 'react'

import { api, type PageDetail, type PageSummary } from '../lib/api.ts'
import { useAsync } from '../lib/data.ts'
import { useWiki } from './WikiContext.tsx'

function descendants(pages: PageSummary[], id: number): Set<number> {
  const out = new Set<number>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const p of pages) {
      if (p.parentId !== null && out.has(p.parentId) && !out.has(p.id)) {
        out.add(p.id)
        grew = true
      }
    }
  }
  return out
}

/** Pages d'un espace dans l'ordre de l'arbre, avec leur profondeur (pour la liste déroulante). */
function flatten(pages: PageSummary[]): { page: PageSummary; depth: number }[] {
  const children = new Map<number | null, PageSummary[]>()
  for (const p of pages) children.set(p.parentId, [...(children.get(p.parentId) ?? []), p])
  const out: { page: PageSummary; depth: number }[] = []
  const walk = (parent: number | null, depth: number) => {
    for (const p of (children.get(parent) ?? []).sort((a, b) => a.position - b.position)) {
      out.push({ page: p, depth })
      walk(p.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

export function MoveDialog({ page, onClose, onMoved }: { page: PageDetail; onClose: () => void; onMoved: (p: PageDetail) => void }) {
  const { spaces } = useWiki()
  const ref = useRef<HTMLDialogElement>(null)
  const [spaceId, setSpaceId] = useState(page.spaceId)
  const [parentId, setParentId] = useState<number | null>(page.parentId)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tree = useAsync(() => api.tree(spaceId), [spaceId])

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  const options = useMemo(() => {
    const pages = tree.data ?? []
    const excluded = spaceId === page.spaceId ? descendants(pages, page.id) : new Set<number>()
    return flatten(pages).filter((o) => !excluded.has(o.page.id))
  }, [tree.data, spaceId, page.id, page.spaceId])

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      onMoved(await api.movePage(page.id, { spaceId, parentId }))
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} className="dialog" onCancel={onClose} onClose={onClose} aria-labelledby="move-title">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="dialog__body">
          <h2 id="move-title" className="dialog__title">
            Déplacer « {page.title} »
          </h2>
          <p className="dialog__text">Ses sous-pages la suivent.</p>
          <div className="form-row">
            <label className="label" htmlFor="move-space">
              Espace
            </label>
            <select
              id="move-space"
              className="field"
              value={spaceId}
              onChange={(e) => {
                setSpaceId(Number(e.target.value))
                setParentId(null)
              }}
            >
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.icon} {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label className="label" htmlFor="move-parent">
              Ranger sous
            </label>
            <select id="move-parent" className="field" value={parentId ?? ''} onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Racine de l’espace</option>
              {options.map(({ page: p, depth }) => (
                <option key={p.id} value={p.id}>
                  {' '.repeat(depth)}
                  {p.title}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p className="dialog__text" role="alert" style={{ color: 'var(--danger)', marginTop: '0.8rem' }}>
              {error}
            </p>
          )}
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            Déplacer
          </button>
        </div>
      </form>
    </dialog>
  )
}
