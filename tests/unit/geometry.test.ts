import { describe, it, expect } from 'vitest'
import {
  clampRect,
  computeLayout,
  effectiveHeights,
  projection,
  projectRect,
  sizeMetadata,
  gendarmePathD,
  DEFAULT_PARAMS,
} from '@/lib/geometry'

// Valeurs attendues calculées à la main, paramètres par défaut :
// sceneH=320, mesAspect=2000/1330 → sceneW=round(481.203)=481 ; groundLine=246.
// Hauteurs pilier/muret interpolées entre les réglages petite taille (portail 100)
// et grande taille (portail 200) — défauts : pilier 122→222 cm, muret 85→155 cm.

describe('computeLayout — taille 300x120, paramètres par défaut', () => {
  const L = computeLayout({ w: 300, h: 120 })

  it('calcule la scène et la ligne de sol', () => {
    expect(L.sceneW).toBe(481)
    expect(L.sceneH).toBe(320)
    expect(L.groundLine).toBe(246)
  })

  it('place le portail centré, posé au sol', () => {
    expect(L.gateLeft).toBeCloseTo(90.5, 10)
    expect(L.gateTop).toBe(126)
    expect(L.gateW).toBe(300)
    expect(L.gateH).toBe(120)
  })

  it('dimensionne les piliers (interpolés : 122 + 0,2 × 100 = 142 cm)', () => {
    expect(L.pillarLeft).toMatchObject({ x: 60.5, y: 104, w: 30, h: 142 })
    expect(L.pillarRight).toMatchObject({ x: 390.5, y: 104, w: 30, h: 142 })
    expect(L.pillarLeft.clamped).toBe(false)
  })

  it('pose un chapeau plat débordant de 4 cm de chaque côté', () => {
    expect(L.capLeft).not.toBeNull()
    expect(L.capLeft!.style).toBe('flat')
    expect(L.capLeft!.bbox).toMatchObject({ x: 56.5, y: 96, w: 38, h: 8 })
  })

  it('étend les murets jusqu’aux bords avec chevauchement de 1 cm sous les piliers', () => {
    // Muret interpolé : 85 + 0,2 × 70 = 99 cm → y = 246 − 99 = 147.
    expect(L.muretLeft).not.toBeNull()
    expect(L.muretLeft!.x).toBe(0)
    expect(L.muretLeft!.w).toBeCloseTo(61.5, 10)
    expect(L.muretLeft!.y).toBeCloseTo(147, 10)
    expect(L.muretLeft!.h).toBeCloseTo(99, 10)
    expect(L.muretRight!.x).toBeCloseTo(419.5, 10)
    expect(L.muretRight!.w).toBeCloseTo(61.5, 10)
  })

  it('ne signale aucun débordement', () => {
    expect(L.isClamped).toBe(false)
  })
})

describe('computeLayout — options', () => {
  it('capStyle none → pas de chapeaux', () => {
    const L = computeLayout({ w: 300, h: 120 }, { capStyle: 'none' })
    expect(L.capLeft).toBeNull()
    expect(L.capRight).toBeNull()
  })

  it('muretEnabled false → pas de murets', () => {
    const L = computeLayout({ w: 300, h: 120 }, { muretEnabled: false })
    expect(L.muretLeft).toBeNull()
    expect(L.muretRight).toBeNull()
  })

  it('chapeau gendarme : 18 cm de haut, débord 4 cm', () => {
    const L = computeLayout({ w: 300, h: 120 }, { capStyle: 'gendarme' })
    expect(L.capLeft!.bbox).toMatchObject({ x: 56.5, y: 86, w: 38, h: 18 })
  })

  it('offsetX décale le portail sans changer sa largeur', () => {
    const L = computeLayout({ w: 300, h: 120 }, { offsetX: 20 })
    expect(L.gateLeft).toBeCloseTo(110.5, 10)
    expect(L.pillarLeft.x).toBeCloseTo(80.5, 10)
  })
})

describe('computeLayout — hauteurs pilier/muret découplées (décision du 11/07/2026)', () => {
  const params = { pillarHMin: 150, pillarHMax: 210, muretHMin: 90, muretHMax: 110 }

  it('applique les réglages aux deux extrémités de la gamme', () => {
    const small = computeLayout({ w: 300, h: 100 }, params)
    const large = computeLayout({ w: 300, h: 200 }, params)
    expect(small.pillarLeft.h).toBe(150)
    expect(small.muretLeft!.h).toBe(90)
    expect(large.pillarLeft.h).toBe(210)
    expect(large.muretLeft!.h).toBe(110)
  })

  it('interpole linéairement les tailles intermédiaires', () => {
    const L = computeLayout({ w: 300, h: 150 }, params)
    expect(L.pillarLeft.h).toBe(180)
    expect(L.muretLeft!.h).toBe(100)
  })

  it('borne l’interpolation aux extrémités hors gamme', () => {
    expect(effectiveHeights(80, params)).toEqual({ pillarH: 150, muretH: 90 })
    expect(effectiveHeights(250, params)).toEqual({ pillarH: 210, muretH: 110 })
  })

  it('une hauteur imposée (dérogation par taille) court-circuite l’interpolation', () => {
    const L = computeLayout({ w: 300, h: 150 }, { ...params, pillarH: 195, muretH: 80 })
    expect(L.pillarLeft.h).toBe(195)
    expect(L.muretLeft!.h).toBe(80)
  })
})

