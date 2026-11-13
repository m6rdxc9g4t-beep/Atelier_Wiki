// Schéma Mermaid (bloc ```mermaid d'une page Markdown), chargé à la demande.
// Le schéma est dessiné en SVG puis affiché comme une image (data:) : un SVG dans <img> ne peut exécuter aucun script,
// et il s'agrandit comme les autres images. Libellés en SVG pur (htmlLabels: false) pour qu'ils s'affichent dans <img>.

import { TriangleAlert } from 'lucide-react'
import { useDeferredValue, useEffect, useState } from 'react'

let counter = 0

function resolvedTheme(): 'light' | 'dark' {
  return window.atelierTheme?.resolved() ?? (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
}

function useResolvedTheme() {
  const [theme, setTheme] = useState(resolvedTheme)
  useEffect(() => {
    const onChange = () => setTheme(resolvedTheme())
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    window.addEventListener('atelier-theme', onChange)
    media?.addEventListener('change', onChange)
    return () => {
      window.removeEventListener('atelier-theme', onChange)
      media?.removeEventListener('change', onChange)
    }
  }, [])
  return theme
}

export default function Mermaid({ source, onZoom }: { source: string; onZoom?: (src: string) => void }) {
  const code = useDeferredValue(source)
  const theme = useResolvedTheme()
  const [image, setImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: theme === 'dark' ? 'dark' : 'neutral',
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          htmlLabels: false,
          flowchart: { htmlLabels: false },
        })
        const { svg } = await mermaid.render(`mermaid-${++counter}`, code)
        if (!alive) return
        setImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
        setError(null)
      } catch (err) {
        if (alive) setError((err as Error).message?.split('\n')[0] || 'schéma illisible')
      }
    })()
    return () => {
      alive = false
    }
  }, [code, theme])

  if (error) {
    return (
      <div className="mermaid mermaid--error">
        <p className="notice notice--warning">
          <TriangleAlert aria-hidden />
          <span>Schéma Mermaid illisible : {error}</span>
        </p>
        <pre>
          <code>{source}</code>
        </pre>
      </div>
    )
  }
  if (!image) return <div className="mermaid mermaid--loading" aria-busy="true" />
  return (
    <div className="mermaid">
      <img src={image} alt="Schéma" onClick={() => onZoom?.(image)} />
    </div>
  )
}
