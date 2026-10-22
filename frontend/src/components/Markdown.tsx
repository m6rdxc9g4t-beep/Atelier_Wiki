// Rendu d'une page : Markdown (GFM) + liens [[…]] résolus, titres ancrés, code copiable, cases à cocher, images agrandissables.
// Aucun HTML brut n'est interprété (react-markdown ignore le HTML par défaut) : une page ne peut pas injecter de script.

import { Check, Copy } from 'lucide-react'
import { isValidElement, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { pagePath } from '../lib/api.ts'
import { headingIds, normalizeTitle, remarkFrenchSpacing, slugify, transformWikiLinks, WIKI_SCHEME } from '../lib/markdown.ts'
import { onLinkClick } from '../lib/router.ts'
import { useWiki } from './WikiContext.tsx'

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

/** Adresses acceptées : celles du rendu par défaut (http, https, mailto, relatives…) et les liens internes wiki:. */
const urlTransform = (url: string) => (url.startsWith(WIKI_SCHEME) ? url : defaultUrlTransform(url))

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLPreElement>(null)
  return (
    <div className="codeblock">
      <pre ref={ref}>{children}</pre>
      <button
        type="button"
        className="btn btn--sm"
        onClick={() => {
          void navigator.clipboard?.writeText(ref.current?.innerText ?? '').then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? 'Copié' : 'Copier'}
      </button>
    </div>
  )
}

interface MarkdownProps {
  content: string
  /** Espace où créer une page manquante (lien [[…]] vers un titre qui n'existe pas). */
  spaceId?: number | null
  /** Cases à cocher actives : reçoit l'index de la case cliquée. */
  onToggleTask?: (index: number) => void
  /** Aperçu de l'éditeur : liens et cases sans effet de navigation. */
  preview?: boolean
}

export function Markdown({ content, spaceId, onToggleTask, preview }: MarkdownProps) {
  const { titleIndex } = useWiki()
  const [zoom, setZoom] = useState<string | null>(null)
  const source = useMemo(() => transformWikiLinks(content), [content])

  // Compteurs remis à zéro à chaque rendu : identifiants des titres, index des cases à cocher.
  const nextId = headingIds()
  let taskIndex = 0

  const heading = (Tag: 'h1' | 'h2' | 'h3' | 'h4') =>
    function Heading({ children }: { children?: ReactNode }) {
      const id = nextId(textOf(children))
      return (
        <Tag id={id}>
          {children}
          {!preview && (
            <a className="anchor" href={`#${id}`} aria-label="Lien vers cette section">
              #
            </a>
          )}
        </Tag>
      )
    }

  const components: Components = {
    h1: heading('h1'),
    h2: heading('h2'),
    h3: heading('h3'),
    h4: heading('h4'),
    a({ href = '', children }) {
      if (href.startsWith(WIKI_SCHEME)) {
        const title = decodeURIComponent(href.slice(WIKI_SCHEME.length))
        const target = titleIndex.get(normalizeTitle(title))
        if (target) {
          const to = pagePath({ id: target.id, slug: slugify(target.title, 'page') })
          return (
            <a href={to} className="wikilink" onClick={(e) => (preview ? e.preventDefault() : onLinkClick(e, to))}>
              {children}
            </a>
          )
        }
        const params = new URLSearchParams({ titre: title })
        if (spaceId) params.set('espace', String(spaceId))
        const to = `/nouvelle?${params}`
        return (
          <a href={to} className="wikilink wikilink--missing" title={`« ${title} » n’existe pas encore : clique pour la créer`} onClick={(e) => (preview ? e.preventDefault() : onLinkClick(e, to))}>
            {children}
          </a>
        )
      }
      if (href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/api/')) {
        return (
          <a href={href} onClick={(e) => (preview ? e.preventDefault() : onLinkClick(e, href))}>
            {children}
          </a>
        )
      }
      if (href.startsWith('#')) return <a href={href}>{children}</a>
      return (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      )
    },
    pre({ children }) {
      return <CodeBlock>{children}</CodeBlock>
    },
    table({ children }) {
      return (
        <div className="table-wrap">
          <table>{children}</table>
        </div>
      )
    },
    img({ src, alt }) {
      if (typeof src !== 'string' || !src) return null
      return <img src={src} alt={alt ?? ''} loading="lazy" decoding="async" onClick={() => !preview && setZoom(src)} />
    },
    input({ type, checked, disabled: _disabled, ...rest }) {
      if (type !== 'checkbox') return <input type={type} {...rest} />
      const index = taskIndex++
      const interactive = Boolean(onToggleTask) && !preview
      return (
        <input
          type="checkbox"
          checked={Boolean(checked)}
          disabled={!interactive}
          aria-label={checked ? 'Tâche faite : décocher' : 'Tâche à faire : cocher'}
          onChange={() => onToggleTask?.(index)}
        />
      )
    },
  }

  return (
    <>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkFrenchSpacing]} components={components} urlTransform={urlTransform}>
        {source}
      </ReactMarkdown>
      {zoom && (
        <div className="lightbox" role="dialog" aria-label="Image agrandie" onClick={() => setZoom(null)} onKeyDown={(e) => e.key === 'Escape' && setZoom(null)} tabIndex={-1} ref={(el) => el?.focus()}>
          <img src={zoom} alt="" />
        </div>
      )}
    </>
  )
}

