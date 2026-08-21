import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { nettoyerProduit } from '@/lib/images/pose'

/**
 * Anti-poussière de la boîte englobante (21/08/2026, bug ARLBERG 300B180) :
 * un pixel de détourage isolé au-dessus du produit écrasait le produit posé
 * de 11 % — la boîte doit ignorer les poussières, pipelines legacy inchangés.
 */

/** PNG 200×150 : rectangle plein 20..179 × 60..139 + poussière isolée à (100,10). */
async function pngAvecPoussiere(): Promise<Buffer> {
  const W = 200
  const H = 150
  const rgba = Buffer.alloc(W * H * 4)
  const set = (x: number, y: number) => {
    const o = (y * W + x) * 4
    rgba[o] = 40
    rgba[o + 1] = 40
    rgba[o + 2] = 40
    rgba[o + 3] = 255
  }
  for (let y = 60; y < 140; y++) for (let x = 20; x < 180; x++) set(x, y)
  set(100, 10)
  return sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer()
}

describe('boîte englobante anti-poussière (21/08/2026)', () => {
  it('sans l’option : la poussière entre dans la boîte (comportement legacy conservé)', async () => {
    const r = await nettoyerProduit(await pngAvecPoussiere(), 200, false, false)
    expect(r.bbox.minY).toBe(10)
  })

  it('avec l’option : la poussière est ignorée, la boîte colle au produit', async () => {
    const r = await nettoyerProduit(await pngAvecPoussiere(), 200, false, false, true)
    expect(r.bbox.minY).toBe(60)
    expect(r.bbox.maxY).toBe(139)
    expect(r.bbox.minX).toBe(20)
    expect(r.bbox.maxX).toBe(179)
  })
})
