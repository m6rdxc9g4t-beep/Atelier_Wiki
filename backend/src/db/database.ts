// Base SQLite du Wiki (better-sqlite3, synchrone) : ouverture et migrations.
// Les migrations sont numérotées et ne changent jamais une fois publiées : on en ajoute une nouvelle.

import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type Db = Database.Database

const MIGRATIONS: readonly string[] = [
  // 1 — schéma initial
  `
  CREATE TABLE spaces (
    id          INTEGER PRIMARY KEY,
    slug        TEXT    NOT NULL UNIQUE,
    name        TEXT    NOT NULL,
    icon        TEXT    NOT NULL DEFAULT '',
    description TEXT    NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
  );

  CREATE TABLE pages (
    id           INTEGER PRIMARY KEY,
    space_id     INTEGER NOT NULL REFERENCES spaces(id),
    parent_id    INTEGER REFERENCES pages(id),
    title        TEXT    NOT NULL,
    icon         TEXT    NOT NULL DEFAULT '',
    content      TEXT    NOT NULL DEFAULT '',
    position     INTEGER NOT NULL DEFAULT 0,
    version      INTEGER NOT NULL DEFAULT 1,
    pinned       INTEGER NOT NULL DEFAULT 0,
    created_by   TEXT    NOT NULL,
    updated_by   TEXT    NOT NULL,
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL,
    -- Corbeille : la page supprimée et ses sous-pages portent l'id de la page supprimée (deleted_root).
    deleted_at   TEXT,
    deleted_by   TEXT,
    deleted_root INTEGER
  );
  CREATE INDEX pages_tree ON pages(space_id, parent_id, position);
  CREATE INDEX pages_updated ON pages(updated_at);
  CREATE INDEX pages_deleted ON pages(deleted_root);

  CREATE TABLE page_revisions (
    id         INTEGER PRIMARY KEY,
    page_id    INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    version    INTEGER NOT NULL,
    title      TEXT    NOT NULL,
    icon       TEXT    NOT NULL DEFAULT '',
    content    TEXT    NOT NULL,
    author     TEXT    NOT NULL,
    summary    TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL,
    UNIQUE (page_id, version)
  );

  -- Liens sortants d'une page : vers un id (/p/12) ou un titre ([[Titre]]), normalisé sans casse ni accents.
  CREATE TABLE page_links (
    source_id    INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    target_id    INTEGER,
    target_title TEXT
  );
  CREATE INDEX page_links_source ON page_links(source_id);
  CREATE INDEX page_links_target_id ON page_links(target_id);
  CREATE INDEX page_links_target_title ON page_links(target_title);

  -- Recherche plein texte : rowid = id de la page ; accents ignorés (« elephant » trouve « éléphant »).
  CREATE VIRTUAL TABLE pages_fts USING fts5(title, content, tokenize = 'unicode61 remove_diacritics 2');

  CREATE TABLE attachments (
    id         INTEGER PRIMARY KEY,
    page_id    INTEGER REFERENCES pages(id) ON DELETE SET NULL,
    name       TEXT    NOT NULL,
    stored     TEXT    NOT NULL UNIQUE,
    mime       TEXT    NOT NULL,
    size       INTEGER NOT NULL,
    created_by TEXT    NOT NULL,
    created_at TEXT    NOT NULL
  );

  -- Journal d'événements du contrat atelier-node/1 (§7.3) : AUTOINCREMENT garantit qu'un seq n'est jamais réutilisé.
  CREATE TABLE atelier_events (
    seq           INTEGER PRIMARY KEY AUTOINCREMENT,
    type          TEXT NOT NULL,
    at            TEXT NOT NULL,
    subject_kind  TEXT NOT NULL,
    subject_id    TEXT NOT NULL,
    subject_label TEXT NOT NULL,
    data          TEXT NOT NULL
  );
  CREATE INDEX atelier_events_at ON atelier_events(at);

  -- Idempotence des écritures (§7.4).
  CREATE TABLE idempotency_records (
    key         TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    status      INTEGER NOT NULL,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );
  `,
]

export function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
  const current = (db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }).v ?? 0
  MIGRATIONS.forEach((sql, index) => {
    const version = index + 1
    if (version <= current) return
    db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString())
    })()
  })
}

/** Ouvre (ou crée) la base. `:memory:` pour les tests. */
export function openDatabase(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  return db
}

export const SCHEMA_VERSION = MIGRATIONS.length
