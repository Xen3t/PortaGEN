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

  // Régression du 24/07/2026 (décor XL vogel, job #153) : trottoir dessiné à
  // +10,5 % de la hauteur sous le Canny, hors de la fenêtre standard ±5 %. Dans
  // la petite fenêtre, les joints du pavage de l'allée « répondent » sur les 3
  // bandes → la mesure annonçait un faux +16 px. La fenêtre XL ±15 % doit
  // retrouver la vraie dérive (le vrai motif, plus contrasté, gagne au score).
  it('fenêtre XL ±15 % : retrouve la vraie dérive +10,5 % là où ±5 % cale sur les joints d’allée', async () => {
    const { bandPatternShift } = await import('@/lib/images/analyze')
    const h = 1000
    const bands = [0.617, 0.675, 0.696]
    const profile = new Array(h).fill(1)
    for (const b of bands) profile[Math.round(b * h) + 105] = 60 // vrai trottoir à +10,5 %
    for (const b of bands) profile[Math.round(b * h) + 12] = 20 // joints d'allée, faibles mais nets
    const narrow = bandPatternShift(profile, bands)
    expect(narrow).not.toBeNull()
    expect(Math.round(narrow!.shiftNorm * h)).toBe(12) // le mensonge documenté
    const wide = bandPatternShift(profile, bands, 0.15)
    expect(wide).not.toBeNull()
    expect(Math.round(wide!.shiftNorm * h)).toBe(105) // la vérité avec la fenêtre XL
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

describe('groundBandShift', () => {
  // Profil reproduisant la 1re gamme XL du 22/07/2026 (jobs #136-148) : le décor
  // dessine un trottoir plus FIN que le Canny — bord haut descendu de +16 lignes,
  // bordure route quasi en place. Bandes du Canny XL : 0.617 / 0.675 / 0.696.
  const bandesXl = [0.617, 0.675, 0.696]
  const profilXlCompresse = () => {
    const profile = new Array(1000).fill(1)
    profile[633] = 26 // bord haut du trottoir, descendu (617 + 16)
    profile[674] = 18 // ligne intermédiaire, quasi en place
    profile[688] = 55 // bordure trottoir/route, très contrastée
    profile[694] = 34 // bas de bordure
    return profile
  }

  it('cale sur le bord d’ancrage même quand le motif est compressé (bug XL du 22/07)', async () => {
    const { groundBandShift, bandPatternShift } = await import('@/lib/images/analyze')
    const h = 1000
    const profile = profilXlCompresse()
    // Le motif complet ne colle nulle part : la mesure historique ne trouve rien
    // (sur le décor réel elle trouvait pire : un compromis sur la bordure route).
    expect(bandPatternShift(profile, bandesXl)).toBeNull()
    const match = groundBandShift(profile, bandesXl)
    expect(match).not.toBeNull()
    expect(Math.round(match!.shiftNorm * h)).toBe(16) // posé sur le bord haut réel
  })

  it('retourne null sans bord net à l’ancrage', async () => {
    const { groundBandShift } = await import('@/lib/images/analyze')
    expect(groundBandShift(new Array(1000).fill(1), bandesXl)).toBeNull()
  })

  it('refuse un ancrage que les bandes basses ne confirment pas (garde du 11/07)', async () => {
    const { groundBandShift } = await import('@/lib/images/analyze')
    const profile = new Array(1000).fill(1)
    profile[627] = 50 // un seul bord net à l'ancrage (+10), rien en dessous
    expect(groundBandShift(profile, bandesXl)).toBeNull()
  })

  it('rejette un calage collé à la borne de recherche', async () => {
    const { groundBandShift } = await import('@/lib/images/analyze')
    const h = 1000
    const window = Math.round(0.05 * h)
    const profile = new Array(h).fill(1)
    for (const b of bandesXl) profile[Math.round(b * h) + window] = 50 // motif PILE à la borne
    expect(groundBandShift(profile, bandesXl)).toBeNull()
  })

  it('retrouve un décalage simple quand le motif est intact (comportement standard)', async () => {
    const { groundBandShift } = await import('@/lib/images/analyze')
    const h = 1000
    const profile = new Array(h).fill(1)
    for (const b of bandesXl) profile[Math.round(b * h) + 23] = 50 // motif entier décalé de +23
    const match = groundBandShift(profile, bandesXl)
    expect(match).not.toBeNull()
    expect(Math.round(match!.shiftNorm * h)).toBe(23)
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
