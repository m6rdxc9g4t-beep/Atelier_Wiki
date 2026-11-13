import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { RAIL_QUERY } from './shell.ts'
import { LEGACY_KEY, migrateLegacyPreference, SUITE_KEY, type ThemePreference } from './theme.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

function memoryStorage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    removeItem: (k: string) => void data.delete(k),
  }
}

describe('thème commun à la suite', () => {
  it('reprend l’ancienne préférence du Wiki si la suite n’en a pas encore', () => {
    const storage = memoryStorage({ [LEGACY_KEY]: 'dark' })
    const chosen: ThemePreference[] = []
    assert.equal(
      migrateLegacyPreference(storage, (p) => chosen.push(p)),
      'dark',
    )
    assert.deepEqual(chosen, ['dark'])
    assert.equal(storage.data.has(LEGACY_KEY), false)
  })

  it('ne remplace pas une préférence déjà commune, mais efface l’ancienne clé', () => {
    const storage = memoryStorage({ [LEGACY_KEY]: 'dark', [SUITE_KEY]: 'light' })
    const chosen: ThemePreference[] = []
    assert.equal(
      migrateLegacyPreference(storage, (p) => chosen.push(p)),
      null,
    )
    assert.deepEqual(chosen, [])
    assert.equal(storage.data.has(LEGACY_KEY), false)
  })

  it('ignore une ancienne valeur invalide et ne fait rien sans ancienne clé', () => {
    const invalid = memoryStorage({ [LEGACY_KEY]: 'violet' })
    assert.equal(
      migrateLegacyPreference(invalid, () => assert.fail('ne doit rien choisir')),
      null,
    )
    assert.equal(invalid.data.size, 0)
    assert.equal(
      migrateLegacyPreference(memoryStorage({}), () => assert.fail('ne doit rien choisir')),
      null,
    )
  })

  it('applique la préférence avant l’affichage (script bloquant, avant le point d’entrée)', () => {
    const html = read('../../index.html')
    const theme = html.indexOf('<script src="/atelier-theme.js"></script>')
    assert.ok(theme > 0 && theme < html.indexOf('</head>'), 'atelier-theme.js doit être chargé dans <head>')
    assert.ok(theme < html.indexOf('src="/src/main.tsx"'))
    assert.match(html, /<html[^>]*data-atelier-app="wiki"/)
    assert.match(read('../../public/atelier-theme.js'), /window\.atelierTheme = \{ get: get, set: set/)
  })
})

describe('charte v2 « Linear »', () => {
  it('embarque la marque commune v2 : signature du Wiki et police Inter', () => {
    const brand = read('../styles/atelier-brand/atelier-brand.css')
    assert.match(brand, /--atelier-sig-wiki: #007cbb;/)
    assert.match(brand, /url\("\.\/inter-latin-wght-normal\.woff2"\)/)
    assert.doesNotMatch(brand, /Nunito/)
  })

  it('n’a aucune couleur littérale dans l’interface du Wiki (jetons seulement)', () => {
    for (const file of ['../styles/wiki.css', '../styles/wiki-signature.css']) {
      const css = withoutComments(read(file))
      assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, `${file} : code hexadécimal`)
      assert.doesNotMatch(css, /\b(?:rgba?|hsla?|oklch|oklab)\(/i, `${file} : couleur fonctionnelle`)
    }
  })

  it('n’a ni halo, ni lueur, ni barre de couleur sur le côté', () => {
    const css = withoutComments(read('../styles/wiki.css'))
    assert.doesNotMatch(css, /text-shadow/)
    assert.doesNotMatch(css, /--accent-(?:glow|halo)|--text-glow|--atelier-backdrop/)
    assert.doesNotMatch(css, /inset\s+\d+px\s+0\s+0\s+var\(--accent\)/)
  })
})

/** Déclarations d'une règle CSS (première règle qui porte exactement ce sélecteur, hors requêtes de média). */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`)
  assert.ok(at >= 0, `règle « ${selector} » absente de wiki.css`)
  return css.slice(at, css.indexOf('}', at))
}

describe('barre latérale à la forme de Viz et de Tab', () => {
  const css = withoutComments(read('../styles/wiki.css'))
  const sidebar = read('../components/Sidebar.tsx')
  const header = read('../components/Header.tsx')

  it('a les mesures communes : 232 px, en-tête de 44 px, lignes de 30 px, tuile de marque de 20 px', () => {
    assert.match(css, /--side-w: 232px;/)
    assert.match(css, /--top-h: 44px;/)
    assert.match(rule(css, '.side-head'), /height: var\(--top-h\);/)
    assert.match(rule(css, '.nav-link'), /height: 30px;/)
    assert.match(rule(css, '.tree-row'), /height: 30px;/)
    assert.match(header, /className="atelier-brand__tile atelier-brand__tile--sm"/)
  })

  it('marque l’entrée courante par le fond neutre de la marque commune, jamais par une barre de couleur', () => {
    assert.match(sidebar, /atelier-nav-active/)
    assert.doesNotMatch(css, /border-left:[^;]*var\(--accent/)
    assert.doesNotMatch(rule(css, '.nav-link.atelier-nav-active,\n.nav-link.atelier-nav-active:hover'), /accent/)
  })

  it('garde l’ordre : marque, recherche, zone qui défile (navigation, espace, pages), puis le pied', () => {
    const order = ['className="side-head"', 'className="side-search"', 'className="sidebar__scroll"', 'className="side-nav"', '<SpacePicker />', '<TreeLevel', 'className="side-extra"', 'className="sidebar__foot"', '<UserChip />', '<ThemeSwitch />']
    const at = order.map((mark) => sidebar.indexOf(mark))
    assert.ok(at.every((i) => i > 0), `repères absents : ${order.filter((_m, i) => at[i]! < 0).join(', ')}`)
    assert.deepEqual([...at].sort((a, b) => a - b), at)
    // Seule la zone du milieu défile : l'en-tête, la recherche et le pied gardent leur hauteur.
    for (const fixed of ['.side-head', '.side-search', '.side-extra', '.sidebar__foot']) assert.match(rule(css, fixed), /flex: none;/, fixed)
    assert.match(rule(css, '.sidebar__scroll'), /overflow-y: auto;/)
  })

  it('ne fait jamais naître de barre de défilement horizontale', () => {
    // Cause du défaut vu sur le VPS : le menu des espaces gardait la largeur minimale des menus (240 px), plus large
    // que la zone qui défile (215 px utiles) ; sous Windows une barre horizontale apparaissait à son pied.
    const menu = rule(css, '.space-picker .popover')
    assert.match(menu, /min-width: 0;/)
    assert.match(menu, /left: 0;/)
    assert.match(menu, /right: 0;/)
    assert.doesNotMatch(sidebar, /className="popover" style=/, 'la largeur du menu des espaces est réglée dans wiki.css')
    assert.match(rule(css, '.sidebar__scroll'), /overflow-x: hidden;/)
  })

  it('devient un rail d’icônes sous 1024 px (comme Viz), le panneau complet s’ouvrant par-dessus (comme Tab)', () => {
    assert.ok(css.includes(`@media ${RAIL_QUERY} {`), 'wiki.css et lib/shell.ts doivent partager la même requête')
    assert.match(css, /--rail-w: 48px;/)
    assert.match(css, /\.shell\[data-nav="open"\] \.sidebar \{[^}]*position: fixed;[^}]*width: min\(300px, 85vw\);/)
    assert.match(sidebar, /data-panel-open/)
    assert.match(sidebar, /data-panel-close/)
    // Dans le rail, un libellé masqué reste le nom lu : il n'est jamais retiré par `display: none`.
    assert.match(css, /\.shell\[data-nav="closed"\] \.nav-link \{[^}]*font-size: 0;/)
  })

  it('place le sélecteur de la suite au début de la barre haute, avant le titre (comme Viz)', () => {
    const topbar = header.slice(header.indexOf('export function Topbar'))
    assert.ok(topbar.indexOf('<SuiteSwitcher />') > 0 && topbar.indexOf('<SuiteSwitcher />') < topbar.indexOf('topbar__title'))
    assert.doesNotMatch(sidebar, /SuiteSwitcher/)
  })

  it('un message avec action tient dans la page étroite du rail : l’action passe sous le texte', () => {
    assert.match(rule(css, '.notice'), /flex-wrap: wrap;/)
    assert.match(rule(css, '.notice > div'), /min-width: min\(100%, 200px\);/)
    // Le bouton principal d'un message garde son texte clair (il prenait l'encre du message : noir sur la signature).
    assert.match(css, /\.notice \.btn:not\(\.btn--primary\) \{\s*color: var\(--app-text\);/)
    assert.doesNotMatch(css, /\n\.notice \.btn \{/)
    assert.match(rule(css, '.notice .btn svg'), /color: inherit;/)
  })

  it('donne 40 px aux cibles de la barre latérale au doigt', () => {
    const coarse = css.slice(css.indexOf('@media (pointer: coarse) {'))
    assert.match(coarse, /\.nav-link,\s*\.tree-row,\s*\.search-trigger,\s*\.space-picker__button,[^{]*\{\s*height: 40px;/)
  })
})
