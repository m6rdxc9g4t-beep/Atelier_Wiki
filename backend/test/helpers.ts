// Outils communs des tests : application en mémoire, sans réseau ni fichier (sauf mention).

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildApp } from '../src/app.js'
import { loadConfig, type WikiConfig } from '../src/config.js'
import { openDatabase } from '../src/db/database.js'
import type { FetchFn } from '../src/services/ai.js'

export function testConfig(overrides: Partial<WikiConfig> = {}): WikiConfig {
  return {
    ...loadConfig({}),
    dataDir: mkdtempSync(join(tmpdir(), 'atelier-wiki-')),
    staticDir: null,
    allowedHosts: ['wiki.atelier.test'],
    ...overrides,
  }
}

/** Application de test. Sans `aiFetch`, tout appel à Ollama échoue (aucun réseau réel). */
export async function testApp(options: { seed?: boolean; config?: Partial<WikiConfig>; aiFetch?: FetchFn } = {}) {
  const db = openDatabase(':memory:')
  const noNetwork: FetchFn = async () => {
    throw new TypeError('réseau coupé dans les tests')
  }
  const app = await buildApp({ config: testConfig(options.config), db, seed: options.seed ?? false, aiFetch: options.aiFetch ?? noNetwork })
  return { app, db }
}

/** Requête JSON sur l'hôte de bouclage (comme Nexus) ou l'hôte public. */
export function json(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}) {
  return {
    method,
    url,
    headers: { host: '127.0.0.1:3200', ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
  }
}
