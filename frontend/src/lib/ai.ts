// Rédaction assistée : règles pures de la boîte de dialogue (aucun import de React ni d'appel réseau).

import type { AiDraftInput, AiDraftMode, AiStatus } from './api.ts'

export const MAX_INSTRUCTIONS = 4000
export const MAX_CURRENT = 50_000

/** Mode proposé à l'ouverture : retravailler s'il y a déjà du texte, sinon rédiger. */
export function defaultMode(current: string): AiDraftMode {
  return current.trim() ? 'rewrite' : 'create'
}

/** Corps de la requête : le texte actuel ne part qu'en mode « retravailler », le titre seulement s'il est rempli. */
export function draftRequest(mode: AiDraftMode, instructions: string, title: string, current: string): AiDraftInput {
  const input: AiDraftInput = { mode, instructions: instructions.trim() }
  if (title.trim()) input.title = title.trim()
  if (mode === 'rewrite') input.current = current
  return input
}

/** Raison pour laquelle « Générer » est impossible, ou null. */
export function cannotGenerate(mode: AiDraftMode, instructions: string, current: string): string | null {
  if (!instructions.trim()) return 'Écris d’abord ce que l’IA doit rédiger.'
  if (instructions.length > MAX_INSTRUCTIONS) return `Consignes trop longues : ${MAX_INSTRUCTIONS} caractères au plus.`
  if (mode === 'rewrite' && !current.trim()) return 'L’éditeur est vide : choisis « Nouvelle rédaction ».'
  if (mode === 'rewrite' && current.length > MAX_CURRENT) return `Le texte actuel est trop long pour l’IA (${MAX_CURRENT} caractères au plus).`
  return null
}

/** Texte de l'éditeur après insertion du brouillon : remplacé, ou ajouté à la fin après une ligne vide. */
export function applyDraft(current: string, draft: string, how: 'replace' | 'append'): string {
  const text = draft.trim()
  if (how === 'replace' || !current.trim()) return `${text}\n`
  return `${current.replace(/\s+$/, '')}\n\n${text}\n`
}

export type StatusNotice = { tone: 'warning' | 'danger'; text: string } | null

/** Message à afficher selon l'état de l'IA (null : prête). */
export function statusNotice(status: AiStatus | null, error: Error | null): StatusNotice {
  if (error) return { tone: 'warning', text: `État de l’IA inconnu (${error.message}) : tu peux quand même essayer.` }
  if (!status) return null
  if (!status.available) {
    return { tone: 'danger', text: 'L’IA locale (Ollama) ne répond pas sur le serveur. Demande à l’administrateur de démarrer le service Ollama, puis réessaie.' }
  }
  if (!status.modelInstalled) {
    return { tone: 'danger', text: `Le modèle « ${status.model} » n’est pas installé sur le serveur Ollama (commande « ollama pull ${status.model} »).` }
  }
  return null
}

/** Message lisible pour une erreur de rédaction (codes AI_* du serveur, coupure du proxy, réseau). */
export function draftErrorMessage(error: { status?: number; code?: string; message: string }): string {
  switch (error.code) {
    case 'AI_TIMEOUT':
    case 'AI_UNAVAILABLE':
    case 'AI_MODEL_MISSING':
    case 'AI_INVALID_OUTPUT':
    case 'VALIDATION':
    case 'NETWORK':
    case 'UNAUTHORIZED':
      return error.message
  }
  // Réponse sans code : le serveur web en amont a coupé une génération trop longue.
  if (error.status === 502 || error.status === 504) {
    return 'La connexion a été coupée avant la fin de la rédaction (délai du serveur web). Réessaie avec une demande plus courte.'
  }
  return error.message || 'La rédaction a échoué. Réessaie.'
}

/** Durée écoulée lisible : « 45 s », « 2 min 05 s ». */
export function elapsedLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
}
