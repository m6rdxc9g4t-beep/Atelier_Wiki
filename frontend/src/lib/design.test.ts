import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

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
