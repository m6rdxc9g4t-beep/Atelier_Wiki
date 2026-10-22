// Premier démarrage : un espace « Général » avec une page d'accueil qui montre la syntaxe.
// Rien n'est créé si le Wiki contient déjà un espace.

import type { Db } from '../db/database.js'
import { createPage } from './pages.js'
import { createSpace } from './spaces.js'

const WELCOME = `Ce wiki rassemble ce qui doit rester écrit : procédures, notes techniques, décisions, comptes rendus.
Chaque page s'écrit en **Markdown** et garde tout son historique.

## Pour commencer

- **Nouvelle page** : bouton « + » dans la barre latérale, ou \`N\`.
- **Modifier** : bouton « Modifier » en haut de la page, ou \`E\`. \`⌘ S\` enregistre.
- **Chercher** : \`⌘ K\` (ou \`/\`) cherche dans les titres et dans le texte de toutes les pages.
- **Ranger** : une page peut contenir des sous-pages ; « Déplacer » la change de place ou d'espace.

## Relier les pages

Écris le titre d'une page entre doubles crochets pour y faire un lien : [[Syntaxe Markdown]].
Un lien vers une page qui n'existe pas encore apparaît en pointillés : un clic la crée.
En bas de chaque page, **Pages qui citent celle-ci** liste les liens entrants.

## Bon à savoir

- [x] L'historique garde chaque version enregistrée : on peut comparer et revenir en arrière.
- [x] Une page supprimée part 30 jours dans la corbeille, avec ses sous-pages.
- [ ] Les images se collent directement dans l'éditeur (\`⌘ V\`) ou s'y glissent.
`

const SYNTAX = `Aide-mémoire de ce que le wiki sait afficher.

## Texte

**gras**, *italique*, ~~barré~~, \`code\`, [lien externe](https://example.com), [[Bienvenue sur le Wiki|lien interne avec un autre texte]].

> Une citation, pour mettre en avant une remarque.

## Listes

1. Première étape
2. Deuxième étape
   - un détail
   - un autre

- [ ] tâche à faire
- [x] tâche faite

## Tableau

| Commande | Effet |
|---|---|
| \`⌘ K\` | Rechercher |
| \`E\` | Modifier la page |
| \`N\` | Nouvelle page |

## Code

\`\`\`bash
sudo ./update.sh wiki
\`\`\`
`

export function seedIfEmpty(db: Db, user = 'Atelier'): boolean {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM spaces').get() as { n: number }).n
  if (count > 0) return false
  db.transaction(() => {
    const space = createSpace(db, { name: 'Général', icon: '📘', description: 'Espace par défaut du wiki.' })
    const welcome = createPage(db, { spaceId: space.id, title: 'Bienvenue sur le Wiki', icon: '👋', content: WELCOME }, user)
    createPage(db, { spaceId: space.id, parentId: welcome.id, title: 'Syntaxe Markdown', icon: '✍️', content: SYNTAX }, user)
    db.prepare('UPDATE pages SET pinned = 1 WHERE id = ?').run(welcome.id)
  })()
  return true
}
