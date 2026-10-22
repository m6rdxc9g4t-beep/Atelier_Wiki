# Atelier Wiki

Le wiki de la Suite Atelier : procédures, notes techniques, décisions et comptes rendus, rangés par espaces et reliés entre eux.

- **Espaces et pages arborescentes** : chaque page peut avoir des sous-pages ; on les range par glisser-déposer dans la barre latérale ou avec « Déplacer ».
- **Markdown** (tableaux, cases à cocher, code, images) avec un aperçu côte à côte pendant l'écriture.
- **Liens entre pages** : `[[Titre de la page]]` ou `[[Titre|texte affiché]]`. Saisir `[[` propose les pages existantes ; un lien vers une page qui n'existe pas encore s'affiche en pointillés et la crée d'un clic. Chaque page liste les pages qui la citent.
- **Historique complet** : chaque enregistrement garde une copie de la page ; on compare deux versions et on revient en arrière sans rien perdre.
- **Recherche plein texte** (`⌘ K` ou `/`) dans les titres et le texte, accents ignorés.
- **Images et fichiers** : coller (`⌘ V`) ou glisser dans l'éditeur.
- **Corbeille** de 30 jours, sous-pages comprises.
- **Écritures concurrentes protégées** : si quelqu'un a enregistré la page pendant que tu l'écrivais, le Wiki le signale au lieu d'écraser son travail. Le brouillon en cours reste sur l'appareil jusqu'à l'enregistrement.
- **Nœud Atelier** (`atelier-node/1`) : Atelier Nexus peut chercher, lire, créer et compléter des pages dans ses workflows.

## Lancer en local

```bash
npm ci
npm run dev        # interface http://127.0.0.1:5176, API http://127.0.0.1:3200
```

Ou la version compilée, servie par le backend seul :

```bash
npm run build
npm start          # http://127.0.0.1:3200
```

Les données vont dans `backend/data/` (`wiki.db` + `uploads/`). Au premier démarrage, un espace « Général » et une page d'accueil sont créés.

## Réglages (variables d'environnement du backend)

| Variable | Défaut | Rôle |
|---|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `3200` | Adresse d'écoute |
| `WIKI_DATA_DIR` | `backend/data` | Base SQLite et pièces jointes |
| `ALLOWED_HOSTS` | (vide) | Hôtes publics acceptés en plus du bouclage, séparés par des virgules (ex. `wiki.atelier.mondomaine.fr`) |
| `WIKI_PUBLIC_URL` | (vide) | Adresse publique, pour les liens complets renvoyés à Nexus |
| `WIKI_STATIC_DIR` | `frontend/dist` s'il existe | Interface compilée servie par le backend (vide = API seule) |
| `WIKI_MAX_UPLOAD_MB` | `20` | Taille maximale d'une pièce jointe |
| `WIKI_TRASH_DAYS` | `30` | Durée de la corbeille |
| `WIKI_DEFAULT_USER` | `moi` | Auteur affiché sans portail (en local) |

Adresses de la suite compilées dans l'interface (sélecteur « Suite Atelier ») : `VITE_ATELIER_NEXUS_URL`, `VITE_ATELIER_VIZ_URL`, `VITE_ATELIER_TAB_URL`, `VITE_ATELIER_PROJETS_URL`, `VITE_ATELIER_PORTAL_URL`.

## Sur le VPS (Atelier_Deploy)

Le Wiki tourne derrière le portail de la suite : Caddy vérifie la session (`forward_auth`) puis transmet à `127.0.0.1:3200`. Le Wiki n'a pas de connexion propre ; l'auteur de chaque modification vient de l'en-tête `X-Atelier-User` posé par le portail. Il refuse tout hôte non déclaré (`ALLOWED_HOSTS`) et toute écriture venue d'une autre origine.

## Comment c'est construit

```
backend/   Fastify + TypeScript + SQLite (better-sqlite3, recherche FTS5)
  src/domain/     règles pures (liens [[…]], extraits)
  src/services/   espaces, pages, historique, recherche, pièces jointes, événements, idempotence, nœud Atelier
  src/routes/     routes minces : wiki.ts (interface), attachments.ts, atelier.ts (Nexus)
frontend/  React + TypeScript + Vite, sans framework CSS
  src/styles/     copies verbatim du design system d'Atelier Projets + wiki.css
```

Charte « néon monochrome » de la suite, couleur signature **bleu ciel `#4DABF7`** (`frontend/src/styles/wiki-signature.css`). Le texte des pages est composé dans une serif système pour la lecture longue ; l'interface garde la pile sans empattement de la suite. Aucune police téléchargée.

## Nœud Atelier (contrat `atelier-node/1`)

Manifeste : `GET /api/atelier/manifest`. Événements : `GET /api/atelier/events?since=<seq>`.

| Action | Type | Route |
|---|---|---|
| `spaces.list` | lecture | `GET /api/atelier/spaces` → `atelier-table/1` |
| `pages.search` | lecture | `POST /api/atelier/search` `{ query, space_id?, limit? }` → `atelier-table/1` |
| `pages.list` | lecture | `GET /api/atelier/pages?space_id&updated_since&limit` → `atelier-table/1` |
| `pages.get` | lecture | `GET /api/atelier/pages/{page_id}` → page complète (Markdown) |
| `pages.create` | écriture, `Idempotency-Key` | `POST /api/atelier/pages` `{ title, content?, space_id?, parent_id?, icon? }` |
| `pages.append` | écriture, `Idempotency-Key` | `POST /api/atelier/pages/{page_id}/append` `{ content, heading? }` |
| `pages.replace` | destructive | `PUT /api/atelier/pages/{page_id}` `{ content, title? }` (l'ancienne version reste dans l'historique) |

Événements : `wiki.space.created`, `wiki.page.created`, `wiki.page.updated` (`fields`, `version`), `wiki.page.moved`, `wiki.page.deleted` (`pages`), `wiki.page.restored`. Ils ne contiennent jamais le texte des pages.

## Vérifier

```bash
npm run check      # typage + tests (backend et frontend)
```
