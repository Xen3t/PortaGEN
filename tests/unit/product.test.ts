import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { prepareProduct } from '@/lib/images/product'
import { parseSizeFromProductName } from '@/lib/productName'
import { productInvariance } from '@/lib/images/invariance'

/** « Portail » synthétique : barreaux sombres sur fond blanc (ou transparent). */
async function gateOnWhite(): Promise<Buffer> {
  const bars = Array.from({ length: 8 }, (_, i) => `<rect x="${20 + i * 40}" y="20" width="14" height="160" fill="rgb(55,58,62)"/>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200"><rect width="360" height="200" fill="white"/>${bars}<rect x="10" y="18" width="340" height="10" fill="rgb(55,58,62)"/><rect x="10" y="172" width="340" height="10" fill="rgb(55,58,62)"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

describe('prepareProduct', () => {
  it('détoure un fond blanc uni et ROGNE les marges sur la boîte du produit', async () => {
    const { image, width, height, backgroundRemoved, trimmed } = await prepareProduct(
      await gateOnWhite()
    )
    expect(backgroundRemoved).toBe(true)
    expect(trimmed).toBe(true)
    // Boîte englobante du portail : x 10..349, y 18..181 → 340×164.
    expect(width).toBe(340)
    expect(height).toBe(164)
    const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true })
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]
    expect(alphaAt(0, 0)).toBe(255) // coin du cadre rogné : traverse haute, opaque
    expect(alphaAt(5, 82)).toBe(0) // à gauche du premier barreau : fond supprimé
    expect(alphaAt(15, 82)).toBe(255) // sur le premier barreau : opaque
    // Zone blanche ENCLOSE entre barreaux et traverses : volontairement conservée
    // (comportement conservateur — on ne perce jamais l'intérieur du produit).
    expect(alphaAt(197, 82)).toBe(255)
  })

  it('lit la taille dans la nomenclature des fichiers produit', () => {
    expect(parseSizeFromProductName('VALIER-300B140_FRONT-BLACK_WEB_KIT-000814.png')).toEqual({
      w: 300,
      h: 140,
    })
    expect(parseSizeFromProductName('PRIEL 200H90 TECK STW-000571 WEB LONG.png')).toEqual({
      w: 200,
      h: 90,
    })
    // Coulissants 2027 jusqu'à 600 de large (21/08 — le plafond historique de
    // 500 affichait « taille ? » au dépôt d'un 600C).
    expect(parseSizeFromProductName('EIGER 600C140.png')).toEqual({ w: 600, h: 140 })
    expect(parseSizeFromProductName('portail-moderne.png')).toBeNull()
    expect(parseSizeFromProductName('X-999Z999.png')).toBeNull() // hors bornes plausibles
  })

  it('ne touche pas à une image déjà détourée', async () => {
    const withAlpha = await sharp({
      create: { width: 60, height: 40, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 0.5 } },
    })
      .png()
      .toBuffer()
    const { backgroundRemoved } = await prepareProduct(withAlpha)
    expect(backgroundRemoved).toBe(false)
  })

  it('refuse d’improviser sur un fond non uniforme', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="60" height="80" fill="white"/><rect x="60" width="60" height="80" fill="rgb(30,60,120)"/></svg>`
    const busy = await sharp(Buffer.from(svg)).png().toBuffer()
    const { backgroundRemoved } = await prepareProduct(busy)
    expect(backgroundRemoved).toBe(false)
  })
})

