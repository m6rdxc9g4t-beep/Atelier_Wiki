// Réglages du serveur, lus une seule fois dans l'environnement.
// Tout a une valeur par défaut qui marche en local (`npm run dev`).

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/** Racine du paquet backend (src/ en dev, dist/ une fois compilé : même parent). */
const backendRoot = resolve(here, '..')

export interface WikiConfig {
  host: string
  port: number
  /** Dossier des données : base SQLite (`wiki.db`) et pièces jointes (`uploads/`). */
  dataDir: string
  /** Hôtes publics acceptés en plus des adresses de bouclage (ex. `wiki.atelier.mondomaine.fr`). */
  allowedHosts: string[]
  /** Interface compilée servie par le backend (vide : API seule). */
  staticDir: string | null
  /** Taille maximale d'une pièce jointe, en octets. */
  maxUploadBytes: number
  /** Auteur affiché quand la requête ne porte pas `X-Atelier-User` (en local, sans portail). */
  defaultUser: string
  /** Jours passés dans la corbeille avant suppression définitive. */
  trashDays: number
  /** Adresse publique du Wiki (`https://wiki.atelier.mondomaine.fr`) : liens complets donnés à Nexus. */
  publicUrl: string | null
  /** IA de rédaction : serveur Ollama (même hôte par défaut), modèle et délai maximal d'une génération. */
  ollama: OllamaConfig
  logLevel: string
}

export interface OllamaConfig {
  /** Adresse du serveur Ollama, sans « / » final (`OLLAMA_URL`). */
  url: string
  /** Modèle utilisé pour rédiger (`OLLAMA_MODEL`). */
  model: string
  /** Délai maximal d'une génération, en millisecondes (`OLLAMA_TIMEOUT_MS`) : sans GPU, plusieurs minutes. */
  timeoutMs: number
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WikiConfig {
  const defaultStatic = resolve(backendRoot, '..', 'frontend', 'dist')
  const staticDir = env.WIKI_STATIC_DIR !== undefined
    ? (env.WIKI_STATIC_DIR.trim() ? resolve(env.WIKI_STATIC_DIR) : null)
    : (existsSync(resolve(defaultStatic, 'index.html')) ? defaultStatic : null)

  return {
    host: env.HOST || '127.0.0.1',
    port: positiveNumber(env.PORT, 3200),
    dataDir: resolve(env.WIKI_DATA_DIR || resolve(backendRoot, 'data')),
    allowedHosts: list(env.ALLOWED_HOSTS),
    staticDir,
    maxUploadBytes: positiveNumber(env.WIKI_MAX_UPLOAD_MB, 20) * 1024 * 1024,
    defaultUser: (env.WIKI_DEFAULT_USER || 'moi').trim(),
    trashDays: positiveNumber(env.WIKI_TRASH_DAYS, 30),
    publicUrl: env.WIKI_PUBLIC_URL?.trim().replace(/\/+$/, '') || null,
    ollama: {
      url: env.OLLAMA_URL?.trim().replace(/\/+$/, '') || 'http://127.0.0.1:11434',
      model: env.OLLAMA_MODEL?.trim() || 'llama3.1:8b',
      timeoutMs: positiveNumber(env.OLLAMA_TIMEOUT_MS, 300_000),
    },
    logLevel: env.LOG_LEVEL || 'info',
  }
}
