// « Exemples de la suite » : une histoire fictive suivie d'une app à l'autre. Ici, son espace et ses pages reliées :
// parcours de l'exemple, bilans mensuels (chiffres des relevés convertis par Convert), procédures.
// Une seule logique (`useSuiteExamples`), deux habillages : la fenêtre ouverte depuis le pied de la barre latérale
// (`SuiteExamplesDialog`) et la carte de l'accueil d'un wiki sans page (`SuiteExamples`).

import { BookOpen, Route as RouteIcon, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { api, pagePath, type ExempleHistoire } from '../lib/api.ts'
import { invalidateAll, useAsync } from '../lib/data.ts'
import { examplesStatus, pickHistoire, routeInSpace, spaceAfterRemoval, type ExamplesStatus } from '../lib/exemples.ts'
import { navigate, useRoute } from '../lib/router.ts'
import { ErrorNotice, useUi } from './ui.tsx'
import { useWiki } from './WikiContext.tsx'

/** Icône des exemples : un parcours. Jamais le livre ouvert, qui est la marque du Wiki. */
export const ExamplesIcon = RouteIcon

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
const LEAD =
  'Des histoires fictives qui traversent toute la suite Atelier : ce que Convert, Tab, Viz, Trésorerie, Nexus et Projets ont produit se retrouve ici, dans des pages reliées.'

function remembered(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

interface SuiteExamplesState {
  status: ExamplesStatus
  error: Error | null
  reload: () => void
  histoires: ExempleHistoire[]
  /** Histoire affichée (absente tant que la liste n'est pas là). */
  h: ExempleHistoire | undefined
  busy: boolean
  choose: (id: string) => void
  open: () => Promise<void>
  remove: () => Promise<void>
  /** Bouton principal : reçoit le focus quand « Retirer » disparaît après un retrait. */
  primary: RefObject<HTMLButtonElement | null>
  /** Dernier résultat, pour la fenêtre : sous une fenêtre modale, un message flottant est grisé et n'est pas annoncé. */
  message: { text: string; tone: 'info' | 'danger' } | null
}

/**
 * Liste des histoires, choix mémorisé, chargement et retrait : tout ce que les deux habillages partagent.
 * `inline` (fenêtre) : les résultats s'affichent dans la fenêtre (`message`) au lieu d'un message flottant.
 */
function useSuiteExamples({ onOpened, inline = false }: { onOpened?: () => void; inline?: boolean } = {}): SuiteExamplesState {
  const [version, setVersion] = useState(0)
  const list = useAsync(() => api.exemples(), [version])
  const [selected, setSelected] = useState<string | null>(remembered)
  const [busy, setBusy] = useState(false)
  const { toast, confirm } = useUi()
  const { spaces, titles, currentSpace, setCurrentSpaceId } = useWiki()
  const route = useRoute()
  const primary = useRef<HTMLButtonElement>(null)
  const focusPrimary = useRef(false)
  const [message, setMessage] = useState<SuiteExamplesState['message']>(null)
  const say = (text: string, tone: 'info' | 'danger' = 'info') => (inline ? setMessage({ text, tone }) : toast(text, { tone }))
  const fail = (e: unknown) => say(e instanceof Error ? e.message : String(e), 'danger')
  const histoires: ExempleHistoire[] = list.data ?? []
  const h = pickHistoire(histoires, selected)

  // Après un retrait, « Retirer » (qui avait le focus) n'existe plus : le focus passe au bouton principal.
  const charge = h?.charge
  useEffect(() => {
    if (!focusPrimary.current || charge !== false) return
    focusPrimary.current = false
    primary.current?.focus()
  }, [charge])

  const choose = (id: string) => {
    setSelected(id)
    setMessage(null)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // stockage indisponible : le choix n'est simplement pas gardé
    }
  }

  const open = async () => {
    if (!h) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await api.loadExemple(h.id)
      invalidateAll()
      if (!res.dejaCharge) toast(`Exemple « ${h.titre} » chargé.`)
      if (res.pageId !== null) navigate(pagePath({ id: res.pageId }))
      onOpened?.()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
      setVersion((v) => v + 1)
    }
  }

  const remove = async () => {
    if (!h) return
    const ok = await confirm({
      title: `Retirer l’exemple « ${h.titre} » ?`,
      text: `L’espace « ${h.espace} » et ses ${h.pages} pages seront supprimés définitivement.`,
      confirmLabel: 'Retirer',
      danger: true,
    })
    if (!ok) return
    // La vue ouverte montre peut-être une page de cet espace : elle n'aura plus rien à afficher.
    const leave = h.spaceId !== null && routeInSpace(route, h.spaceId, { spaces, titles })
    const nextSpace = spaceAfterRemoval(spaces, currentSpace?.id ?? null, h.spaceId)
    setBusy(true)
    setMessage(null)
    try {
      await api.removeExemple(h.id)
      focusPrimary.current = true
      if (nextSpace !== null) setCurrentSpaceId(nextSpace)
      invalidateAll()
      if (leave) navigate('/')
      say(`Exemple « ${h.titre} » retiré.`)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
      setVersion((v) => v + 1)
    }
  }

  return { status: examplesStatus(list), error: list.error, reload: list.reload, histoires, h, busy, choose, open, remove, primary, message }
}

