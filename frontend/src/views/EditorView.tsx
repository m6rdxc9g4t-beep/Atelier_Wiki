// Écriture d'une page (nouvelle ou existante) : Markdown à gauche, aperçu à droite.
// Brouillon gardé sur l'appareil à chaque frappe ; conflit détecté si quelqu'un a enregistré entre-temps.

import {
  Bold,
  Code,
  Columns2,
  Eye,
  Heading2,
  ImagePlus,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Table,
  TriangleAlert,
  FileText,
  PenLine,
  BookMarked,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'

import { Markdown } from '../components/Markdown.tsx'
import { ErrorNotice, Skeleton, useUi } from '../components/ui.tsx'
import { useWiki } from '../components/WikiContext.tsx'
import { MOD_KEY } from '../components/Header.tsx'
import { api, ApiError, pagePath, type PageDetail, type TitleEntry } from '../lib/api.ts'
import { invalidate, useAsync } from '../lib/data.ts'
import { timeAgo } from '../lib/format.ts'
import { normalizeTitle, openWikiLink } from '../lib/markdown.ts'
import { navigate, onLinkClick, setLeaveGuard } from '../lib/router.ts'
import { caretPosition, continueList, insertText, prefixLines, wrap } from '../lib/textarea.ts'

type Mode = 'write' | 'split' | 'preview'
const MODE_KEY = 'atelier-wiki:editor-mode'

interface Draft {
  title: string
  icon: string
  content: string
  baseVersion: number | null
  savedAt: string
}

const draftKey = (id: number | null) => `atelier-wiki:draft:${id ?? 'nouvelle'}`

function readDraft(id: number | null): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(id))
    return raw ? (JSON.parse(raw) as Draft) : null
  } catch {
    return null
  }
}

function clearDraft(id: number | null) {
  try {
    localStorage.removeItem(draftKey(id))
  } catch {
    /* rien */
  }
}

// ── Entrées : édition d'une page existante ou création ──────────────────────

export function EditPageView({ id }: { id: number }) {
  const page = useAsync(() => api.page(id), [id])
  if (page.error) return <ErrorNotice error={page.error} onRetry={page.reload} />
  if (!page.data || page.data.id !== id) return <Skeleton />
  if (page.data.deletedAt) return <ErrorNotice error={new Error('Cette page est dans la corbeille : restaure-la pour la modifier.')} />
  return <Editor key={`${id}`} page={page.data} spaceId={page.data.spaceId} parentId={page.data.parentId} initialTitle={page.data.title} />
}

export function NewPageView({ spaceId, parentId, title }: { spaceId: number | null; parentId: number | null; title: string }) {
  const { currentSpace, spacesLoaded } = useWiki()
  const space = spaceId ?? currentSpace?.id ?? null
  if (!spacesLoaded) return <Skeleton />
  if (space === null) return <ErrorNotice error={new Error('Aucun espace : crée d’abord un espace depuis la barre latérale.')} />
  return <Editor key={`new-${space}-${parentId}-${title}`} page={null} spaceId={space} parentId={parentId} initialTitle={title} />
}

// ── Éditeur ─────────────────────────────────────────────────────────────────

interface EditorProps {
  page: PageDetail | null
  spaceId: number
  parentId: number | null
  initialTitle: string
}