/** Visuel produit synthétique : piliers blancs latéraux + portail sombre, fond transparent. */
async function gateWithPillars(): Promise<Buffer> {
  const bars = Array.from(
    { length: 10 },
    (_, i) => `<rect x="${60 + i * 40}" y="20" width="14" height="160" fill="rgb(50,52,56)"/>`
  ).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="200">
    <rect x="0" y="0" width="50" height="200" fill="rgb(245,245,245)"/>
    <rect x="450" y="0" width="50" height="200" fill="rgb(245,245,245)"/>
    <rect x="60" y="20" width="380" height="12" fill="rgb(50,52,56)"/>
    <rect x="60" y="168" width="380" height="12" fill="rgb(50,52,56)"/>
    ${bars}
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

describe('retrait des piliers du visuel produit', () => {
  it('détecte les piliers blancs latéraux et recadre sur le portail seul', async () => {
    const prep = await prepareProduct(await gateWithPillars(), { removePillars: true })
    expect(prep.pillars?.applied).toBe(true)
    expect(prep.pillars?.reason).toBe('ok')
    expect(prep.pillars?.left?.widthPx).toBe(50)
    expect(prep.pillars?.right?.widthPx).toBe(50)
    // Portail : x 60..439, y 20..179 → 380×160.
    expect(prep.width).toBe(380)
    expect(prep.height).toBe(160)
    expect(prep.annotated).not.toBeNull()
  })

  it('valide la découpe quand le ratio colle à la nomenclature', async () => {
    // 380/160 = 2,375 ≈ 300/126 = 2,381 → découpe appliquée.
    const prep = await prepareProduct(await gateWithPillars(), {
      removePillars: true,
      expectedSize: { w: 300, h: 126 },
    })
    expect(prep.pillars?.applied).toBe(true)
    expect(prep.width).toBe(380)
  })

  it('refuse la découpe si elle donnerait des proportions incohérentes', async () => {
    const prep = await prepareProduct(await gateWithPillars(), {
      removePillars: true,
      expectedSize: { w: 100, h: 100 }, // carré attendu : la découpe (2,375) serait aberrante
    })
    expect(prep.pillars?.applied).toBe(false)
    expect(prep.pillars?.reason).toBe('ratio-degrade')
    expect(prep.width).toBe(500) // image conservée telle quelle
    expect(prep.annotated).not.toBeNull() // mais le visuel de contrôle montre le doute
  })

  it('reste prudent sur un visuel tout blanc (portail blanc : détection ambiguë)', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="220">
      <rect x="10" y="10" width="500" height="200" fill="rgb(250,250,250)"/>
    </svg>`
    const allWhite = await sharp(Buffer.from(svg)).png().toBuffer()
    const prep = await prepareProduct(allWhite, { removePillars: true })
    expect(prep.pillars?.applied).toBe(false)
    expect(prep.pillars?.reason).toBe('ambigu')
    expect(prep.width).toBe(500)
  })

  it('ne touche à rien quand le visuel n’a pas de piliers', async () => {
    const prep = await prepareProduct(await gateOnWhite(), { removePillars: true })
    expect(prep.pillars?.applied).toBe(false)
    expect(prep.pillars?.reason).toBe('aucun-pilier')
    expect(prep.width).toBe(340)
    expect(prep.height).toBe(164)
    expect(prep.annotated).toBeNull()
  })

  it('mesure le dépassement des gonds par rapport aux montants du cadre', async () => {
    // Cadre avec montants pleine hauteur (x 60..73 et 426..439), gonds qui dépassent
    // de 12 px de chaque côté (x 48..59 et 440..451), fond transparent.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="220">
      <rect x="60" y="20" width="14" height="161" fill="rgb(50,52,56)"/>
      <rect x="426" y="20" width="14" height="161" fill="rgb(50,52,56)"/>
      <rect x="60" y="20" width="380" height="12" fill="rgb(50,52,56)"/>
      <rect x="60" y="169" width="380" height="12" fill="rgb(50,52,56)"/>
      <rect x="48" y="50" width="12" height="20" fill="rgb(30,30,30)"/>
      <rect x="48" y="140" width="12" height="20" fill="rgb(30,30,30)"/>
      <rect x="440" y="50" width="12" height="20" fill="rgb(30,30,30)"/>
      <rect x="440" y="140" width="12" height="20" fill="rgb(30,30,30)"/>
      <rect x="245" y="181" width="10" height="12" fill="rgb(30,30,30)"/>
    </svg>`
    const gate = await sharp(Buffer.from(svg)).png().toBuffer()
    const prep = await prepareProduct(gate, { removePillars: true })
    // Boîte englobante : x 48..451 (404 px) — les gonds dépassent de 12 px des montants.
    expect(prep.width).toBe(404)
    expect(prep.frameInsetLeftPx).toBe(12)
    expect(prep.frameInsetRightPx).toBe(12)
    // Tige de verrouillage sous la traverse basse : 12 px sous le bas des vantaux.
    expect(prep.frameInsetBottomPx).toBe(12)
  })

  it('sans l’option, le comportement historique est inchangé', async () => {
    const prep = await prepareProduct(await gateWithPillars())
    expect(prep.pillars).toBeNull()
    expect(prep.width).toBe(500)
  })
})

describe('productInvariance', () => {
  const zone = { x: 40, y: 20, w: 280, h: 160 }

  it('score ≈ 1 pour la même image, et reste haut après un changement d’exposition', async () => {
    const ref = await gateOnWhite()
    const same = await productInvariance(ref, ref, zone)
    expect(same.score).toBeGreaterThan(0.98)
    expect(same.ok).toBe(true)

    const brighter = await sharp(ref).modulate({ brightness: 1.18 }).png().toBuffer()
    const lit = await productInvariance(ref, brighter, zone)
    expect(lit.score).toBeGreaterThan(0.9)
    expect(lit.ok).toBe(true)
  })

  it('score bas si le produit a été redessiné (structure différente)', async () => {
    const ref = await gateOnWhite()
    // « Redessiné » : barreaux horizontaux au lieu de verticaux.
    const barsH = Array.from({ length: 5 }, (_, i) => `<rect x="20" y="${30 + i * 30}" width="320" height="12" fill="rgb(55,58,62)"/>`).join('')
    const redrawnSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200"><rect width="360" height="200" fill="white"/>${barsH}</svg>`
    const redrawn = await sharp(Buffer.from(redrawnSvg)).png().toBuffer()
    const res = await productInvariance(ref, redrawn, zone)
    expect(res.score).toBeLessThan(0.5)
    expect(res.ok).toBe(false)
  })
})
