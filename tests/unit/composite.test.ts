import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { estimateShift, applyShift, compositeWithMask } from '@/lib/images/composite'

/** Image synthétique : damier contrasté (pour donner de la texture à l'estimateur). */
async function checkerboard(width: number, height: number, cell = 16): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0
      const v = on ? 230 : 40
      const o = (y * width + x) * 3
      raw[o] = v
      raw[o + 1] = v
      raw[o + 2] = v
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer()
}

async function solid(width: number, height: number, rgb: [number, number, number]): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } },
  })
    .png()
    .toBuffer()
}

describe('estimateShift / applyShift', () => {
  it('détecte un décalage synthétique et le corrige', async () => {
    // Cellules de 7 px (impair) : les frontières touchent toutes les parités de colonnes,
    // le test n'est pas aveugle à un décalage de 1 px quel que soit l'échantillonnage.
    const ref = await checkerboard(256, 160, 7)
    const moved = await applyShift(ref, 3, -2) // moved(x,y) = ref(x+3, y-2)
    // Pour réaligner moved sur ref : chercher le décalage de ref par rapport à moved
    const est = await estimateShift(moved, ref, 6, 2)
    expect(est.dx).toBe(3)
    expect(est.dy).toBe(-2)
    expect(est.atBound).toBe(false)

    const realigned = await applyShift(ref, est.dx, est.dy)
    const back = await estimateShift(moved, realigned, 6, 2)
    expect(back.dx).toBe(0)
    expect(back.dy).toBe(0)
  })

  it('retourne (0,0) pour deux images identiques', async () => {
    const ref = await checkerboard(256, 160)
    const est = await estimateShift(ref, ref, 6, 2)
    expect(est).toMatchObject({ dx: 0, dy: 0 })
    expect(est.score).toBe(0)
  })
})

describe('compositeWithMask', () => {
  it('garde le décor hors masque et la sortie dans le masque', async () => {
    const W = 200
    const H = 100
    const decor = await solid(W, H, [0, 0, 255]) // bleu
    const output = await solid(W, H, [255, 0, 0]) // rouge
    // Masque : moitié droite blanche
    const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="black"/><rect x="${W / 2}" width="${W / 2}" height="${H}" fill="white"/></svg>`
    const mask = await sharp(Buffer.from(maskSvg)).png().toBuffer()

    const { image, changedFraction } = await compositeWithMask(decor, output, mask, 2)
    const raw = await sharp(image).raw().toBuffer({ resolveWithObject: true })
    const px = (x: number, y: number) => {
      const o = (y * W + x) * 3
      return [raw.data[o], raw.data[o + 1], raw.data[o + 2]]
    }
    expect(px(10, 50)).toEqual([0, 0, 255]) // loin à gauche : décor intact
    expect(px(190, 50)).toEqual([255, 0, 0]) // loin à droite : sortie modèle
    // À la frontière : mélange (ni pur bleu ni pur rouge)
    const border = px(100, 50)
    expect(border[0]).toBeGreaterThan(0)
    expect(border[2]).toBeGreaterThan(0)
    expect(changedFraction).toBeGreaterThan(0.45)
    expect(changedFraction).toBeLessThan(0.55)
  })

  it('hors masque : octets strictement identiques au décor', async () => {
    const W = 128
    const H = 64
    const decor = await checkerboard(W, H, 8)
    const output = await solid(W, H, [255, 0, 0])
    const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="black"/><rect x="40" y="10" width="30" height="30" fill="white"/></svg>`
    const mask = await sharp(Buffer.from(maskSvg)).png().toBuffer()

    const { image } = await compositeWithMask(decor, output, mask, 2)
    const a = await sharp(decor).removeAlpha().raw().toBuffer()
    const b = await sharp(image).removeAlpha().raw().toBuffer()
    // Colonne x=100 (loin du masque + flou) : identité stricte
    for (let y = 0; y < H; y++) {
      const o = (y * W + 100) * 3
      expect(b[o]).toBe(a[o])
      expect(b[o + 1]).toBe(a[o + 1])
      expect(b[o + 2]).toBe(a[o + 2])
    }
  })
})
