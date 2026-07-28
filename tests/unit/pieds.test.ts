import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { detecterPieds, detecterPoteaux, ombresPiedsSvg, recollerPieds } from '@/lib/images/pieds'
import { nettoyerProduit } from '@/lib/images/pose'

/**
 * Produit synthétique 200×100 : vantail plein (y 0-79 sur toute la largeur),
 * deux pieds de 6 px de large qui descendent jusqu'à y=91 (x 30-35 et 160-165).
 */
async function produitSynthetique(): Promise<Buffer> {
  const W = 200
  const H = 100
  const data = Buffer.alloc(W * H * 4)
  const opaque = (x: number, y: number) => {
    const i = (y * W + x) * 4
    data[i] = 80
    data[i + 1] = 80
    data[i + 2] = 90
    data[i + 3] = 255
  }
  for (let y = 0; y < 80; y++) for (let x = 0; x < W; x++) opaque(x, y)
  for (let y = 80; y < 92; y++) {
    for (let x = 30; x < 36; x++) opaque(x, y)
    for (let x = 160; x < 166; x++) opaque(x, y)
  }
  return sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer()
}

describe('detecterPieds', () => {
  it('repère les deux pieds sous le bord bas principal, en coordonnées décor', async () => {
    const produit = await produitSynthetique()
    const pieds = await detecterPieds(produit, { x: 500, y: 300, w: 200, h: 100 })
    expect(pieds.length).toBe(2)
    const [p1, p2] = pieds
    expect(p1.x).toBe(530)
    expect(p1.w).toBe(6)
    // Remontée de 2 px au-dessus du bord bas principal (y=79) → y = 300 + 78
    expect(p1.y).toBe(378)
    expect(p1.y + p1.h - 1).toBe(391)
    expect(p2.x).toBe(660)
  })

  it('ignore un produit sans pieds (bord bas plat)', async () => {
    const plat = await sharp({
      create: { width: 100, height: 50, channels: 4, background: { r: 50, g: 50, b: 50, alpha: 1 } },
    })
      .png()
      .toBuffer()
    const pieds = await detecterPieds(plat, { x: 0, y: 0, w: 100, h: 50 })
    expect(pieds.length).toBe(0)
  })

  it('écarte un débord plus large que 15 % de la largeur (pas un pied)', async () => {
    const W = 200
    const H = 100
    const data = Buffer.alloc(W * H * 4)
    for (let y = 0; y < 80; y++)
      for (let x = 0; x < W; x++) data.writeUInt32LE(0xff505050, (y * W + x) * 4)
    // « jupe » de 60 px de large (30 % > 15 %) qui descend sous le bord
    for (let y = 80; y < 96; y++)
      for (let x = 70; x < 130; x++) data.writeUInt32LE(0xff505050, (y * W + x) * 4)
    const produit = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer()
    const pieds = await detecterPieds(produit, { x: 0, y: 0, w: W, h: H })
    expect(pieds.length).toBe(0)
  })

  it('sévérité : sous un poteau qui dépasse le vantail, seul la quincaillerie est un pied', async () => {
    const W = 200
    const H = 100
    const data = Buffer.alloc(W * H * 4)
    const opaque = (x: number, y: number) => {
      const i = (y * W + x) * 4
      data[i] = 70
      data[i + 1] = 70
      data[i + 2] = 80
      data[i + 3] = 255
    }
    // Vantail y 20-79 ; poteau x 10-25 qui descend à y=89 ; tige x 16-19 à y=97.
    for (let y = 20; y < 80; y++) for (let x = 0; x < W; x++) opaque(x, y)
    for (let y = 0; y < 90; y++) for (let x = 10; x < 26; x++) opaque(x, y)
    for (let y = 90; y < 98; y++) for (let x = 16; x < 20; x++) opaque(x, y)
    const produit = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer()
    const pieds = await detecterPieds(produit, { x: 0, y: 0, w: W, h: H })
    expect(pieds.length).toBe(1)
    // Le pied = la tige seule, ancré au bas du POTEAU (y=89), pas au bas du vantail.
    expect(pieds[0].x).toBe(16)
    expect(pieds[0].w).toBe(4)
    expect(pieds[0].y).toBe(88)
    expect(pieds[0].y + pieds[0].h - 1).toBe(97)
  })

  it('écarte un pied dans une zone exclue (aplat redessiné par-dessus)', async () => {
    const produit = await produitSynthetique()
    const pieds = await detecterPieds(produit, { x: 0, y: 0, w: 200, h: 100 }, [
      { x: 155, y: 0, w: 50, h: 100 },
    ])
    expect(pieds.length).toBe(1)
    expect(pieds[0].x).toBe(30)
  })
})

