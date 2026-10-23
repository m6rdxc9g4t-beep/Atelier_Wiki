# Atelier Wiki

Le wiki de la Suite Atelier : procédures, notes techniques, décisions et comptes rendus, rangés par espaces et reliés entre eux.

- **Espaces et pages arborescentes** : chaque page peut avoir des sous-pages ; on les range par glisser-déposer dans la barre latérale ou avec « Déplacer ».
- **Markdown** (tableaux, cases à cocher, code, images) avec un aperçu côte à côte pendant l'écriture.
- **Liens entre pages** : `[[Titre de la page]]` ou `[[Titre|texte affiché]]`. Saisir `[[` propose les pages existantes ; un lien vers une page qui n'existe pas encore s'affiche en pointillés et la crée d'un clic. Chaque page liste les pages qui la citent.
- **Historique complet** : chaque enregistrement garde une copie de la page ; on compare deux versions et on revient en arrière sans rien perdre.
- **Recherche plein texte** (`⌘ K` ou `/`) dans les titres et le texte, accents ignorés.
- **Images et fichiers** : coller (`⌘ V`) ou glisser dans l'éditeur.
- **Corbeille** de 30 jours, sous-pages comprises.
- **Rédiger avec l’IA** : dans l’éditeur, l’IA locale (Ollama, sur le serveur de la suite) rédige une page à partir de tes consignes ou retravaille le texte actuel (compléter, reformuler, structurer, résumer). Tu relis l’aperçu, puis tu remplaces le texte ou l’ajoutes à la fin : rien n’est enregistré tant que tu n’as pas cliqué sur « Enregistrer ».
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
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Serveur Ollama de la rédaction assistée |
| `OLLAMA_MODEL` | `llama3.1:8b` | Modèle utilisé (à installer : `ollama pull llama3.1:8b`) |
| `OLLAMA_TIMEOUT_MS` | `300000` | Délai maximal d’une rédaction (sans GPU, plusieurs minutes) |

Adresses de la suite compilées dans l'interface (sélecteur « Suite Atelier ») : `VITE_ATELIER_NEXUS_URL`, `VITE_ATELIER_VIZ_URL`, `VITE_ATELIER_TAB_URL`, `VITE_ATELIER_PROJETS_URL`, `VITE_ATELIER_PORTAL_URL`.

## Sur le VPS (Atelier_Deploy)

Le Wiki tourne derrière le portail de la suite : Caddy vérifie la session (`forward_auth`) puis transmet à `127.0.0.1:3200`. Le Wiki n'a pas de connexion propre ; l'auteur de chaque modification vient de l'en-tête `X-Atelier-User` posé par le portail. Il refuse tout hôte non déclaré (`ALLOWED_HOSTS`) et toute écriture venue d'une autre origine.

## Comment c'est construit

```
backend/   Fastify + TypeScript + SQLite (better-sqlite3, recherche FTS5)
  src/domain/     règles pures (liens [[…]], extraits, prompts de l’IA)
  src/services/   espaces, pages, historique, recherche, pièces jointes, événements, idempotence, nœud Atelier, IA (Ollama)
  src/routes/     routes minces : wiki.ts (interface), attachments.ts, atelier.ts (Nexus), ai.ts (rédaction assistée)
frontend/  React + TypeScript + Vite, sans framework CSS
  src/styles/     copies verbatim du design system d'Atelier Projets + wiki.css
```

Charte « néon monochrome » de la suite, couleur signature **bleu ciel `#4DABF7`** (`frontend/src/styles/wiki-signature.css`). Le texte des pages est composé dans une serif système pour la lecture longue ; l'interface garde la pile sans empattement de la suite. Aucune police téléchargée.

## Rédaction assistée (Ollama)

| Route | Rôle |
|---|---|
| `GET /api/ai/status` | `{ available, model, modelInstalled }` (sonde `/api/tags` d’Ollama, 3 s au plus, jamais d’erreur) |
| `POST /api/ai/draft` | `{ instructions, title?, current?, mode: "create" \| "rewrite" }` → `{ markdown, model }` |

`POST /api/ai/draft` ne crée ni ne modifie aucune page : il renvoie un brouillon. Consignes : 4 000 caractères au plus ; texte actuel (`current`, exigé en mode `rewrite`) : 50 000. Erreurs `{ detail, code }` : `AI_UNAVAILABLE` (503, Ollama injoignable), `AI_MODEL_MISSING` (503, modèle non installé), `AI_TIMEOUT` (504, délai `OLLAMA_TIMEOUT_MS` dépassé), `AI_INVALID_OUTPUT` (502, réponse inexploitable), `VALIDATION` (422). Si le navigateur abandonne (bouton « Annuler »), la génération s’arrête aussi côté Ollama.

Le prompt système ne contient que des consignes ; le titre et le texte de la page partent dans des blocs `<donnees>…</donnees>` (balises imitées neutralisées), traités comme des données, jamais comme des consignes. Sur le VPS, le délai du proxy (Caddy) doit rester supérieur à `OLLAMA_TIMEOUT_MS`.

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
