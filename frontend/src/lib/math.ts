// Mise en forme des formules (KaTeX), chargée seulement quand une page en contient.

import rehypeKatex from 'rehype-katex'
import type { PluggableList } from 'unified'
import 'katex/dist/katex.min.css'

/** Une formule fausse s'affiche en rouge avec son texte, sans casser la page ; aucune commande « de confiance ». */
export const KATEX_OPTIONS = { strict: false, trust: false } as const

export const katexPlugins: PluggableList = [[rehypeKatex, KATEX_OPTIONS]]
