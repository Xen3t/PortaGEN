import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { gabaritSvg, renderGabaritPng, overlayGabaritOnDecor, gabaritMask } from '@/lib/images/gabarits'

describe('gabaritSvg', () => {
  it('contient piliers + murets en aplats #888888 et chapeaux plats', () => {
    const svg = gabaritSvg({ w: 300, h: 140 }, {}, 2528, 1696)
    const rects = svg.match(/<rect /g) ?? []
    // 2 piliers + 2 murets + 2 chapeaux plats = 6 rects
    expect(rects.length).toBe(6)
    expect(svg).toContain('#888888')
    expect(svg).not.toContain('<path') // chapeaux plats → pas de dôme
  })

  it('rend les chapeaux gendarme en path (dôme)', () => {
    const svg = gabaritSvg({ w: 300, h: 140 }, { capStyle: 'gendarme' }, 2528, 1696)
    expect((svg.match(/<path /g) ?? []).length).toBe(2)
  })

  it('sans muret : seulement 2 piliers + 2 chapeaux', () => {
    const svg = gabaritSvg({ w: 300, h: 140 }, { muretEnabled: false }, 2528, 1696)
    expect((svg.match(/<rect /g) ?? []).length).toBe(4)
  })
})

describe('renderGabaritPng / overlayGabaritOnDecor', () => {
  it('produit un PNG aux dimensions demandées', async () => {
    const png = await renderGabaritPng({ w: 300, h: 140 }, {}, 1264, 848)
    const meta = await sharp(png).metadata()
    expect(meta.width).toBe(1264)
    expect(meta.height).toBe(848)
    expect(meta.channels).toBe(4) // transparence hors aplats
  })

  it('superpose les aplats sans changer les dimensions du décor', async () => {
    const decor = await sharp({
      create: { width: 632, height: 424, channels: 3, background: { r: 120, g: 160, b: 200 } },
    })
      .png()
      .toBuffer()
    const { image, width, height } = await overlayGabaritOnDecor(decor, { w: 300, h: 140 }, {})
    expect(width).toBe(632)
    expect(height).toBe(424)
    const meta = await sharp(image).metadata()
    expect(meta.width).toBe(632)
    expect(meta.height).toBe(424)
  })
})

describe('bandPatternShift', () => {
  it('retrouve un décalage synthétique du motif de bandes', async () => {
    const { bandPatternShift } = await import('@/lib/images/analyze')
    const h = 1000
    const bands = [0.77, 0.84, 0.87]
    const shiftPx = 23
    const profile = new Array(h).fill(1)
    for (const b of bands) profile[Math.round(b * h) + shiftPx] = 50 // pics décalés de +23 lignes
    const match = bandPatternShift(profile, bands, 0.1)
    expect(match).not.toBeNull()
    expect(Math.round(match!.shiftNorm * h)).toBe(shiftPx)
  })

  it('retourne null quand le motif est absent', async () => {
    const { bandPatternShift } = await import('@/lib/images/analyze')
    const profile = new Array(1000).fill(1) // aucun pic
    expect(bandPatternShift(profile, [0.77, 0.84, 0.87], 0.1)).toBeNull()
  })

  // Régression du bug du 11/07/2026 : un pic parasite ne doit plus porter le score.
  it('ignore un pic parasite isolé dans la fenêtre : chaque bande doit répondre', async () => {
    const { bandPatternShift } = await import('@/lib/images/analyze')
    const h = 1000
    const bands = [0.77, 0.84, 0.87]
    const profile = new Array(h).fill(1)
    for (const b of bands) profile[Math.round(b * h) + 5] = 50 // vrai motif à +5
    profile[Math.round(bands[0] * h) + 10] = 500 // parasite énorme sur UNE seule bande
    const match = bandPatternShift(profile, bands)
    expect(match).not.toBeNull()
    expect(Math.round(match!.shiftNorm * h)).toBe(5) // le parasite n'a pas gagné
  })

  it('rend null quand le meilleur score colle à la borne de recherche (rejet du 11/07)', async () => {
    const { bandPatternShift } = await import('@/lib/images/analyze')
    const h = 1000
    const bands = [0.77, 0.84, 0.87]
    const window = Math.round(0.05 * h)
    const profile = new Array(h).fill(1)
    for (const b of bands) profile[Math.round(b * h) + window] = 50 // motif PILE à la borne
    expect(bandPatternShift(profile, bands)).toBeNull()
  })

  it('calcule son seuil de bruit sur la moitié INFÉRIEURE : le haut chargé ne fait pas échouer', async () => {
    const { bandPatternShift } = await import('@/lib/images/analyze')
    const h = 1000
    const bands = [0.77, 0.84, 0.87]
    const profile = new Array(h).fill(1)
    for (let y = 0; y < h / 2; y++) profile[y] = 100 // haut très texturé (végétation, façade)
    for (const b of bands) profile[Math.round(b * h) + 3] = 50 // motif net en bas, à +3
    const match = bandPatternShift(profile, bands)
    expect(match).not.toBeNull()
    expect(Math.round(match!.shiftNorm * h)).toBe(3)
  })
})

describe('gabaritMask', () => {
  it('génère un masque binaire avec zones blanches dilatées', async () => {
    const mask = await gabaritMask({ w: 300, h: 140 }, {}, 1264, 848, 24)
    const stats = await sharp(mask).greyscale().stats()
    // Le masque contient du noir (fond) ET du blanc (zones éditées)
    expect(stats.channels[0].min).toBe(0)
    expect(stats.channels[0].max).toBe(255)
  })
})