describe('computeLayout — débordements (clamping)', () => {
  it('scène resserrée : un 400x200 déborde fortement et est signalé', () => {
    const L = computeLayout({ w: 400, h: 200 }, { sceneH: 280 })
    // sceneW=round(280×2000/1330)=421 ; gateLeft=10.5 ; lpX=-19.5 ; pTop=206-222=-16
    expect(L.sceneW).toBe(421)
    expect(L.pillarLeft).toMatchObject({ x: 0, y: 0 })
    expect(L.pillarLeft.w).toBeCloseTo(10.5, 10)
    expect(L.pillarLeft.h).toBe(206)
    expect(L.pillarLeft.lossX).toBeCloseTo(19.5, 10)
    expect(L.pillarLeft.lossY).toBe(16)
    // Plus de place pour les murets de part et d'autre
    expect(L.muretLeft).toBeNull()
    expect(L.muretRight).toBeNull()
    expect(L.isClamped).toBe(true)
  })

  it('tolérance 5 cm sur les portails 4 m : petit débord non signalé', () => {
    // offsetX -11.5 → lpX = -1 : pilier déborde de 1 cm, son chapeau (débord +4 cm) de 5 cm.
    // Le max des pertes (5) reste ≤ tolérance → pas d'alerte, bien que les rects soient tronqués.
    const L = computeLayout({ w: 400, h: 200 }, { offsetX: -11.5 })
    expect(L.pillarLeft.clamped).toBe(true)
    expect(L.pillarLeft.lossX).toBeCloseTo(1, 10)
    expect(L.capLeft!.bbox.lossX).toBeCloseTo(5, 10)
    expect(L.isClamped).toBe(false)
  })

  it('pas de tolérance hors 4 m : tout débord est signalé', () => {
    const L = computeLayout({ w: 300, h: 120 }, { offsetX: -90 })
    expect(L.pillarLeft.lossX).toBeCloseTo(29.5, 10)
    expect(L.isClamped).toBe(true)
  })
})

describe('clampRect', () => {
  it('ne modifie pas un rect entièrement dans le cadre', () => {
    const r = clampRect({ x: 10, y: 10, w: 50, h: 50 }, 100, 100)
    expect(r).toMatchObject({ x: 10, y: 10, w: 50, h: 50, clamped: false, lossX: 0, lossY: 0 })
  })

  it('tronque et mesure la perte sur chaque axe', () => {
    const r = clampRect({ x: -10, y: 90, w: 30, h: 30 }, 100, 100)
    expect(r).toMatchObject({ x: 0, y: 90, w: 20, h: 10, clamped: true, lossX: 10, lossY: 20 })
  })
})

describe('projection & projectRect — mode stretch vers 2000×1330', () => {
  const L = computeLayout({ w: 300, h: 120 })
  const p = projection(2000, 1330, L.sceneW, L.sceneH)

  it('calcule les échelles du mockup', () => {
    expect(p.sx).toBeCloseTo(2000 / 481, 12)
    expect(p.sy).toBeCloseTo(1330 / 320, 12)
    expect(p.ox).toBe(0)
    expect(p.oy).toBe(0)
  })

  it('projette la zone portail en pixels entiers', () => {
    const gate = projectRect({ x: L.gateLeft, y: L.gateTop, w: L.gateW, h: L.gateH }, p)
    expect(gate).toMatchObject({ x: 376, y: 524, w: 1247, h: 499 })
  })

  it('projette le pilier gauche en pixels entiers', () => {
    const px = projectRect(L.pillarLeft, p)
    expect(px).toMatchObject({ x: 252, y: 432, w: 125, h: 590 })
  })
})

describe('sizeMetadata — équivalent du metadata.json du mockup', () => {
  it('produit les coordonnées pixel complètes pour 300x120 en 2000×1330', () => {
    const m = sizeMetadata({ w: 300, h: 120 }, {}, 2000, 1330)
    expect(m.size).toBe('300x120')
    expect(m.sceneW).toBe(481)
    expect(m.elements.portal).toMatchObject({ x: 376, y: 524, w: 1247, h: 499 })
    expect(m.elements.pillarLeft).toMatchObject({ x: 252, y: 432, w: 125, h: 590 })
    expect(m.elements.capLeft).toMatchObject({ style: 'flat' })
    expect(m.elements.muretLeft).not.toBeNull()
  })

  it('reste cohérent quel que soit le format de sortie (règle taille native)', () => {
    const a = sizeMetadata({ w: 300, h: 120 }, {}, 5056, 3392)
    // La zone portail garde ses proportions relatives (~62 % de la largeur en cm → en px)
    expect(a.elements.portal.w / 5056).toBeCloseTo(300 / 481, 2)
  })
})

describe('gendarmePathD', () => {
  it('trace base droite + dôme dans la bbox fournie', () => {
    const d = gendarmePathD({ x: 100, y: 50, w: 40, h: 18 })
    expect(d).toContain('M 100 68')
    expect(d).toContain('A 20')
    expect(d.endsWith('Z')).toBe(true)
  })
})

describe('DEFAULT_PARAMS', () => {
  it('reproduit le rendu historique aux deux extrémités de la gamme', () => {
    expect(DEFAULT_PARAMS).toMatchObject({
      pillarWidth: 30,
      pillarHMin: 122,
      pillarHMax: 222,
      capStyle: 'flat',
      muretEnabled: true,
      muretHMin: 85,
      muretHMax: 155,
      gateHMin: 100,
      gateHMax: 200,
      groundY: 74,
      sceneH: 320,
      offsetX: 0,
    })
  })
})
