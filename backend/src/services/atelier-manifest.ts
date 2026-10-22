// Manifeste du nœud Atelier (contrat atelier-node/1, docs/SUITE.md §7 d'Atelier Projets) : ce qu'Atelier Nexus
// peut enchaîner dans un workflow. Les schémas d'entrée sont déclarés UNE fois ici : la route les utilise pour
// valider, le manifeste les publie.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EVENT_TYPES, type WikiEventType } from './events.js'

const pkg = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8')) as { version: string }

type JsonSchema = Record<string, unknown>

const id = { type: 'string', pattern: '^[0-9]+$', description: 'Identifiant numérique, en chaîne.' }

export const SCHEMAS = {
  spacesList: { type: 'object', properties: {}, additionalProperties: false },
  pagesSearch: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 500, description: 'Mots cherchés dans les titres et le texte (accents ignorés).' },
      space_id: { ...id, description: "Limiter à un espace." },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    },
    required: ['query'],
    additionalProperties: false,
  },
  pagesList: {
    type: 'object',
    properties: {
      space_id: { ...id, description: 'Limiter à un espace.' },
      updated_since: { type: 'string', format: 'date-time', description: 'Pages modifiées depuis cet instant (ISO 8601).' },
      limit: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
    },
    additionalProperties: false,
  },
  pagesGet: {
    type: 'object',
    properties: { page_id: id },
    required: ['page_id'],
    additionalProperties: false,
  },
  pagesCreate: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      content: { type: 'string', maxLength: 2_000_000, description: 'Markdown.' },
      space_id: { ...id, description: 'Espace cible (défaut : le premier espace).' },
      parent_id: { ...id, description: 'Page parente (même espace).' },
      icon: { type: 'string', maxLength: 16, description: 'Émoji.' },
    },
    required: ['title'],
    additionalProperties: false,
  },
  pagesAppend: {
    type: 'object',
    properties: {
      page_id: id,
      content: { type: 'string', minLength: 1, maxLength: 200_000, description: 'Markdown ajouté à la fin de la page.' },
      heading: { type: 'string', maxLength: 200, description: 'Titre de section (## …) placé avant le texte ajouté.' },
    },
    required: ['page_id', 'content'],
    additionalProperties: false,
  },
  pagesReplace: {
    type: 'object',
    properties: {
      page_id: id,
      content: { type: 'string', maxLength: 2_000_000, description: 'Nouveau contenu Markdown complet.' },
      title: { type: 'string', minLength: 1, maxLength: 200 },
    },
    required: ['page_id', 'content'],
    additionalProperties: false,
  },
} satisfies Record<string, JsonSchema>

const tableOutput = { format: 'atelier-table/1', schema: { type: 'object' } }

const pageJson = {
  format: 'json',
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      content: { type: 'string' },
      space_id: { type: 'string' },
      space: { type: 'string' },
      parent_id: { type: ['string', 'null'] },
      version: { type: 'integer' },
      updated_at: { type: 'string', format: 'date-time' },
      updated_by: { type: 'string' },
      path: { type: 'string' },
      url: { type: ['string', 'null'] },
      backlinks: { type: 'array', items: { type: 'object' } },
    },
    required: ['id', 'title', 'content', 'space_id', 'version', 'path'],
  },
}

/** Corps de la route sans les propriétés placées dans le chemin (`{page_id}`). */
export function bodySchema(schema: JsonSchema, pathParams: string[]): JsonSchema {
  const properties = { ...(schema.properties as Record<string, unknown>) }
  for (const p of pathParams) delete properties[p]
  const required = ((schema.required as string[] | undefined) ?? []).filter((r) => !pathParams.includes(r))
  return { ...schema, properties, required }
}

const EVENT_LABELS: Record<WikiEventType, string> = {
  'wiki.space.created': 'Espace créé',
  'wiki.page.created': 'Page créée',
  'wiki.page.updated': 'Page modifiée',
  'wiki.page.moved': 'Page déplacée',
  'wiki.page.deleted': 'Page mise à la corbeille',
  'wiki.page.restored': 'Page restaurée',
}

export function manifest() {
  return {
    contract: 'atelier-node/1',
    app: 'wiki',
    name: 'Atelier Wiki',
    version: pkg.version,
    transport: 'http',
    actions: [
      {
        id: 'spaces.list',
        label: 'Lister les espaces',
        description: 'Espaces du wiki avec leur nombre de pages.',
        kind: 'read',
        http: { method: 'GET', path: '/api/atelier/spaces' },
        mcp_tool: null,
        input_schema: SCHEMAS.spacesList,
        output: tableOutput,
        idempotency: 'natural',
      },
      {
        id: 'pages.search',
        label: 'Chercher dans le wiki',
        description: 'Recherche plein texte dans les titres et le contenu des pages ; renvoie les pages et un extrait.',
        kind: 'read',
        http: { method: 'POST', path: '/api/atelier/search' },
        mcp_tool: null,
        input_schema: SCHEMAS.pagesSearch,
        output: tableOutput,
        idempotency: 'natural',
      },
      {
        id: 'pages.list',
        label: 'Lister les pages',
        description: 'Pages du wiki (titre, espace, version, dernière modification), sans leur contenu.',
        kind: 'read',
        http: { method: 'GET', path: '/api/atelier/pages' },
        mcp_tool: null,
        input_schema: SCHEMAS.pagesList,
        output: tableOutput,
        idempotency: 'natural',
      },
      {
        id: 'pages.get',
        label: 'Lire une page',
        description: 'Contenu Markdown complet d’une page et les pages qui la citent.',
        kind: 'read',
        http: { method: 'GET', path: '/api/atelier/pages/{page_id}' },
        mcp_tool: null,
        input_schema: SCHEMAS.pagesGet,
        output: pageJson,
        idempotency: 'natural',
      },
      {
        id: 'pages.create',
        label: 'Créer une page',
        description: 'Crée une page Markdown dans un espace, éventuellement sous une page parente.',
        kind: 'write',
        http: { method: 'POST', path: '/api/atelier/pages' },
        mcp_tool: null,
        input_schema: SCHEMAS.pagesCreate,
        output: pageJson,
        idempotency: 'header',
      },
      {
        id: 'pages.append',
        label: 'Compléter une page',
        description: 'Ajoute une section à la fin d’une page existante (compte rendu, journal…).',
        kind: 'write',
        http: { method: 'POST', path: '/api/atelier/pages/{page_id}/append' },
        mcp_tool: null,
        input_schema: SCHEMAS.pagesAppend,
        output: pageJson,
        idempotency: 'header',
      },
      {
        id: 'pages.replace',
        label: 'Réécrire une page',
        description: 'Remplace tout le contenu d’une page (l’ancienne version reste dans l’historique).',
        kind: 'destructive',
        http: { method: 'PUT', path: '/api/atelier/pages/{page_id}' },
        mcp_tool: null,
        input_schema: SCHEMAS.pagesReplace,
        output: pageJson,
        idempotency: 'natural',
      },
    ],
    events: EVENT_TYPES.map((type) => ({ type, label: EVENT_LABELS[type], data_schema: { type: 'object' } })),
  }
}
