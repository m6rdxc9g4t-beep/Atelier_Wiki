# Atelier Wiki — règles du dépôt

Consulte `README.md` pour les fonctions et les réglages. Le contrat commun de la suite (charte, nœud `atelier-node/1`) est dans `Atelier_Projets/docs/SUITE.md`.

## Architecture

- `backend/` : Fastify + TypeScript + better-sqlite3. **Routes minces** (`src/routes/`) qui valident puis appellent un service ; logique dans `src/services/` ; règles pures dans `src/domain/`.
- Toute écriture d'une page passe par `services/pages.ts`, dans **une transaction** qui met à jour : la page, l'index FTS5 (`pages_fts`), les liens sortants (`page_links`), l'historique (`page_revisions`) et émet l'événement `wiki.*` (`emitEvents`). Ne jamais écrire dans `pages` ailleurs.
- Migrations SQLite dans `src/db/database.ts` : on n'en modifie jamais une publiée, on en ajoute une.
- Erreurs d'API : `ApiError` → `{ detail, code }`, messages en français.
- `PUT /api/pages/:id` exige `baseVersion` (verrou optimiste) : 409 `CONFLICT` avec la version actuelle si elle a changé.
- Nœud Atelier : actions déclarées **une seule fois** dans `services/atelier-manifest.ts` (schémas réutilisés par les routes), logique dans `services/atelier-node.ts`, idempotence par `runIdempotent`. Les événements ne contiennent jamais le texte des pages.
- Sécurité : gardes Host / Origin dans `http/guards.ts` (ne pas assouplir) ; pas de HTML brut dans le rendu Markdown ; pièces jointes servies avec un type fixé par le serveur, `nosniff` et une CSP `sandbox` (sauf PDF).
- `frontend/` : React + Vite, CSS natif. `src/styles/atelier-ds/*` et `src/styles/atelier-brand/*` sont des **copies verbatim** d'Atelier Projets : ne pas les modifier ici. La signature du Wiki est dans `wiki-signature.css`, l'interface dans `wiki.css` (aucune couleur littérale : uniquement les jetons `--app-*`, `--accent*`, `--status-*`).
- Les règles de liens `[[…]]` existent côté backend (`domain/markdown.ts`) et frontend (`lib/markdown.ts`) : les garder identiques.

## Méthode

- Interface et messages en français, tutoiement.
- Après chaque changement : `npm run check` (typage + tests). Tout comportement nouveau a un test.
- Commits : `feat(scope): …`, `fix(scope): …`, `chore(scope): …`.
