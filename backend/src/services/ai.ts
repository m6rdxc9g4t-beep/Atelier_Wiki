// Rédaction assistée par l'IA locale (Ollama, même hôte par défaut) : seul point de contact avec Ollama.
// Le service ne lit ni n'écrit aucune page : il renvoie un brouillon que l'utilisateur relit puis enregistre
// par le circuit normal de l'éditeur (services/pages.ts).

import type { OllamaConfig } from '../config.js'
import { cleanMarkdown, draftMessages, MAX_CURRENT, MAX_INSTRUCTIONS, MAX_TITLE, type ChatMessage, type DraftInput } from '../domain/ai-prompts.js'
import { ApiError, invalid } from '../http/errors.js'
import { nodeHttpFetch } from './http-transport.js'

/** `fetch` injectable (tests : faux Ollama, aucun appel réseau réel). */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

/** Délai de la sonde d'état (`/api/tags`) : l'interface ne doit jamais attendre. */
export const STATUS_TIMEOUT_MS = 3000

export interface AiStatus {
  available: boolean
  model: string
  modelInstalled: boolean
}

export interface ChatOptions {
  /** Schéma JSON de la réponse attendue (sortie structurée d'Ollama ≥ 0.5) ; absent : texte libre. */
  format?: Record<string, unknown>
  /** Annulation venue de l'appelant (requête HTTP abandonnée) ; le délai `timeoutMs` s'y ajoute. */
  signal?: AbortSignal
  temperature?: number
}

export interface ChatResult {
  content: string
  model: string
}

/** Nom complet d'un modèle Ollama : `llama3.1` → `llama3.1:latest`. */
function fullName(model: string): string {
  return model.includes(':') ? model : `${model}:latest`
}

const unavailable = (url: string) =>
  new ApiError(503, 'AI_UNAVAILABLE', `L’IA locale ne répond pas (Ollama sur ${url}). Vérifie que le service Ollama est démarré, puis réessaie.`)
const timedOut = (ms: number) =>
  new ApiError(504, 'AI_TIMEOUT', `L’IA n’a pas terminé en ${Math.round(ms / 1000)} secondes. Réessaie avec une demande plus courte, ou plus tard si le serveur est occupé.`)
const modelMissing = (model: string) =>
  new ApiError(503, 'AI_MODEL_MISSING', `Le modèle « ${model} » n’est pas installé sur le serveur Ollama. Installe-le avec « ollama pull ${model} » ou change OLLAMA_MODEL.`, { model })
const invalidOutput = (why: string) => new ApiError(502, 'AI_INVALID_OUTPUT', `La réponse de l’IA est inexploitable (${why}). Réessaie ou reformule ta demande.`)

interface OllamaChatResponse {
  message?: { content?: unknown }
  model?: unknown
  error?: unknown
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

export class OllamaClient {
  private readonly fetch: FetchFn

  constructor(
    readonly config: OllamaConfig,
    // Pas le `fetch` global : il abandonne après 300 s sans en-têtes (voir http-transport.ts).
    fetchFn: FetchFn = nodeHttpFetch,
  ) {
    this.fetch = fetchFn
  }

  get model(): string {
    return this.config.model
  }

  /** État du serveur et du modèle, en ~3 s au plus. Ne lève jamais d'exception. */
  async status(): Promise<AiStatus> {
    const model = this.config.model
    try {
      const response = await this.fetch(`${this.config.url}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) })
      if (!response.ok) return { available: false, model, modelInstalled: false }
      const body = (await response.json()) as { models?: { name?: unknown; model?: unknown }[] }
      const wanted = fullName(model)
      const installed = (body.models ?? []).some((m) =>
        [m.name, m.model].some((name) => typeof name === 'string' && fullName(name) === wanted),
      )
      return { available: true, model, modelInstalled: installed }
    } catch {
      return { available: false, model, modelInstalled: false }
    }
  }

  /** Une réponse complète d'Ollama (`/api/chat`, sans flux). Erreurs → ApiError AI_*. */
  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const { url, model, timeoutMs } = this.config
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout
    const body = {
      model,
      messages,
      stream: false,
      options: { temperature: options.temperature ?? 0.3 },
      ...(options.format ? { format: options.format } : {}),
    }

    let response: Response
    let text: string
    try {
      response = await this.fetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      text = await response.text()
    } catch (error) {
      if (options.signal?.aborted) throw new ApiError(499, 'AI_CANCELLED', 'Rédaction annulée.')
      if (timeout.aborted || (error as Error).name === 'TimeoutError') throw timedOut(timeoutMs)
      throw unavailable(url)
    }

    const data = parseJson(text) as OllamaChatResponse | null
    if (response.status === 404) throw modelMissing(model)
    if (!response.ok) {
      const reason = typeof data?.error === 'string' ? data.error : `erreur ${response.status}`
      if (/model .*not found|pull/i.test(reason)) throw modelMissing(model)
      throw new ApiError(503, 'AI_UNAVAILABLE', `L’IA locale a refusé la demande (${reason}). Réessaie dans un moment.`)
    }
    const content = data?.message?.content
    if (typeof content !== 'string') throw invalidOutput('réponse illisible')
    return { content, model: typeof data?.model === 'string' ? data.model : model }
  }

  /** Comme `chat`, avec un schéma JSON imposé : renvoie l'objet lu. */
  async chatJson<T>(messages: ChatMessage[], format: Record<string, unknown>, options: Omit<ChatOptions, 'format'> = {}): Promise<{ data: T; model: string }> {
    const result = await this.chat(messages, { ...options, format })
    try {
      return { data: JSON.parse(result.content) as T, model: result.model }
    } catch {
      throw invalidOutput('JSON attendu')
    }
  }
}

/** Contrôle des entrées de la rédaction (au-delà du schéma de la route) : textes vides, mode « rewrite » sans texte. */
export function checkDraftInput(input: DraftInput): DraftInput {
  const instructions = input.instructions.trim()
  if (!instructions) throw invalid('Écris ce que l’IA doit rédiger.')
  if (instructions.length > MAX_INSTRUCTIONS) throw invalid(`Consignes trop longues (${MAX_INSTRUCTIONS} caractères au plus).`)
  if ((input.title ?? '').length > MAX_TITLE) throw invalid(`Titre trop long (${MAX_TITLE} caractères au plus).`)
  if ((input.current ?? '').length > MAX_CURRENT) throw invalid(`Texte actuel trop long pour l’IA (${MAX_CURRENT} caractères au plus).`)
  if (input.mode === 'rewrite' && !(input.current ?? '').trim()) throw invalid('Le texte à retravailler est vide : choisis « Nouvelle rédaction ».')
  return { ...input, instructions }
}

/** Rédige (ou retravaille) le Markdown d'une page. Ne crée ni ne modifie aucune page. */
export async function draftPage(client: OllamaClient, input: DraftInput, signal?: AbortSignal): Promise<{ markdown: string; model: string }> {
  const checked = checkDraftInput(input)
  const result = await client.chat(draftMessages(checked), { signal, temperature: 0.3 })
  const markdown = cleanMarkdown(result.content)
  if (!markdown) throw invalidOutput('texte vide')
  return { markdown, model: result.model }
}
