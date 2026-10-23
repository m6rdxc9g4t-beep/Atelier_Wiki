// « Rédiger avec l'IA » : consignes → brouillon rédigé par l'IA locale (Ollama) → aperçu → insertion dans l'éditeur.
// Rien n'est enregistré ici : le texte va dans l'éditeur, que l'utilisateur relit puis enregistre comme d'habitude.

import { LoaderCircle, RotateCcw, Sparkles, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { applyDraft, cannotGenerate, defaultMode, draftErrorMessage, draftRequest, elapsedLabel, MAX_INSTRUCTIONS, statusNotice } from '../lib/ai.ts'
import { api, ApiError, isAbort, type AiDraft, type AiDraftMode } from '../lib/api.ts'
import { useAsync } from '../lib/data.ts'
import { MOD_KEY } from './Header.tsx'
import { Markdown } from './Markdown.tsx'

interface Props {
  title: string
  current: string
  spaceId: number
  /** Nouveau texte de l'éditeur (non enregistré). */
  onApply: (content: string) => void
  onClose: () => void
}

type Phase = { kind: 'form' } | { kind: 'loading'; startedAt: number } | { kind: 'result'; draft: AiDraft }

export function AiDraftDialog({ title, current, spaceId, onApply, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const status = useAsync(() => api.aiStatus(), [])
  const hasText = current.trim() !== ''
  const [mode, setMode] = useState<AiDraftMode>(() => defaultMode(current))
  const [instructions, setInstructions] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'form' })
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const controller = useRef<AbortController | null>(null)

  useEffect(() => {
    ref.current?.showModal()
    return () => controller.current?.abort()
  }, [])

  // Temps écoulé pendant la génération (sans GPU, plusieurs minutes possibles).
  useEffect(() => {
    if (phase.kind !== 'loading') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [phase.kind])

  const notice = statusNotice(status.data ?? null, status.error)
  const blocked = Boolean(status.data && (!status.data.available || !status.data.modelInstalled))
  const reason = cannotGenerate(mode, instructions, current)

  const generate = async () => {
    if (reason || blocked || phase.kind === 'loading') return
    const abort = new AbortController()
    controller.current = abort
    setError(null)
    setNow(Date.now())
    setPhase({ kind: 'loading', startedAt: Date.now() })
    try {
      const draft = await api.aiDraft(draftRequest(mode, instructions, title, current), abort.signal)
      setPhase({ kind: 'result', draft })
    } catch (err) {
      if (isAbort(err)) return
      setError(err instanceof ApiError ? draftErrorMessage(err) : (err as Error).message)
      setPhase({ kind: 'form' })
      // Le serveur a peut-être changé d'état (Ollama arrêté, modèle supprimé) : on revérifie.
      if (err instanceof ApiError && (err.code === 'AI_UNAVAILABLE' || err.code === 'AI_MODEL_MISSING')) status.reload()
    } finally {
      if (controller.current === abort) controller.current = null
    }
  }

  const cancelGeneration = () => {
    controller.current?.abort()
    controller.current = null
    setPhase({ kind: 'form' })
  }

  const close = () => {
    controller.current?.abort()
    onClose()
  }

  const apply = (how: 'replace' | 'append') => {
    if (phase.kind !== 'result') return
    onApply(applyDraft(current, phase.draft.markdown, how))
    close()
  }

  return (
    <dialog
      ref={ref}
      className="dialog ai-dialog"
      aria-labelledby="ai-title"
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
      onKeyDown={(e) => {
        // ⌘ Entrée : générer depuis le formulaire (les raccourcis de l'éditeur restent hors de la fenêtre).
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault()
          if (phase.kind === 'form') void generate()
        }
      }}
    >
      <div className="dialog__body">
        <h2 id="ai-title" className="dialog__title ai-dialog__title">
          <Sparkles aria-hidden /> Rédiger avec l’IA
        </h2>

        {phase.kind === 'form' && (
          <>
            {status.loading && !status.data && <p className="dialog__text">Vérification de l’IA locale…</p>}
            {notice && (
              <div className={`notice notice--${notice.tone} ai-dialog__notice`} role="status">
                <TriangleAlert aria-hidden />
                <div className="ai-dialog__notice-text">{notice.text}</div>
                <button type="button" className="btn btn--sm" onClick={status.reload} disabled={status.loading}>
                  Vérifier à nouveau
                </button>
              </div>
            )}

            <div className="form-row">
              <label className="label" htmlFor="ai-instructions">
                Que veux-tu écrire ?
              </label>
              <textarea
                id="ai-instructions"
                className="field"
                rows={5}
                autoFocus
                maxLength={MAX_INSTRUCTIONS}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder={
                  mode === 'rewrite'
                    ? 'Ex. : structure ce texte en sections, ajoute une liste de vérifications à la fin, corrige le style.'
                    : 'Ex. : une procédure pour restaurer une sauvegarde du serveur, avec les prérequis et les étapes.'
                }
              />
              <p className="ai-dialog__hint">
                L’IA tourne sur le serveur de la suite : rien ne part ailleurs. {MOD_KEY} Entrée pour générer.
              </p>
            </div>

            <fieldset className="form-row ai-dialog__modes">
              <legend className="label">Ce que fait l’IA</legend>
              <label className="ai-dialog__mode">
                <input type="radio" name="ai-mode" checked={mode === 'create'} onChange={() => setMode('create')} />
                <span>
                  <strong>Nouvelle rédaction</strong>
                  <span className="muted">Rédige une page à partir de tes consignes{title.trim() ? ' et du titre' : ''}.</span>
                </span>
              </label>
              {hasText && (
                <label className="ai-dialog__mode">
                  <input type="radio" name="ai-mode" checked={mode === 'rewrite'} onChange={() => setMode('rewrite')} />
                  <span>
                    <strong>Retravailler le texte actuel</strong>
                    <span className="muted">Complète, reformule, structure ou résume le texte de l’éditeur.</span>
                  </span>
                </label>
              )}
            </fieldset>

            {error && (
              <div className="notice notice--danger ai-dialog__notice" role="alert">
                <TriangleAlert aria-hidden />
                <div style={{ flex: 1 }}>{error}</div>
              </div>
            )}
          </>
        )}

        {phase.kind === 'loading' && (
          <div className="ai-dialog__wait" role="status" aria-live="polite">
            <LoaderCircle className="ai-dialog__spinner" aria-hidden />
            <div>
              <strong>L’IA rédige… cela peut prendre quelques minutes.</strong>
              <span className="muted">
                Temps écoulé : {elapsedLabel((now - phase.startedAt) / 1000)}. Tu peux annuler à tout moment ; ton texte n’est pas modifié.
              </span>
            </div>
          </div>
        )}

        {phase.kind === 'result' && (
          <>
            <p className="dialog__text">
              Relis le brouillon. Il ira dans l’éditeur, sans être enregistré : tu pourras le corriger avant d’enregistrer la page.
            </p>
            <div className="ai-dialog__preview prose" aria-label="Aperçu du brouillon">
              <Markdown content={phase.draft.markdown} spaceId={spaceId} preview />
            </div>
            <p className="ai-dialog__hint">Rédigé par {phase.draft.model}. Vérifie les faits : l’IA peut se tromper.</p>
          </>
        )}
      </div>

      <div className="dialog__actions ai-dialog__actions">
        {phase.kind === 'form' && (
          <>
            <button type="button" className="btn" onClick={close}>
              Fermer
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void generate()}
              disabled={Boolean(reason) || blocked}
              title={reason ?? (blocked ? 'L’IA locale n’est pas prête.' : undefined)}
            >
              <Sparkles aria-hidden /> Générer
            </button>
          </>
        )}
        {phase.kind === 'loading' && (
          <button type="button" className="btn" onClick={cancelGeneration} autoFocus>
            Annuler
          </button>
        )}
        {phase.kind === 'result' && (
          <>
            <button type="button" className="btn btn--ghost ai-dialog__again" onClick={() => setPhase({ kind: 'form' })}>
              <RotateCcw aria-hidden /> Modifier la demande
            </button>
            <button type="button" className="btn" onClick={close}>
              Fermer
            </button>
            {hasText && (
              <button type="button" className="btn" onClick={() => apply('append')}>
                Ajouter à la fin
              </button>
            )}
            <button type="button" className="btn btn--primary" onClick={() => apply('replace')} autoFocus>
              {hasText ? 'Remplacer le texte' : 'Insérer dans l’éditeur'}
            </button>
          </>
        )}
      </div>
    </dialog>
  )
}
