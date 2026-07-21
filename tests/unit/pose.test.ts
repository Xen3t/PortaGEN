import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { nettoyerProduit, poseCible, poserProduit, choisirProduit } from '@/lib/images/pose'

/**
 * Produit synthétique reproduisant le défaut des PNG fournisseur : un portail opaque
 * au centre, entouré de pixels fantômes quasi blancs d'alpha faible (restes des
 * piliers du rendu) qui gonflent la boîte englobante.
 */
async function produitAvecFantomes(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
    <rect x="0" y="0" width="200" height="100" fill="rgb(250,250,250)" fill-opacity="0.35"/>
    <rect x="40" y="20" width="120" height="60" fill="rgb(55,58,62)"/>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

describe('nettoyerProduit', () => {
  it('supprime les pixels fantômes et rogne sur le vrai portail', async () => {
    const { image, width, height, bbox } = await nettoyerProduit(await produitAvecFantomes())
    // Sans nettoyage la boîte ferait 200×100 ; nettoyée elle colle au rect opaque.
    expect(width).toBe(120)
    expect(height).toBe(60)
    expect(bbox).toEqual({ minX: 40, minY: 20, maxX: 159, maxY: 79 })
    const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true })
    // Tous les pixels conservés sont soit pleinement opaques, soit alpha 0 — plus de fantômes.
    for (let i = 3; i < data.length; i += info.channels) {
      expect(data[i] === 0 || data[i] >= 200).toBe(true)
    }
  })

  it('répare les pieds alu troués par l’alpha fournisseur, sans reboucher le blanc ni les piliers fantômes', async () => {
    // Produit synthétique : un montant opaque, sous lui un « pied » gris à alpha 0
    // (trou du détourage fournisseur), un liseré fantôme dont la colonne ne porte
    // qu'un gond de 3 px, et du fond blanc à alpha 0 partout ailleurs.
    const W = 200
    const H = 150
    const px = Buffer.alloc(W * H * 4)
    const put = (x: number, y: number, r: number, g: number, b: number, a: number) => {
      const o = (y * W + x) * 4
      px[o] = r
      px[o + 1] = g
      px[o + 2] = b
      px[o + 3] = a
    }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) put(x, y, 252, 252, 252, 0) // fond studio blanc
    for (let y = 10; y <= 120; y++)
      for (let x = 40; x <= 80; x++) put(x, y, 55, 58, 62, 255) // montant opaque
    for (let y = 121; y <= 140; y++)
      for (let x = 50; x <= 70; x++) put(x, y, 190, 190, 195, 0) // pied alu troué
    for (let y = 100; y <= 140; y++)
      for (let x = 10; x <= 20; x++) put(x, y, 235, 235, 235, 0) // liseré pilier fantôme
    for (let y = 60; y <= 62; y++)
      for (let x = 10; x <= 20; x++) put(x, y, 60, 60, 60, 255) // gond (3 px de haut)
    const input = await sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer()

    const p = await nettoyerProduit(input)
    // Le pied est restauré (21×20 px), le liseré et le fond ne le sont pas.
    expect(p.alphaReparePx).toBe(21 * 20)
    const { data, info } = await sharp(p.image).raw().toBuffer({ resolveWithObject: true })
    const alphaAt = (x: number, y: number) =>
      data[((y - p.bbox.minY) * info.width + (x - p.bbox.minX)) * 4 + 3]
    expect(alphaAt(60, 130)).toBe(255) // cœur du pied : matière restaurée
    expect(alphaAt(15, 130)).toBe(0) // liseré pilier : toujours transparent
    expect(alphaAt(30, 130)).toBe(0) // fond blanc : toujours transparent
    expect(p.bbox.maxY).toBe(140) // la boîte descend jusqu'au bas du pied
  })

  it('ne rebouche pas un interstice d’ajouré (fond blanc visible entre traverses)', async () => {
    // Deux traverses opaques pleine largeur, interstice BLANC entre elles, dans la bande basse.
    const W = 200
    const H = 100
    const px = Buffer.alloc(W * H * 4)
    for (let i = 0; i < W * H; i++) {
      px[i * 4] = 251
      px[i * 4 + 1] = 251
      px[i * 4 + 2] = 251
      px[i * 4 + 3] = 0
    }
    const bar = (y0: number, y1: number) => {
      for (let y = y0; y <= y1; y++)
        for (let x = 20; x <= 180; x++) {
          const o = (y * W + x) * 4
          px[o] = 55
          px[o + 1] = 58
          px[o + 2] = 62
          px[o + 3] = 255
        }
    }
    bar(10, 80)
    bar(90, 95) // traverse basse — l'interstice 81..89 est dans la bande basse
    const input = await sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer()
    const p = await nettoyerProduit(input)
    expect(p.alphaReparePx).toBe(0)
    const { data, info } = await sharp(p.image).raw().toBuffer({ resolveWithObject: true })
    const alphaAt = (x: number, y: number) =>
      data[((y - p.bbox.minY) * info.width + (x - p.bbox.minX)) * 4 + 3]
    expect(alphaAt(100, 85)).toBe(0) // l'interstice reste percé
  })

  it('répare un pied CRAMÉ (RGB fantôme blanc) via sa poche enclavée, sans toucher ajouré ni pilier', async () => {
    // Constat du 21/07 (Eiger 300B140) : le pied alu surexposé a un RGB fantôme
    // BLANC — la passe couleur ne récupère rien. Seul son LISERÉ semi-transparent
    // (alpha 120) trace le contour. Témoins à ne PAS reboucher : une découpe
    // d'ajouré enclavée dans la bande basse (ne touche pas le bas), un pilier
    // fantôme creux (aucune matière au-dessus de ses colonnes).
    const W = 300
    const H = 160
    const px = Buffer.alloc(W * H * 4)
    const put = (x0: number, x1: number, y0: number, y1: number, v: number, a: number) => {
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const o = (y * W + x) * 4
          px[o] = v
          px[o + 1] = v
          px[o + 2] = v
          px[o + 3] = a
        }
    }
    put(0, W - 1, 0, H - 1, 252, 0) // fond studio blanc
    put(40, 80, 10, 130, 55, 255) // montant gauche
    put(220, 260, 10, 130, 55, 255) // montant droit
    // Pied cramé sous le montant gauche : intérieur BLANC à alpha 0…
    put(50, 70, 131, 150, 250, 0)
    // …fermé par un liseré alpha 120 (murs + bas ; le montant scelle le haut).
    put(48, 49, 131, 152, 235, 120)
    put(71, 72, 131, 152, 235, 120)
    put(48, 72, 151, 152, 235, 120)
    // Témoin ajouré : découpe blanche ENCLAVÉE dans un panneau, dans la bande basse.
    put(100, 180, 100, 130, 55, 255)
    put(130, 150, 116, 122, 252, 0)
    // Témoin pilier fantôme creux : anneau alpha 60, intérieur alpha 0 jusqu'en bas,
    // aucune matière opaque au-dessus de ses colonnes.
    put(270, 290, 115, 119, 240, 60)
    put(270, 274, 115, 154, 240, 60)
    put(286, 290, 115, 154, 240, 60)
    put(270, 290, 153, 154, 240, 60)
    put(275, 285, 120, 152, 250, 0)
    const input = await sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer()

    const p = await nettoyerProduit(input)
    // Liseré (130 px, passe couleur) + intérieur du pied (21×20 px, poche enclavée) —
    // rien d'autre : ni la découpe d'ajouré, ni le pilier fantôme.
    expect(p.alphaReparePx).toBe(130 + 21 * 20)
    const { data, info } = await sharp(p.image).raw().toBuffer({ resolveWithObject: true })
    const alphaAt = (x: number, y: number) =>
      data[((y - p.bbox.minY) * info.width + (x - p.bbox.minX)) * 4 + 3]
    expect(alphaAt(60, 140)).toBe(255) // cœur du pied cramé : restauré
    expect(alphaAt(48, 140)).toBe(255) // liseré : redevenu matière
    expect(alphaAt(140, 119)).toBe(0) // découpe d'ajouré : toujours percée
    expect(p.bbox.maxY).toBe(152) // la boîte descend jusqu'au bas du liseré
    expect(p.bbox.maxX).toBe(260) // le pilier fantôme n'est pas devenu matière

    // Passe coupée (coulissant : une lame n'a pas de pieds) : seule la passe
    // couleur agit (liseré, 130 px), la poche cramée reste percée.
    const sans = await nettoyerProduit(input, undefined, false)
    expect(sans.alphaReparePx).toBe(130)
  })

  it('refuse un produit entièrement fantôme (rien au-dessus du seuil)', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50">
      <rect width="50" height="50" fill="white" fill-opacity="0.3"/>
    </svg>`
    const ghost = await sharp(Buffer.from(svg)).png().toBuffer()
    await expect(nettoyerProduit(ghost)).rejects.toThrow(/transparent/)
  })
})

describe('poseCible', () => {
  it('élargit du débordement par côté et ancre le bas sur la ligne de sol', () => {
    const gate = { x: 1000, y: 500, w: 2000, h: 1200 }
    const cible = poseCible(gate, 0.02)
    expect(cible.w).toBe(2080) // 2000 × (1 + 2×2 %)
    expect(cible.h).toBe(1200) // hauteur nominale, pas de débordement vertical
    expect(cible.x).toBe(960) // 1000 − 2 % de 2000
    expect(cible.y + cible.h).toBe(gate.y + gate.h) // bas inchangé = ligne de sol
  })
})

describe('poserProduit', () => {
  it('étire librement le produit nettoyé sur la cible et le colle sur la base', async () => {
    const base = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 220, b: 240 } },
    })
      .png()
      .toBuffer()
    const gate = { x: 100, y: 80, w: 200, h: 150 }
    const { image, cible } = await poserProduit(base, await produitAvecFantomes(), gate, {
      debord: 0.02,
    })
    expect(cible).toEqual({ x: 96, y: 80, w: 208, h: 150 })
    const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const px = (x: number, y: number) => {
      const o = (y * info.width + x) * info.channels
      return [data[o], data[o + 1], data[o + 2]]
    }
    // Au centre de la cible : le portail sombre (étiré largeur/hauteur indépendantes).
    expect(px(200, 155)).toEqual([55, 58, 62])
    // Juste à l'extérieur de la cible : la base intacte — les fantômes n'ont pas débordé.
    expect(px(90, 155)).toEqual([200, 220, 240])
    expect(px(200, 240)).toEqual([200, 220, 240])
  })
})

describe('choisirProduit', () => {
  const produits = [
    { file: '300B115', w: 300, h: 115 },
    { file: '300B140', w: 300, h: 140 },
    { file: '400B115', w: 400, h: 115 },
  ]

  it('exige la même largeur et prend la hauteur la plus proche', () => {
    expect(choisirProduit(produits, { w: 300, h: 100 })?.file).toBe('300B115')
    expect(choisirProduit(produits, { w: 400, h: 100 })?.file).toBe('400B115')
    expect(choisirProduit(produits, { w: 300, h: 140 })?.file).toBe('300B140')
  })

  it('retourne null si aucune largeur ne correspond', () => {
    expect(choisirProduit(produits, { w: 350, h: 140 })).toBeNull()
  })
})
