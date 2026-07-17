import sharp from 'sharp'

/**
 * Détection du coloris d'un portail à partir de son visuel produit (idée Mathias
 * 12/07/2026). Le visuel montre le portail sur fond blanc, encadré de piliers
 * blancs : on IGNORE le fond et les piliers (bords + pixels blancs) et on mesure
 * la couleur de la matière au CENTRE de l'image (le portail).
 *
 * Faisabilité mesurée sur 86 visuels réels (VOGEL, VALIER, NALI, ATHOS) :
 * - blanc, teck (bois) et « portail foncé » se reconnaissent sans erreur ;
 * - gris (RAL 7016) et noir (RAL 9005) sont TRÈS proches en photo (le gris
 *   composite d'une gamme peut être plus foncé que le noir d'une autre) : on ne
 *   tranche donc jamais gris/noir par un seuil universel — on renvoie le plus
 *   probable avec `confidence: 'a_verifier'`, et l'utilisateur corrige d'un clic.
 *
 * La palette (Gris 7016 · Noir 9005 · Blanc · Teck) vit dans `colorisPalette`
 * (module pur, partagé avec l'UI).
 */

export { CANONICAL_COLORIS, colorisDef, type ColorisDef } from '@/lib/catalogue/colorisPalette'

export type ColorisConfidence = 'sur' | 'a_verifier' | 'aucun'

export interface ColorisDetection {
  /** Clé canonique ('gris' | 'blanc' | 'noir' | 'teck') ou null si indéterminé. */
  coloris: string | null
  confidence: ColorisConfidence
  /** Couleur moyenne de la matière, pour contrôle. */
  hex: string | null
  /** Clarté 0..255 (bas = foncé). */
  L: number
  /** Teinte b−r : + bleuté (anthracite), ~0 neutre (noir), − chaud (teck/bois). */
  tint: number
  /** Fraction de matière colorée/sombre dans la zone centrale (0..1). */
  matFrac: number
}

function lum(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}
function chroma(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b)
}

/**
 * Mesure la couleur dominante du portail (zone centrale, hors fond et piliers)
 * et en déduit le coloris canonique le plus probable.
 */
export async function detectColoris(input: Buffer | string): Promise<ColorisDetection> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .resize({ width: 440, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  const ch = info.channels
  // Bande centrale : le portail est toujours au milieu, les piliers sur les bords.
  const x0 = Math.floor(W * 0.25)
  const x1 = Math.floor(W * 0.75)
  const y0 = Math.floor(H * 0.15)
  const y1 = Math.floor(H * 0.9)

  let white = 0
  let material = 0
  let sr = 0
  let sg = 0
  let sb = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * W + x) * ch
      if (data[o + 3] < 200) continue // transparent : fond
      const r = data[o]
      const g = data[o + 1]
      const b = data[o + 2]
      if (lum(r, g, b) > 205 && chroma(r, g, b) < 22) {
        white++ // fond, pilier blanc ou portail blanc
        continue
      }
      material++
      sr += r
      sg += g
      sb += b
    }
  }

  const total = white + material
  const matFrac = total > 0 ? material / total : 0

  // Trop peu de matière colorée/sombre au centre → portail clair = blanc.
  if (material < 50 || matFrac < 0.12) {
    return { coloris: 'blanc', confidence: 'sur', hex: null, L: 255, tint: 0, matFrac }
  }

  const r = Math.round(sr / material)
  const g = Math.round(sg / material)
  const b = Math.round(sb / material)
  const L = Math.round(lum(r, g, b))
  const tint = b - r
  const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')

  // Teinte chaude marquée = bois (teck) : aucun RAL foncé ne vire au chaud.
  if (tint <= -30 && L > 90) {
    return { coloris: 'teck', confidence: 'sur', hex, L, tint, matFrac }
  }

  // Matière franchement claire mais pas blanche : on reste prudent → blanc probable.
  if (L > 150) {
    return { coloris: 'blanc', confidence: 'a_verifier', hex, L, tint, matFrac }
  }

  // Portail foncé : gris (7016) ou noir (9005). Inséparables par seuil universel
  // (mesuré) → on propose le plus probable, à confirmer d'un clic.
  const probable = L <= 55 && tint <= 6 ? 'noir' : 'gris'
  return { coloris: probable, confidence: 'a_verifier', hex, L, tint, matFrac }
}
