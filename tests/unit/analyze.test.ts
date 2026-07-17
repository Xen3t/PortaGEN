import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { greenFraction, measureInnerPillarEdges } from '@/lib/images/analyze'

describe('greenFraction', () => {
  it('mesure la part de végétation dans une zone', async () => {
    // Moitié gauche : pelouse (vert dominant) ; moitié droite : béton gris.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
      <rect width="100" height="100" fill="rgb(70,140,60)"/>
      <rect x="100" width="100" height="100" fill="rgb(150,150,150)"/>
    </svg>`
    const img = await sharp(Buffer.from(svg)).png().toBuffer()
    const f = await greenFraction(img, { x: 0, y: 0, w: 200, h: 100 })
    expect(f).toBeGreaterThan(0.45)
    expect(f).toBeLessThan(0.55)
    const beton = await greenFraction(img, { x: 100, y: 0, w: 100, h: 100 })
    expect(beton).toBe(0)
  })
})

describe('measureInnerPillarEdges', () => {
  it('trouve les bords intérieurs réels des piliers rendus, même décalés', async () => {
    // Fond gris sombre ; pilier gauche rendu jusqu'à x=262 (bord théorique : 250),
    // pilier droit rendu à partir de x=585 (bord théorique : 550).
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
      <rect width="800" height="600" fill="rgb(60,60,60)"/>
      <rect x="80" width="183" height="600" fill="rgb(235,235,235)"/>
      <rect x="585" width="140" height="600" fill="rgb(235,235,235)"/>
    </svg>`
    const img = await sharp(Buffer.from(svg)).png().toBuffer()
    const zone = { x: 250, y: 100, w: 300, h: 400 }
    const edges = await measureInnerPillarEdges(img, zone)
    expect(edges.left).not.toBeNull()
    expect(edges.right).not.toBeNull()
    expect(Math.abs((edges.left ?? 0) - 262)).toBeLessThanOrEqual(3)
    expect(Math.abs((edges.right ?? 0) - 585)).toBeLessThanOrEqual(3)
  })

  it('rend null quand aucun bord vertical net (zone uniforme)', async () => {
    const flat = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 90, g: 90, b: 90 } },
    })
      .png()
      .toBuffer()
    const edges = await measureInnerPillarEdges(flat, { x: 250, y: 100, w: 300, h: 400 })
    expect(edges.left).toBeNull()
    expect(edges.right).toBeNull()
  })
})
