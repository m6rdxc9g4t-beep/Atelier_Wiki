// « Exemples de la suite » : une histoire fictive suivie d'une app à l'autre. Ici, son espace et ses pages reliées :
// parcours de l'exemple, bilans mensuels (chiffres des relevés convertis par Convert), procédures.

import { BookOpen, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { api, pagePath, type ExempleHistoire } from '../lib/api.ts'
import { invalidateAll, useAsync } from '../lib/data.ts'
import { navigate } from '../lib/router.ts'
import { useUi } from './ui.tsx'

const APPS: Record<string, string> = {
  convert: 'Convert',
  tab: 'Tab',
  viz: 'Viz',
  tresorerie: 'Trésorerie',
  nexus: 'Nexus',
  projets: 'Projets',
  wiki: 'Wiki',
}
/** Histoire choisie, mémorisée sur l'appareil (clé commune aux apps de la suite servies depuis la même origine). */
const STORAGE_KEY = 'atelier:exemple'

function remembered(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function SuiteExamples() {
  const [version, setVersion] = useState(0)
  const list = useAsync(() => api.exemples(), [version])
  const [selected, setSelected] = useState<string | null>(remembered)
  const [busy, setBusy] = useState(false)
  const { toast, confirm } = useUi()
  const histoires: ExempleHistoire[] = list.data ?? []
  const h = histoires.find((x) => x.id === selected) ?? histoires[0]
  if (!h) return null
  const current = h.parcours.find((e) => e.app === 'wiki')

  const choose = (id: string) => {
    setSelected(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // stockage indisponible : le choix n'est simplement pas gardé
    }
  }

  const open = async () => {
    setBusy(true)
    try {
      const res = await api.loadExemple(h.id)
      invalidateAll()
      if (!res.dejaCharge) toast(`Exemple « ${h.titre} » chargé.`)
      if (res.pageId !== null) navigate(pagePath({ id: res.pageId }))
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: 'danger' })
    } finally {
      setBusy(false)
      setVersion((v) => v + 1)
    }
  }

  const remove = async () => {
    const ok = await confirm({
      title: `Retirer l’exemple « ${h.titre} » ?`,
      text: `L’espace « ${h.espace} » et ses ${h.pages} pages seront supprimés définitivement.`,
      confirmLabel: 'Retirer',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await api.removeExemple(h.id)
      invalidateAll()
      toast('Exemple retiré.')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: 'danger' })
    } finally {
      setBusy(false)
      setVersion((v) => v + 1)
    }
  }

  return (
    <section className="examples" aria-labelledby="examples-title">
      <div className="examples__head">
        <div>
          <h2 id="examples-title" className="section__title examples__title">
            <BookOpen width={14} height={14} aria-hidden /> Exemples de la suite
          </h2>
          <p className="examples__lead">
            Des histoires fictives qui traversent toute la suite Atelier : ce que Convert, Tab, Viz, Trésorerie, Nexus et Projets ont produit se retrouve ici, dans des pages reliées.
          </p>
        </div>
        <select className="field examples__select" value={h.id} onChange={(e) => choose(e.target.value)} aria-label="Histoire d’exemple">
          {histoires.map((x) => (
            <option key={x.id} value={x.id}>
              {x.secteur} · {x.titre}
            </option>
          ))}
        </select>
      </div>
      <p className="examples__name">
        {h.titre} <span className="muted">— {h.sous_titre}</span>
      </p>
      <p className="examples__text">{h.resume}</p>
      <ol className="examples__steps" aria-label="Parcours de l’histoire dans la suite">
        {h.parcours.map((e, i) => (
          <li key={e.app} title={e.texte} className={e.app === 'wiki' ? 'examples__step examples__step--current' : 'examples__step'} aria-current={e.app === 'wiki' ? 'step' : undefined}>
            <span className="examples__num">{i + 1}</span>
            {APPS[e.app] ?? e.app}
          </li>
        ))}
      </ol>
      {current && <p className="examples__now">{current.texte}</p>}
      <div className="examples__actions">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void open()}>
          <BookOpen aria-hidden /> {h.charge ? 'Ouvrir l’exemple' : 'Charger l’exemple'}
        </button>
        {h.charge && (
          <button type="button" className="btn" disabled={busy} onClick={() => void remove()}>
            <Trash2 aria-hidden /> Retirer
          </button>
        )}
        <span className="examples__meta">
          Espace « {h.espace} » · {h.pages} pages
        </span>
      </div>
    </section>
  )
}
