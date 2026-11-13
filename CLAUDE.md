# Atelier Wiki — règles du dépôt

Consulte `README.md` pour les fonctions et les réglages. Le contrat commun de la suite (charte, nœud `atelier-node/1`) est dans `Atelier_Projets/docs/SUITE.md`.

## Architecture

- `backend/` : Fastify + TypeScript + better-sqlite3. **Routes minces** (`src/routes/`) qui valident puis appellent un service ; logique dans `src/services/` ; règles pures dans `src/domain/`.
- Toute écriture d'une page passe par `services/pages.ts`, dans **une transaction** qui met à jour : la page, l'index FTS5 (`pages_fts`), les liens sortants (`page_links`), l'historique (`page_revisions`) et émet l'événement `wiki.*` (`emitEvents`). Ne jamais écrire dans `pages` ailleurs.
- Migrations SQLite dans `src/db/database.ts` : on n'en modifie jamais une publiée, on en ajoute une.
- Erreurs d'API : `ApiError` → `{ detail, code }`, messages en français.
- `PUT /api/pages/:id` exige `baseVersion` (verrou optimiste) : 409 `CONFLICT` avec la version actuelle si elle a changé.
- Nœud Atelier : actions déclarées **une seule fois** dans `services/atelier-manifest.ts` (schémas réutilisés par les routes), logique dans `services/atelier-node.ts`, idempotence par `runIdempotent`. Les événements ne contiennent jamais le texte des pages.
- Format des pages (migration 3) : colonne `format` (`markdown` | `latex`) sur `pages` et `page_revisions`, règles dans `domain/format.ts`. Changer de format est une modification (nouvelle version) ; l'export suit le format (`.md` ou `.tex`).
- Sécurité : gardes Host / Origin dans `http/guards.ts` (ne pas assouplir) ; pas de HTML brut dans le rendu Markdown ni LaTeX (le LaTeX passe par `hast-util-sanitize` avant l'affichage ; seuls KaTeX et Mermaid produisent du balisage, KaTeX sans `trust`, Mermaid en `securityLevel: 'strict'` affiché comme image `data:`) ; le HTML collé est converti en Markdown, jamais interprété ; pièces jointes servies avec un type fixé par le serveur, `nosniff` et une CSP `sandbox` (sauf PDF).
- `frontend/` : React + Vite, CSS natif. `src/styles/atelier-ds/*`, `src/styles/atelier-brand/*` et `public/atelier-theme.js` sont des **copies verbatim** d'Atelier Projets (`design-system/`, charte v2) : ne pas les modifier ici. La signature du Wiki (`#007cbb`, icône `book-open`) est activée dans `wiki-signature.css`, l'interface dans `wiki.css` (aucune couleur littérale : uniquement les jetons `--app-*`, `--accent*`, `--atelier-*`, `--status-*` ; vérifié par `src/lib/design.test.ts`). Règles de la charte : `Atelier_Deploy/DESIGN.md`.
- Coquille à la forme de celles d'Atelier Viz et d'Atelier Tab (`components/Sidebar.tsx`, `Header.tsx`, section « Coquille » de `wiki.css`) : barre latérale de 232 px, en-tête de 44 px (tuile de 20 px + nom), lignes de 30 px (40 px au doigt), entrée courante `atelier-nav-active` (jamais de barre de couleur), pied dans l'ordre « Exemples de la suite », auteur, thème ; le sélecteur « Suite Atelier » ouvre la barre haute (comme Viz). Seule `.sidebar__scroll` défile, et jamais en largeur : rien n'y dépasse (un menu posé dedans prend la largeur de son bouton). Sous 1024 px (`RAIL_QUERY` de `lib/shell.ts`, même requête dans `wiki.css`) : rail d'icônes de 48 px, le bouton « Pages » ouvre le panneau complet par-dessus la page ; dans le rail un libellé est masqué par `font-size: 0`, jamais par `display: none` (il reste le nom lu). Mesures, ordre et requête vérifiés par `design.test.ts`.
- Un extrait ou un titre montré ou servi est du **texte**, jamais du balisage : `plainText` / `excerpt` / `searchExcerpt` de `domain/markdown.ts` (balises retirées — les seuls éléments HTML, `HTML_TAGS` : `Array<string>` ou « <nom de la branche> » restent du texte —, entités décodées, syntaxe Markdown ou LaTeX retirée, espaces resserrés, coupe après le nettoyage) servent l'accueil, les sous-pages, la recherche et le nœud Atelier ; ne jamais renvoyer le `snippet()` de l'index ni un morceau de source. Côté interface, la table des matières suit la même règle (`extractHeadings`, même table d'entités que le backend, comparée par un test) et un extrait s'affiche par `hitParts` (texte et mots trouvés, rien d'interprété). Dans une page, seul `<br>` est compris (saut de ligne, `remarkLineBreaks`) ; toute autre balise reste du texte.
- Les règles de liens `[[…]]` existent côté backend (`domain/markdown.ts`, `domain/format.ts` pour le LaTeX) et frontend (`lib/markdown.ts`, `lib/latex.ts`) : les garder identiques.
- Chargement à la demande : l'éditeur, le rendu LaTeX (`components/Latex.tsx`), KaTeX (`lib/math.ts`) et Mermaid ne sont pas dans le paquet initial. Les polices ne sont jamais incluses en `data:` (CSP `font-src 'self'`, voir `vite.config.ts`).

## Exemples de la suite

- `exemples-suite/` (format `atelier-exemples/1`) est **généré** par Atelier_Deploy (`exemples/generer.py --vers <dossier des dépôts>`), jamais modifié à la main ici.
- `services/exemples.ts` crée l'espace et les pages d'une histoire par `createSpace` / `createPage` (index, liens, historique, événements) ; l'espace est noté dans `suite_examples` (migration 2), seul supprimé par le retrait. Routes `GET/POST/DELETE /api/exemples-suite[/:histoire]`, réglage `WIKI_EXEMPLES_DIR`. Front : `components/SuiteExamples.tsx` (fenêtre ouverte par « Exemples de la suite » au pied de la barre latérale, et carte de l'accueil tant que le wiki n'a aucune page).

## Méthode

- Interface et messages en français, tutoiement.
- Après chaque changement : `npm run check` (typage + tests). Tout comportement nouveau a un test.
- Commits : `feat(scope): …`, `fix(scope): …`, `chore(scope): …`.