/**
 * Produit synthétique avec poteaux : vantail (y 20-79, x 0-199) et deux poteaux
 * pleine hauteur qui MONTENT AU-DESSUS du vantail (chapeau) : x 0-7 et x 192-199.
 */
async function produitAvecPoteaux(): Promise<Buffer> {
  const W = 200
  const H = 100
  const data = Buffer.alloc(W * H * 4)
  const opaque = (x: number, y: number) => {
    const i = (y * W + x) * 4
    data[i] = 70
    data[i + 1] = 70
    data[i + 2] = 80
    data[i + 3] = 255
  }
  for (let y = 20; y < 80; y++) for (let x = 0; x < W; x++) opaque(x, y)
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 8; x++) opaque(x, y)
    for (let x = 192; x < 200; x++) opaque(x, y)
  }
  return sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer()
}

describe('detecterPoteaux', () => {
  it('repère les deux poteaux à chapeau, en coordonnées décor', async () => {
    const produit = await produitAvecPoteaux()
    const poteaux = await detecterPoteaux(produit, { x: 500, y: 300, w: 200, h: 100 })
    expect(poteaux.length).toBe(2)
    expect(poteaux[0].x).toBe(500)
    expect(poteaux[0].w).toBe(12) // fin du poteau (x=7) + marge 4
    expect(poteaux[1].x + poteaux[1].w).toBe(700)
    expect(poteaux[1].w).toBe(12)
  })

  it('ne détecte rien sur un produit au bord haut plat (pas de poteau différencié)', async () => {
    const plat = await sharp({
      create: { width: 200, height: 100, channels: 4, background: { r: 70, g: 70, b: 80, alpha: 1 } },
    })
      .png()
      .toBuffer()
    const poteaux = await detecterPoteaux(plat, { x: 0, y: 0, w: 200, h: 100 })
    expect(poteaux.length).toBe(0)
  })
})

describe('nettoyerProduit — mangeur de pixels blancs (28/07)', () => {
  it('conserve un voile blanc semi-transparent ENCLAVÉ, tue le fantôme extérieur', async () => {
    const W = 100
    const H = 60
    const data = Buffer.alloc(W * H * 4)
    const pose = (x: number, y: number, rgb: number, a: number) => {
      const i = (y * W + x) * 4
      data[i] = rgb
      data[i + 1] = rgb
      data[i + 2] = rgb
      data[i + 3] = a
    }
    // Cadre opaque sombre (10..89 × 10..49), ouverture intérieure (30..69 × 20..39)
    for (let y = 10; y < 50; y++)
      for (let x = 10; x < 90; x++) pose(x, y, 60, 255)
    // Ouverture remplie d'un VOILE blanc semi-transparent (enclavé) — l'insert.
    for (let y = 20; y < 40; y++)
      for (let x = 30; x < 70; x++) pose(x, y, 245, 30)
    // Fantôme blanc semi-transparent EXTÉRIEUR (collé au bord droit du cadre).
    for (let y = 10; y < 50; y++)
      for (let x = 92; x < 98; x++) pose(x, y, 250, 120)
    const png = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer()

    const net = await nettoyerProduit(png, 200, true)
    const raw = await sharp(net.image).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const alpha = (x: number, y: number) =>
      raw.data[((y - net.bbox.minY) * raw.info.width + (x - net.bbox.minX)) * raw.info.channels + 3]
    // L'insert enclavé garde son alpha d'origine (translucidité conservée).
    expect(alpha(50, 30)).toBe(30)
    // Le fantôme extérieur reste tué.
    if (net.bbox.maxX >= 95) {
      expect(alpha(95, 30)).toBe(0)
    } else {
      expect(net.bbox.maxX).toBeLessThan(92) // rogné : le fantôme n'existe plus du tout
    }
  })
})