function StorySelect({ ex, id, className }: { ex: SuiteExamplesState; id?: string; className: string }) {
  return (
    <select id={id} className={className} value={ex.h?.id} onChange={(e) => ex.choose(e.target.value)} aria-label={id ? undefined : 'Histoire d’exemple'}>
      {ex.histoires.map((x) => (
        <option key={x.id} value={x.id}>
          {x.secteur} · {x.titre}
        </option>
      ))}
    </select>
  )
}

/** L'histoire choisie : résumé, parcours dans la suite, ce qui se passe dans le Wiki. */
function Story({ h }: { h: ExempleHistoire }) {
  const current = h.parcours.find((e) => e.app === 'wiki')
  return (
    <>
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
    </>
  )
}

/** Boutons de l'histoire. Le principal est à droite dans la fenêtre (à la fin), à gauche sur l'accueil (`primaryFirst`). */
function StoryActions({ ex, h, primaryFirst = false }: { ex: SuiteExamplesState; h: ExempleHistoire; primaryFirst?: boolean }) {
  const primary = (
    <button ref={ex.primary} type="button" className="btn btn--primary" disabled={ex.busy} onClick={() => void ex.open()}>
      <BookOpen aria-hidden /> {h.charge ? 'Ouvrir l’exemple' : 'Charger l’exemple'}
    </button>
  )
  return (
    <>
      {primaryFirst && primary}
      {h.charge && (
        <button type="button" className="btn" disabled={ex.busy} onClick={() => void ex.remove()}>
          <Trash2 aria-hidden /> Retirer
        </button>
      )}
      {!primaryFirst && primary}
    </>
  )
}

const meta = (h: ExempleHistoire) => `Espace « ${h.espace} » · ${h.pages} pages`

/** Carte de l'accueil (wiki sans page). Rien tant que la liste n'est pas là, ou si aucune histoire n'est livrée. */
export function SuiteExamples() {
  const ex = useSuiteExamples()
  const { h } = ex
  if (!h) return null

  return (
    <section className="examples" aria-labelledby="examples-title">
      <div className="examples__head">
        <div>
          <h2 id="examples-title" className="section__title examples__title">
            <ExamplesIcon width={14} height={14} aria-hidden /> Exemples de la suite
          </h2>
          <p className="examples__lead">{LEAD}</p>
        </div>
        <StorySelect ex={ex} className="field examples__select" />
      </div>
      <Story h={h} />
      <div className="examples__actions">
        <StoryActions ex={ex} h={h} primaryFirst />
        <span className="examples__meta">{meta(h)}</span>
      </div>
    </section>
  )
}

/**
 * Fenêtre « Exemples de la suite », ouverte depuis le pied de la barre latérale. Fenêtre modale native : le focus y
 * reste, Échap la ferme ; à la fermeture, l'appelant rend le focus au bouton qui l'a ouverte (`onClose`).
 * Ouvrir un exemple mène à sa page et ferme la fenêtre ; en retirer un la laisse ouverte, sur l'état à jour.
 */
export function SuiteExamplesDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const close = () => {
    ref.current?.close()
    onClose()
  }
  const ex = useSuiteExamples({ onOpened: close, inline: true })
  const { h } = ex

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      className="dialog examples-dialog"
      aria-labelledby="examples-dialog-title"
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
    >
      <div className="dialog__body">
        <h2 id="examples-dialog-title" className="dialog__title examples-dialog__title">
          <ExamplesIcon aria-hidden /> Exemples de la suite
        </h2>
        <p className="dialog__text">{LEAD}</p>
        {ex.status === 'loading' && (
          <p className="dialog__text" role="status">
            Chargement des exemples…
          </p>
        )}
        {ex.status === 'error' && ex.error && <ErrorNotice error={ex.error} onRetry={ex.reload} />}
        {ex.status === 'empty' && <p className="dialog__text">Aucun exemple n’est livré avec cette installation.</p>}
        {h && (
          <>
            <div className="form-row">
              <label className="label" htmlFor="examples-story">
                Histoire
              </label>
              <StorySelect ex={ex} id="examples-story" className="field" />
            </div>
            <Story h={h} />
            {/* Dans le corps, jamais dans la rangée des boutons : avec ce texte, « Fermer », « Retirer » et le bouton principal ne tenaient plus sur une ligne. */}
            <p className="examples__meta examples-dialog__meta">{meta(h)}</p>
          </>
        )}
        {/* Zone toujours présente : son contenu est annoncé quand il change. */}
        <div role={ex.message?.tone === 'danger' ? 'alert' : 'status'}>
          {ex.message && <p className={`examples-dialog__message${ex.message.tone === 'danger' ? ' examples-dialog__message--danger' : ''}`}>{ex.message.text}</p>}
        </div>
      </div>
      <div className="dialog__actions examples-dialog__actions">
        <button type="button" className="btn" onClick={close}>
          Fermer
        </button>
        {h && <StoryActions ex={ex} h={h} />}
      </div>
    </dialog>
  )
}
