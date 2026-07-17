import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { addShadowsToMask } from '@/lib/images/shadows'

const W = 400
const H = 200

/** Décor uni gris clair. */
async function decor(): Promise<Buffer> {
  return sharp({ create: { width: W, height: H, channels: 3, background: { r: 180, g: 175, b: 170 } } })
    .png()
    .toBuffer()
}

/** Masque de base : un « pilier » vertical au centre-gauche. */
async function baseMask(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="black"/><rect x="100" y="40" width="30" height="120" fill="white"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/**
 * Sortie modèle : décor + ombre grise CONTIGUË au pied du pilier (assombrissement pur),
 * + une tache sombre ISOLÉE loin du pilier, + une tache VERTE (changement de teinte) contiguë.
 */
async function modelOutput(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="rgb(180,175,170)"/>
    <rect x="130" y="120" width="90" height="40" fill="rgb(117,114,111)"/>
    <rect x="330" y="150" width="40" height="30" fill="rgb(117,114,111)"/>
    <rect x="130" y="60" width="40" height="30" fill="rgb(60,160,60)"/>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function maskValueAt(mask: Buffer, x: number, y: number): Promise<number> {
  const { data, info } = await sharp(mask).greyscale().raw().toBuffer({ resolveWithObject: true })
  return data[y * info.width + x]
}

describe('addShadowsToMask', () => {
  it('capture l’ombre contiguë, ignore la tache isolée et le changement de teinte', async () => {
    const { mask, shadowFraction, aborted } = await addShadowsToMask(
      await decor(),
      await modelOutput(),
      await baseMask()
    )
    expect(aborted).toBe(false)
    expect(shadowFraction).toBeGreaterThan(0)
    // Au cœur de l'ombre contiguë (170,140) : inclus au masque.
    expect(await maskValueAt(mask, 170, 140)).toBeGreaterThan(127)
    // Tache sombre isolée (350,165) : PAS connectée → exclue.
    expect(await maskValueAt(mask, 350, 165)).toBeLessThan(64)
    // Tache verte contiguë (150,75) : teinte changée → exclue.
    expect(await maskValueAt(mask, 150, 75)).toBeLessThan(64)
    // Le pilier lui-même reste masqué.
    expect(await maskValueAt(mask, 115, 100)).toBeGreaterThan(127)
  })

  it('abandonne si le modèle a assombri une zone anormalement vaste', async () => {
    // Sortie globalement assombrie de 20 % : tout devient candidat contigu.
    const dark = await sharp(await decor()).modulate({ brightness: 0.8 }).png().toBuffer()
    const base = await baseMask()
    const { aborted, mask } = await addShadowsToMask(await decor(), dark, base, {
      maxShadowFraction: 0.18,
    })
    expect(aborted).toBe(true)
    // Masque inchangé (base) : la tache isolée du masque reste, rien d'ajouté.
    expect(Buffer.compare(mask, base)).toBe(0)
  })

  it('sans différence : masque de base inchangé, fraction nulle', async () => {
    const d = await decor()
    const base = await baseMask()
    const { shadowFraction, aborted, mask } = await addShadowsToMask(d, d, base)
    expect(aborted).toBe(false)
    expect(shadowFraction).toBe(0)
    expect(Buffer.compare(mask, base)).toBe(0)
  })
})
