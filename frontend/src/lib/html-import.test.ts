import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { convertEmbeddedHtml, hasEmbeddedHtml, htmlToMarkdown, isRichHtml, openProjectImages } from './html-import.ts'

// Extrait réel d'une page OpenProject copiée dans le Wiki (Markdown + HTML d'OpenProject).
const OPENPROJECT = [
  '## 1\\. Vue d’ensemble',
  '',
  'Le flux suit une **nomenclature par couche** : voir [[Module Finance]].',
  '',
  '<img class="op-uc-image op-uc-image_inline" src="/api/v3/attachments/828/content">',
  '',
  'La nomenclature des couches est la suivante :',
  '',
  '<figure class="table op-uc-figure"><table class="op-uc-table"><thead class="op-uc-table--head"><tr class="op-uc-table--row">' +
    '<th class="op-uc-table--cell op-uc-table--cell_head"><p class="op-uc-p">Préfixe</p></th>' +
    '<th class="op-uc-table--cell op-uc-table--cell_head"><p class="op-uc-p">Rôle</p></th></tr></thead><tbody>' +
    '<tr class="op-uc-table--row"><td class="op-uc-table--cell"><p class="op-uc-p"><strong>SRC</strong></p></td>' +
    '<td class="op-uc-table--cell"><p class="op-uc-p">Système d’origine (SharePoint | SQL Server)</p></td></tr></tbody></table></figure>',
  '',
  '```html',
  '<b>exemple de code</b>',
  '```',
  '',
].join('\n')

describe('import depuis OpenProject', () => {
  it('repère le HTML hors code', () => {
    assert.equal(hasEmbeddedHtml(OPENPROJECT), true)
    assert.equal(hasEmbeddedHtml('Texte\n\n```html\n<b>code</b>\n```\n\n`<i>`'), false)
  })

  it('convertit chaque bloc HTML en Markdown sans toucher au reste ni au code', () => {
    const { text, blocks } = convertEmbeddedHtml(OPENPROJECT)
    assert.equal(blocks, 2)
    assert.equal(
      text,
      [
        '## 1\\. Vue d’ensemble',
        '',
        'Le flux suit une **nomenclature par couche** : voir [[Module Finance]].',
        '',
        '![Image OpenProject 828 à recoller](/api/v3/attachments/828/content)',
        '',
        'La nomenclature des couches est la suivante :',
        '',
        '| Préfixe | Rôle |',
        '| --- | --- |',
        '| **SRC** | Système d’origine (SharePoint \\| SQL Server) |',
        '',
        '```html',
        '<b>exemple de code</b>',
        '```',
        '',
      ].join('\n'),
    )
    assert.equal(hasEmbeddedHtml(text), false)
  })

  it('liste les images restées sur OpenProject', () => {
    assert.deepEqual(openProjectImages(OPENPROJECT), [828])
    assert.deepEqual(openProjectImages('![a](/api/v3/attachments/9/content) ![b](/api/v3/attachments/9/content) ![c](/api/attachments/1/x.png)'), [9])
  })
})

describe('coller du texte mis en forme', () => {
  it('ne convertit que du vrai contenu mis en forme', () => {
    assert.equal(isRichHtml('<table><tr><td>a</td></tr></table>'), true)
    assert.equal(isRichHtml('<h2>Titre</h2>'), true)
    // Code copié depuis un éditeur : des <div>/<span> colorés, pas de mise en forme à garder.
    assert.equal(isRichHtml('<div style="color: #d4d4d4"><span>const a = 1</span></div>'), false)
  })

  it('HTML → Markdown : titres, gras, listes, liens ; le texte est échappé', () => {
    assert.equal(
      htmlToMarkdown('<h2>Titre</h2><p>Un <b>gras</b>, 2*3 et <a href="https://exemple.fr">un lien</a></p><ul><li>a</li><li>b</li></ul><script>alert(1)</script>'),
      '## Titre\n\nUn **gras**, 2\\*3 et [un lien](https://exemple.fr)\n\n- a\n- b',
    )
  })
})
