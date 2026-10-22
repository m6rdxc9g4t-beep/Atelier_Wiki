// Recherche rapide (⌘K ou /) : titres instantanés, puis texte intégral des pages ; Entrée ouvre, et on peut créer la page.

import { CornerDownLeft, FilePlus2, FileText, History, Search, TextSearch } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { api, pagePath, type SearchHit, type TitleEntry } from '../lib/api.ts'
import { normalizeTitle, slugify } from '../lib/markdown.ts'
import { navigate } from '../lib/router.ts'
import { useWiki } from './WikiContext.tsx'

const RECENT_KEY = 'atelier-wiki:recent'

/** Pages ouvertes récemment (sur cet appareil), pour la palette vide. */
export function rememberVisit(page: { id: number; title: string; icon: string; spaceId: number }) {
  try {
    const list = (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as TitleEntry[]).filter((p) => p.id !== page.id)
    localStorage.setItem(RECENT_KEY, JSON.stringify([{ id: page.id, title: page.title, icon: page.icon, spaceId: page.spaceId }, ...list].slice(0, 8)))
  } catch {
    /* rien */
  }
}

function recentVisits(titles: TitleEntry[]): TitleEntry[] {
  try {
    const alive = new Map(titles.map((t) => [t.id, t]))
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as TitleEntry[]).map((p) => alive.get(p.id)).filter((p): p is TitleEntry => Boolean(p))
  } catch {
    return []
  }
}

/** Extrait du serveur : passages trouvés entre \u0002 et \u0003 → <mark>. */
export function Highlight({ text }: { text: string }) {
  const parts: ReactNode[] = []
  const re = /\u0002([\s\S]*?)\u0003/g
  let last = 0
  let i = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(<mark key={i++}>{m[1]}</mark>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

interface Item {
  key: string
  icon: ReactNode
  title: ReactNode
  sub?: ReactNode
  run: () => void
}

export function CommandPalette({ initial, onClose }: { initial: string; onClose: () => void }) {
  const { titles, currentSpace, spaces } = useWiki()
  const [q, setQ] = useState(initial)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const spaceName = useMemo(() => new Map(spaces.map((s) => [s.id, s.name])), [spaces])

  useEffect(() => {
    const query = q.trim()
    if (!query) {
      setHits([])
      return
    }
    const timer = setTimeout(() => {
      api.search(query, 8).then(setHits, () => setHits([]))
    }, 140)
    return () => clearTimeout(timer)
  }, [q])

  const go = (to: string) => {
    onClose()
    navigate(to)
  }

  const items = useMemo<Item[]>(() => {
    const query = normalizeTitle(q)
    const open = (t: { id: number; title: string }) => () => go(pagePath({ id: t.id, slug: slugify(t.title, 'page') }))
    if (!query) {
      const recent = recentVisits(titles).map<Item>((t) => ({
        key: `r${t.id}`,
        icon: t.icon ? <span aria-hidden>{t.icon}</span> : <History aria-hidden />,
        title: t.title,
        sub: spaceName.get(t.spaceId),
        run: open(t),
      }))
      return [
        ...recent,
        {
          key: 'new',
          icon: <FilePlus2 aria-hidden />,
          title: 'Nouvelle page',
          sub: currentSpace ? `Dans ${currentSpace.name}` : undefined,
          run: () => go(currentSpace ? `/nouvelle?espace=${currentSpace.id}` : '/nouvelle'),
        },
      ]
    }
    const words = query.split(' ')
    const byTitle = titles
      .filter((t) => {
        const n = normalizeTitle(t.title)
        return words.every((w) => n.includes(w))
      })
      .sort((a, b) => Number(normalizeTitle(b.title).startsWith(query)) - Number(normalizeTitle(a.title).startsWith(query)) || a.title.length - b.title.length)
      .slice(0, 6)
    const seen = new Set(byTitle.map((t) => t.id))
    const out: Item[] = byTitle.map((t) => ({
      key: `t${t.id}`,
      icon: t.icon ? <span aria-hidden>{t.icon}</span> : <FileText aria-hidden />,
      title: t.title,
      sub: spaceName.get(t.spaceId),
      run: open(t),
    }))
    for (const h of hits) {
      if (seen.has(h.id)) continue
      out.push({
        key: `h${h.id}`,
        icon: <TextSearch aria-hidden />,
        title: h.title,
        sub: <Highlight text={h.snippet} />,
        run: open(h),
      })
    }
    out.push({
      key: 'all',
      icon: <Search aria-hidden />,
      title: `Tous les résultats pour « ${q.trim()} »`,
      run: () => go(`/recherche?q=${encodeURIComponent(q.trim())}`),
    })
    if (!titles.some((t) => normalizeTitle(t.title) === query)) {
      const params = new URLSearchParams({ titre: q.trim() })
      if (currentSpace) params.set('espace', String(currentSpace.id))
      out.push({ key: 'create', icon: <FilePlus2 aria-hidden />, title: `Créer la page « ${q.trim()} »`, sub: currentSpace ? `Dans ${currentSpace.name}` : undefined, run: () => go(`/nouvelle?${params}`) })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, titles, hits, currentSpace, spaceName])

  useEffect(() => setSelected(0), [q])
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, items.length - 1))
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey && q.trim()) go(`/recherche?q=${encodeURIComponent(q.trim())}`)
      else items[selected]?.run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="palette" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette__panel" role="dialog" aria-modal="true" aria-label="Rechercher dans le wiki">
        <div className="palette__input">
          <Search aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Titre ou mots du texte…"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[selected] ? `palette-${items[selected]!.key}` : undefined}
            aria-autocomplete="list"
          />
        </div>
        <div className="palette__list" id="palette-list" role="listbox" ref={listRef}>
          {!q.trim() && items.length > 1 && <div className="menu-heading">Ouvertes récemment</div>}
          {items.map((item, i) => (
            <div
              key={item.key}
              id={`palette-${item.key}`}
              role="option"
              aria-selected={i === selected}
              className="menu-item"
              onMouseMove={() => i !== selected && setSelected(i)}
              onClick={item.run}
            >
              {item.icon}
              <span className="menu-item__body">
                <span className="menu-item__text">{item.title}</span>
                {item.sub && <span className="menu-item__sub">{item.sub}</span>}
              </span>
              {i === selected && <CornerDownLeft aria-hidden />}
            </div>
          ))}
        </div>
        <div className="palette__foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> choisir
          </span>
          <span>
            <kbd>Entrée</kbd> ouvrir
          </span>
          <span>
            <kbd>⇧</kbd> <kbd>Entrée</kbd> tous les résultats
          </span>
          <span>
            <kbd>Échap</kbd> fermer
          </span>
        </div>
      </div>
    </div>
  )
}
