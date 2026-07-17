import sharp from 'sharp'

/**
 * Contrôle d'invariance produit (exigence brief : le produit vendu ne doit jamais
 * être redessiné). On compare la STRUCTURE (contours) du produit posé avant appel
 * au même cadrage après intégration : le modèle a le droit d'ajuster exposition et
 * balance des blancs, pas la géométrie — on corrèle donc des cartes de gradients,
 * insensibles aux changements globaux de luminosité.
 */

const ANALYSIS_WIDTH = 420

async function gradientMap(
  input: Buffer | string,
  zone: { x: number; y: number; w: number; h: number }
): Promise<{ data: Float64Array; width: number; height: number }> {
  const { data, info } = await sharp(input)
    .extract({ left: zone.x, top: zone.y, width: zone.w, height: zone.h })
    .greyscale()
    .resize({ width: ANALYSIS_WIDTH })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const g = new Float64Array(width * height)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const dx = data[i + 1] - data[i - 1]
      const dy = data[i + width] - data[i - width]
      g[i] = Math.abs(dx) + Math.abs(dy)
    }
  }
  return { data: g, width, height }
}

function pearson(a: Float64Array, b: Float64Array): number {
  const n = Math.min(a.length, b.length)
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= n
  mb /= n
  let cov = 0
  let va = 0
  let vb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma
    const db = b[i] - mb
    cov += da * db
    va += da * da
    vb += db * db
  }
  if (va === 0 || vb === 0) return 0
  return cov / Math.sqrt(va * vb)
}

export interface InvarianceResult {
  /** Corrélation des structures de contours, 0..1 (1 = identique) */
  score: number
  /** true si le produit est jugé préservé */
  ok: boolean
}

export const INVARIANCE_THRESHOLD = 0.8

/**
 * Compare la zone produit entre l'image de référence (produit posé, avant appel)
 * et l'image finale (après intégration).
 */
export async function productInvariance(
  reference: Buffer | string,
  final: Buffer | string,
  zone: { x: number; y: number; w: number; h: number }
): Promise<InvarianceResult> {
  const [a, b] = await Promise.all([gradientMap(reference, zone), gradientMap(final, zone)])
  const score = Math.max(0, pearson(a.data, b.data))
  return { score, ok: score >= INVARIANCE_THRESHOLD }
}