describe('ombresPiedsSvg', () => {
  it('dessine une ellipse en dégradé radial par pied', () => {
    const svg = ombresPiedsSvg(1000, 600, [
      { x: 100, y: 500, w: 10, h: 20 },
      { x: 300, y: 500, w: 8, h: 18 },
    ])
    expect((svg.match(/<ellipse /g) ?? []).length).toBe(2)
    expect((svg.match(/<radialGradient /g) ?? []).length).toBe(2)
    expect(svg).toContain('width="1000"')
  })
})

describe('recollerPieds', () => {
  it('recolle les pieds effacés en recalant leur exposition sur le rendu', async () => {
    const W = 300
    const H = 200
    const produit = await produitSynthetique()
    const cible = { x: 50, y: 60, w: 200, h: 100 }
    // Entrée posée : fond vert + produit collé.
    const entree = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 40, g: 120, b: 40 } },
    })
      .composite([{ input: produit, left: cible.x, top: cible.y }])
      .png()
      .toBuffer()
    const pieds = await detecterPieds(produit, cible)
    expect(pieds.length).toBe(2)
    // Sortie « Nano » : toute l'image éclaircie de 25 %, pieds remplacés par du fond.
    const rawE = await sharp(entree).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const dataS = Buffer.from(rawE.data)
    for (let i = 0; i < dataS.length; i++) dataS[i] = Math.min(255, Math.round(dataS[i] * 1.25))
    for (const p of pieds) {
      for (let y = p.y; y < p.y + p.h; y++) {
        for (let x = p.x; x < p.x + p.w; x++) {
          const i = (y * W + x) * rawE.info.channels
          dataS[i] = 50
          dataS[i + 1] = 150
          dataS[i + 2] = 50
        }
      }
    }
    const sortie = await sharp(dataS, { raw: { width: W, height: H, channels: 3 } })
      .png()
      .toBuffer()
    const recolle = await recollerPieds(
      sortie,
      { width: W, height: H },
      entree,
      { width: W, height: H },
      produit,
      cible,
      pieds
    )
    expect(recolle).not.toBeNull()
    const raw = await sharp(recolle as Buffer).raw().toBuffer({ resolveWithObject: true })
    const px = (x: number, y: number) => {
      const i = (y * raw.info.width + x) * raw.info.channels
      return [raw.data[i], raw.data[i + 1], raw.data[i + 2]]
    }
    // Centre du premier pied (produit x=32, y=90 → décor 82, 150) : matière
    // recollée vers l'exposition du rendu — gain ≈ 1,25 mesuré sur le vantail,
    // pondéré par la luminosité du pixel (80 → ~94, 90 → ~105).
    const [r, g, b] = px(82, 150)
    expect(Math.abs(r - 94)).toBeLessThanOrEqual(2)
    expect(Math.abs(g - 94)).toBeLessThanOrEqual(2)
    expect(Math.abs(b - 105)).toBeLessThanOrEqual(2)
    // À côté du pied : le rendu de la sortie est intact.
    expect(px(120, 150)).toEqual([50, 150, 50])
  })

  it('se recale sur le montant quand Nano a déplacé le produit', async () => {
    const W = 300
    const H = 200
    const produit = await produitSynthetique()
    const cible = { x: 50, y: 60, w: 200, h: 100 }
    const entree = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 40, g: 120, b: 40 } },
    })
      .composite([{ input: produit, left: cible.x, top: cible.y }])
      .png()
      .toBuffer()
    const pieds = await detecterPieds(produit, cible)
    // Sortie « Nano » : tout le contenu décalé de +4 px vers la droite, pieds effacés.
    const rawE = await sharp(entree).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const ch = rawE.info.channels
    const dataS = Buffer.alloc(rawE.data.length)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = (y * W + x) * ch
        const s = (y * W + Math.max(0, x - 4)) * ch
        dataS[d] = x >= 4 ? rawE.data[s] : 40
        dataS[d + 1] = x >= 4 ? rawE.data[s + 1] : 120
        dataS[d + 2] = x >= 4 ? rawE.data[s + 2] : 40
      }
    }
    for (const p of pieds) {
      for (let y = p.y; y < p.y + p.h; y++) {
        for (let x = p.x + 4; x < p.x + p.w + 4; x++) {
          const i = (y * W + x) * ch
          dataS[i] = 40
          dataS[i + 1] = 120
          dataS[i + 2] = 40
        }
      }
    }
    const sortie = await sharp(dataS, { raw: { width: W, height: H, channels: 3 } })
      .png()
      .toBuffer()
    const recolle = await recollerPieds(
      sortie,
      { width: W, height: H },
      entree,
      { width: W, height: H },
      produit,
      cible,
      pieds
    )
    const raw = await sharp(recolle as Buffer).raw().toBuffer({ resolveWithObject: true })
    const px = (x: number, y: number) => {
      const i = (y * raw.info.width + x) * raw.info.channels
      return [raw.data[i], raw.data[i + 1], raw.data[i + 2]]
    }
    // Le pied est recollé À LA POSITION DÉCALÉE (centre décor 82+4, 150)…
    expect(px(86, 150)).toEqual([80, 80, 90])
    // …et pas à l'ancienne position (le fond décalé y reste intact).
    expect(px(78, 150)).toEqual([40, 120, 40])
  })

  it('poteaux : ne recolle que les tranches abîmées, garde les tranches relit-éclairées', async () => {
    const W = 300
    const H = 200
    const produit = await produitAvecPoteaux() // 200x100, poteaux x 0-7 et 192-199
    const cible = { x: 50, y: 60, w: 200, h: 100 }
    const entree = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 40, g: 120, b: 40 } },
    })
      .composite([{ input: produit, left: cible.x, top: cible.y }])
      .png()
      .toBuffer()
    const poteaux = await detecterPoteaux(produit, cible)
    expect(poteaux.length).toBe(2)
    // Sortie « Nano » : moitié HAUTE du poteau gauche juste relit-éclairée
    // (+30 uniforme = reflet de soleil), moitié BASSE remplacée par du stuc blanc.
    const rawE = await sharp(entree).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const ch = rawE.info.channels
    const dataS = Buffer.from(rawE.data)
    const pg = poteaux[0]
    for (let y = cible.y; y < cible.y + 40; y++) {
      for (let x = pg.x; x < pg.x + pg.w; x++) {
        const i = (y * W + x) * ch
        for (let c = 0; c < 3; c++) dataS[i + c] = Math.min(255, dataS[i + c] + 30)
      }
    }
    for (let y = cible.y + 40; y < cible.y + 100; y++) {
      for (let x = pg.x; x < pg.x + pg.w; x++) {
        const i = (y * W + x) * ch
        dataS[i] = 250
        dataS[i + 1] = 248
        dataS[i + 2] = 245
      }
    }
    const sortie = await sharp(dataS, { raw: { width: W, height: H, channels: 3 } })
      .png()
      .toBuffer()
    const recolle = await recollerPieds(
      sortie,
      { width: W, height: H },
      entree,
      { width: W, height: H },
      produit,
      cible,
      [],
      poteaux
    )
    expect(recolle).not.toBeNull()
    const raw = await sharp(recolle as Buffer).raw().toBuffer({ resolveWithObject: true })
    const px = (x: number, y: number) => {
      const i = (y * raw.info.width + x) * raw.info.channels
      return [raw.data[i], raw.data[i + 1], raw.data[i + 2]]
    }
    // Tranche haute INTACTE : le rendu (reflet +30) est conservé tel quel.
    expect(px(53, 80)).toEqual([100, 100, 110])
    // Tranche basse ABÎMÉE (stuc) : le poteau est recollé, sombre à nouveau
    // (gain pris sur la tranche intacte voisine, donc légèrement éclairci).
    const [r, g, b] = px(53, 130)
    expect(r).toBeGreaterThanOrEqual(70)
    expect(r).toBeLessThanOrEqual(110)
    expect(b).toBeGreaterThanOrEqual(80)
    expect(b).toBeLessThanOrEqual(120)
    expect(g).toBeLessThanOrEqual(110)
  })

  it('retourne null quand il n’y a aucun pied', async () => {
    const produit = await produitSynthetique()
    const vide = await recollerPieds(
      produit,
      { width: 200, height: 100 },
      produit,
      { width: 200, height: 100 },
      produit,
      { x: 0, y: 0, w: 200, h: 100 },
      []
    )
    expect(vide).toBeNull()
  })
})
