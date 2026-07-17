import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { buildCanny } from '@/lib/images/canny'

async function whiteXsAtRow(image: Buffer, yNorm: number): Promise<number[]> {
  const { data, info } = await sharp(image).greyscale().raw().toBuffer({ resolveWithObject: true })
  const y = Math.round(yNorm * info.height)
  const xs: number[] = []
  for (let x = 0; x < info.width; x++) {
    if (data[y * info.width + x] > 200) xs.push(x)
  }
  return xs
}

describe('buildCanny', () => {
  it('sans corridor : identique au trottoir redimensionné (rien au-dessus du trottoir)', async () => {
    const { image, corridor } = await buildCanny({ width: 1264, height: 848, corridorWidthCm: null })
    expect(corridor).toBeNull()
    const meta = await sharp(image).metadata()
    expect(meta.width).toBe(1264)
    expect(meta.height).toBe(848)
    // À 65 % de hauteur (au-dessus du trottoir), le CANNY historique est noir.
    expect(await whiteXsAtRow(image, 0.65)).toHaveLength(0)
  })

  it('avec corridor : la zone de contrôle est calculée mais AUCUN trait n’est dessiné', async () => {
    const { image, corridor } = await buildCanny({ width: 1264, height: 848, corridorWidthCm: 400 })
    expect(corridor).not.toBeNull()
    // Bords symétriques autour du centre (offsetX = 0 par défaut).
    const centerPx = (corridor!.x1Px + corridor!.x2Px) / 2
    expect(Math.abs(centerPx - 1264 / 2)).toBeLessThan(6)
    // Plus de piquets (décision Mathias 09/07/2026) : au milieu du corridor,
    // le CANNY reste strictement noir — identique au trottoir seul.
    const yMid = (corridor!.yTopPx + corridor!.yBottomPx) / 2 / 848
    expect(await whiteXsAtRow(image, yMid)).toHaveLength(0)
  })
})

// L'addendum couloir est désormais le prompt versionné « decor-couloir »,
// rempli par buildCorridorAddendum — testé dans tests/unit/decorPrompt.test.ts.