function Editor({ page, spaceId, parentId, initialTitle }: EditorProps) {
  const { toast } = useUi()
  const { titles, spaces, setCurrentSpaceId } = useWiki()
  const pageId = page?.id ?? null
  const [title, setTitle] = useState(page?.title ?? initialTitle)
  const [icon, setIcon] = useState(page?.icon ?? '')
  const [content, setContent] = useState(page?.content ?? '')
  const [summary, setSummary] = useState('')
  const [baseVersion, setBaseVersion] = useState<number | null>(page?.version ?? null)
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const m = localStorage.getItem(MODE_KEY)
      return m === 'write' || m === 'preview' || m === 'split' ? m : 'split'
    } catch {
      return 'split'
    }
  })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [conflict, setConflict] = useState<PageDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [found, setFound] = useState<Draft | null>(() => {
    const d = readDraft(pageId)
    if (!d) return null
    const same = d.title === (page?.title ?? initialTitle) && d.content === (page?.content ?? '') && d.icon === (page?.icon ?? '')
    return same ? null : d
  })
  const area = useRef<HTMLTextAreaElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)

  const dirty = title !== (page?.title ?? initialTitle) || content !== (page?.content ?? '') || icon !== (page?.icon ?? '')
  const space = spaces.find((s) => s.id === spaceId)

  useEffect(() => setCurrentSpaceId(spaceId), [spaceId, setCurrentSpaceId])
  useEffect(() => {
    document.title = `${page ? `Modifier « ${page.title} »` : 'Nouvelle page'} — Atelier Wiki`
    ;(page || initialTitle ? area : titleInput).current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Brouillon local à chaque modification (sauf tant qu'un brouillon retrouvé attend une décision).
  useEffect(() => {
    if (found) return
    const timer = setTimeout(() => {
      try {
        if (dirty) localStorage.setItem(draftKey(pageId), JSON.stringify({ title, icon, content, baseVersion, savedAt: new Date().toISOString() } satisfies Draft))
        else clearDraft(pageId)
      } catch {
        /* stockage plein ou indisponible */
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [title, icon, content, baseVersion, dirty, pageId, found])

  // Quitter avec des modifications non enregistrées : confirmation.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  useEffect(() => {
    setLeaveGuard(() => !dirtyRef.current || window.confirm('Quitter sans enregistrer ? Ton brouillon reste sur cet appareil.'))
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      setLeaveGuard(null)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [])

  const leave = (to: string) => {
    setLeaveGuard(null)
    navigate(to)
  }

  const save = useCallback(
    async (overrideVersion?: number) => {
      if (saving) return
      if (!title.trim()) {
        setError('Donne un titre à la page.')
        titleInput.current?.focus()
        return
      }
      setSaving(true)
      setError(null)
      try {
        const saved = page
          ? await api.updatePage(page.id, { title, icon, content, baseVersion: overrideVersion ?? baseVersion ?? page.version, summary: summary || undefined })
          : await api.createPage({ spaceId, parentId, title, icon, content })
        clearDraft(pageId)
        dirtyRef.current = false
        invalidate('tree', 'titles', 'home', 'page', 'spaces')
        toast(page ? 'Page enregistrée.' : 'Page créée.')
        leave(pagePath(saved))
      } catch (err) {
        if (err instanceof ApiError && err.code === 'CONFLICT' && err.body.current) {
          setConflict(err.body.current as PageDetail)
        } else {
          setError((err as Error).message)
        }
        setSaving(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saving, title, icon, content, baseVersion, summary, page, spaceId, parentId, pageId],
  )

  const cancel = () => {
    if (dirty && !window.confirm('Abandonner tes modifications ?')) return
    clearDraft(pageId)
    dirtyRef.current = false
    leave(page ? pagePath(page) : parentId ? `/p/${parentId}` : '/')
  }

  // ── Fichiers : coller, glisser, ou bouton ──
  const upload = async (files: File[]) => {
    for (const file of files) {
      setUploading((n) => n + 1)
      try {
        const att = await api.upload(file, pageId)
        const label = att.name.replace(/[[\]]/g, '')
        const md = att.isImage ? `![${label.replace(/\.[a-z0-9]+$/i, '')}](${att.url})` : `[📎 ${label}](${att.url})`
        if (area.current) insertText(area.current, md)
        else setContent((c) => `${c}\n${md}`)
      } catch (err) {
        toast((err as Error).message, { tone: 'danger' })
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files]
    if (files.length) {
      e.preventDefault()
      void upload(files)
    }
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    setDragOver(false)
    const files = [...e.dataTransfer.files]
    if (!files.length) return
    e.preventDefault()
    area.current?.focus()
    void upload(files)
  }

  // ── Suggestions [[…]] ──
  const [suggest, setSuggest] = useState<{ query: string; top: number; left: number } | null>(null)
  const [suggestIndex, setSuggestIndex] = useState(0)
  const suggestions = useMemo<TitleEntry[]>(() => {
    if (!suggest) return []
    const q = normalizeTitle(suggest.query)
    return titles
      .filter((t) => t.id !== pageId && normalizeTitle(t.title).includes(q))
      .sort((a, b) => Number(normalizeTitle(b.title).startsWith(q)) - Number(normalizeTitle(a.title).startsWith(q)))
      .slice(0, 8)
  }, [suggest, titles, pageId])

  const updateSuggest = () => {
    const el = area.current
    if (!el || el.selectionStart !== el.selectionEnd) return setSuggest(null)
    const query = openWikiLink(el.value.slice(0, el.selectionStart))
    if (query === null) return setSuggest(null)
    const pos = caretPosition(el)
    // Près du bas du champ, la liste s'ouvre au-dessus du curseur.
    const above = pos.top > el.clientHeight - 280
    setSuggest({ query, top: above ? Math.max(4, pos.top - 24 - 270) : pos.top + 4, left: Math.min(pos.left + 12, el.clientWidth - 310) })
    setSuggestIndex(0)
  }

  const pickSuggestion = (t: TitleEntry | { title: string }) => {
    const el = area.current
    if (!el || !suggest) return
    el.setSelectionRange(el.selectionStart - suggest.query.length, el.selectionStart)
    // Ferme le lien s'il ne l'est pas déjà.
    const closed = el.value.slice(el.selectionEnd, el.selectionEnd + 2) === ']]'
    insertText(el, closed ? t.title : `${t.title}]]`)
    if (closed) el.setSelectionRange(el.selectionStart + 2, el.selectionStart + 2)
    setSuggest(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    if (suggest && (suggestions.length || suggest.query)) {
      const total = suggestions.length
      if (e.key === 'ArrowDown' && total) {
        e.preventDefault()
        return setSuggestIndex((i) => (i + 1) % total)
      }
      if (e.key === 'ArrowUp' && total) {
        e.preventDefault()
        return setSuggestIndex((i) => (i - 1 + total) % total)
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && (suggestions[suggestIndex] || suggest.query)) {
        e.preventDefault()
        return pickSuggestion(suggestions[suggestIndex] ?? { title: suggest.query })
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        return setSuggest(null)
      }
    }
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      wrap(el, '**', '**', 'texte en gras')
    } else if (mod && e.key.toLowerCase() === 'i') {
      e.preventDefault()
      wrap(el, '*', '*', 'texte en italique')
    } else if (e.key === 'Enter' && !mod && !e.shiftKey && continueList(el)) {
      e.preventDefault()
    } else if (e.key === 'Tab' && !mod) {
      e.preventDefault()
      if (e.shiftKey) prefixLines(el, '  ')
      else if (el.selectionStart === el.selectionEnd) insertText(el, '  ')
      else prefixLines(el, '  ')
    }
  }

  // Raccourcis de la page : ⌘S / ⌘Entrée enregistrent, Échap annule.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && (e.key.toLowerCase() === 's' || e.key === 'Enter')) {
        e.preventDefault()
        void save()
      } else if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]')) {
        cancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const tool = (label: string, iconNode: ReactNode, run: (el: HTMLTextAreaElement) => void, shortcut?: string) => (
    <button
      type="button"
      className="btn btn--ghost btn--icon btn--sm"
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => area.current && run(area.current)}
      disabled={mode === 'preview'}
    >
      {iconNode}
    </button>
  )

  const setModePersist = (m: Mode) => {
    setMode(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      /* rien */
    }
  }

  const fileInput = useRef<HTMLInputElement>(null)
  const status = saving
    ? 'Enregistrement…'
    : uploading
      ? 'Envoi du fichier…'
      : dirty
        ? 'Modifications non enregistrées (brouillon gardé sur cet appareil)'
        : page
          ? `Version ${page.version}, aucune modification`
          : `Nouvelle page dans ${space?.name ?? 'l’espace'}`

  return (
    <div className="editor">
      <div className="editor__bar">
        <span className="editor__status" role="status">
          {status}
        </span>
        <button type="button" className="btn" onClick={cancel}>
          Annuler
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={saving || (!dirty && Boolean(page))} title={`Enregistrer (${MOD_KEY} S)`}>
          {page ? 'Enregistrer' : 'Créer la page'}
        </button>
      </div>

      {found && (
        <div className="notice notice--warning" style={{ marginBottom: '0.9rem' }}>
          <TriangleAlert aria-hidden />
          <div style={{ flex: 1 }}>
            Un brouillon non enregistré de cette page existe sur cet appareil ({timeAgo(found.savedAt)}).
            {page && found.baseVersion !== null && found.baseVersion !== page.version && ' La page a changé depuis : vérifie avant d’enregistrer.'}
          </div>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              setTitle(found.title)
              setIcon(found.icon)
              setContent(found.content)
              if (found.baseVersion !== null) setBaseVersion(found.baseVersion)
              setFound(null)
            }}
          >
            Reprendre le brouillon
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => {
              clearDraft(pageId)
              setFound(null)
            }}
          >
            Ignorer
          </button>
        </div>
      )}

      {conflict && (
        <div className="notice notice--danger" role="alert" style={{ marginBottom: '0.9rem' }}>
          <TriangleAlert aria-hidden />
          <div style={{ flex: 1 }}>
            {conflict.updatedBy} a enregistré cette page {timeAgo(conflict.updatedAt)} (version {conflict.version}) pendant que tu la modifiais.
          </div>
          <a className="btn btn--sm" href={pagePath(conflict)} target="_blank" rel="noreferrer">
            Voir sa version
          </a>
          <button
            type="button"
            className="btn btn--sm btn--danger"
            onClick={() => {
              setBaseVersion(conflict.version)
              setConflict(null)
              void save(conflict.version)
            }}
          >
            Remplacer par la mienne
          </button>
        </div>
      )}

      {error && (
        <div className="notice notice--danger" role="alert" style={{ marginBottom: '0.9rem' }}>
          <TriangleAlert aria-hidden />
          <div style={{ flex: 1 }}>{error}</div>
        </div>
      )}

      <div className="editor__title">
        <input
          className="icon-input"
          value={icon}
          onChange={(e) => setIcon([...e.target.value].slice(-2).join(''))}
          placeholder="🙂"
          aria-label="Icône de la page (un émoji)"
          title="Icône de la page : tape ou colle un émoji"
        />
        <input
          ref={titleInput}
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Titre de la page"
          aria-label="Titre de la page"
          maxLength={200}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              area.current?.focus()
            }
          }}
        />
      </div>

      <div className="editor__tools" role="toolbar" aria-label="Mise en forme">
        {tool('Gras', <Bold />, (el) => wrap(el, '**', '**', 'texte en gras'), `${MOD_KEY} B`)}
        {tool('Italique', <Italic />, (el) => wrap(el, '*', '*', 'texte en italique'), `${MOD_KEY} I`)}
        {tool('Titre de section', <Heading2 />, (el) => prefixLines(el, '## '))}
        <span className="sep" />
        {tool('Liste à puces', <List />, (el) => prefixLines(el, '- '))}
        {tool('Liste numérotée', <ListOrdered />, (el) => prefixLines(el, (i) => `${i + 1}. `))}
        {tool('Cases à cocher', <ListChecks />, (el) => prefixLines(el, '- [ ] '))}
        {tool('Citation', <Quote />, (el) => prefixLines(el, '> '))}
        <span className="sep" />
        {tool('Lien vers une page du wiki', <BookMarked />, (el) => {
          wrap(el, '[[', ']]', 'Titre de la page')
          requestAnimationFrame(updateSuggest)
        })}
        {tool('Lien externe', <Link />, (el) => {
          const selected = el.value.slice(el.selectionStart, el.selectionEnd) || 'texte du lien'
          insertText(el, `[${selected}](https://)`, [selected.length + 3, selected.length + 11])
        })}
        {tool('Code', <Code />, (el) => {
          const selected = el.value.slice(el.selectionStart, el.selectionEnd)
          if (selected.includes('\n')) wrap(el, '```\n', '\n```', '')
          else wrap(el, '`', '`', 'code')
        })}
        {tool('Tableau', <Table />, (el) =>
          insertText(el, `${el.selectionStart > 0 && el.value[el.selectionStart - 1] !== '\n' ? '\n\n' : ''}| Colonne | Colonne |\n|---|---|\n| | |\n`),
        )}
        {tool('Image ou fichier', <ImagePlus />, () => fileInput.current?.click())}
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void upload([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
        <span className="push" />
        <div className="segmented" role="group" aria-label="Affichage">
          <button type="button" aria-pressed={mode === 'write'} onClick={() => setModePersist('write')} title="Texte seul">
            <PenLine width={14} height={14} aria-hidden /> Écrire
          </button>
          <button type="button" aria-pressed={mode === 'split'} onClick={() => setModePersist('split')} title="Texte et aperçu côte à côte">
            <Columns2 width={14} height={14} aria-hidden /> Côte à côte
          </button>
          <button type="button" aria-pressed={mode === 'preview'} onClick={() => setModePersist('preview')} title="Aperçu seul">
            <Eye width={14} height={14} aria-hidden /> Aperçu
          </button>
        </div>
      </div>

      <div
        className="editor__panes"
        data-mode={mode}
        data-dragover={dragOver || undefined}
        onDragOver={(e) => {
          if ([...e.dataTransfer.types].includes('Files')) {
            e.preventDefault()
            setDragOver(true)
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
        }}
        onDrop={onDrop}
      >
        <textarea
          ref={area}
          className="editor__source"
          value={content}
          onChange={(e) => {
            setContent(e.target.value)
            updateSuggest()
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && updateSuggest()}
          onClick={updateSuggest}
          onBlur={() => setTimeout(() => setSuggest(null), 120)}
          onPaste={onPaste}
          spellCheck
          lang="fr"
          aria-label="Contenu de la page (Markdown)"
          placeholder={'Écris en Markdown.\n\n## Un titre de section\n- une liste\n[[Une autre page]] pour faire un lien.\n\nColle ou glisse une image ici pour l’ajouter.'}
        />
        {suggest && (
          <div className="suggest" role="listbox" aria-label="Pages du wiki" style={{ top: suggest.top, left: Math.max(8, suggest.left) }}>
            {suggestions.map((t, i) => (
              <div
                key={t.id}
                role="option"
                aria-selected={i === suggestIndex}
                className="menu-item"
                onMouseDown={(e) => {
                  e.preventDefault()
                  pickSuggestion(t)
                }}
              >
                {t.icon ? <span aria-hidden>{t.icon}</span> : <FileText aria-hidden />}
                <span className="menu-item__body">
                  <span className="menu-item__text">{t.title}</span>
                </span>
              </div>
            ))}
            {suggest.query && !suggestions.some((t) => normalizeTitle(t.title) === normalizeTitle(suggest.query)) && (
              <div className="menu-item" role="option" aria-selected={!suggestions.length} onMouseDown={(e) => (e.preventDefault(), pickSuggestion({ title: suggest.query }))}>
                <FileText aria-hidden />
                <span className="menu-item__body">
                  <span className="menu-item__text">Lien vers « {suggest.query} »</span>
                  <span className="menu-item__sub">Page à créer</span>
                </span>
              </div>
            )}
            {!suggest.query && !suggestions.length && <div className="menu-item muted">Tape le titre d’une page…</div>}
          </div>
        )}
        <div className="editor__preview prose" aria-label="Aperçu">
          {content.trim() ? <Markdown content={content} spaceId={spaceId} preview /> : <p className="muted">L’aperçu apparaît ici.</p>}
        </div>
      </div>

      {page && (
        <div className="editor__summary">
          <input
            className="field"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Ce qui a changé (facultatif, visible dans l’historique)"
            aria-label="Résumé de la modification"
            maxLength={200}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void save())}
          />
          <a className="btn btn--ghost btn--sm" href={`${pagePath(page)}/historique`} onClick={(e) => onLinkClick(e, `${pagePath(page)}/historique`)}>
            Historique
          </a>
        </div>
      )}
    </div>
  )
}
