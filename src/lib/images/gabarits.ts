import sharp from 'sharp'
import {
  computeLayout,
  projection,
  projectRect,
  gendarmePathD,
  type SizeCm,
  type GabaritParams,
} from '@/lib/geometry'

/**
 * Rendu des gabarits en pixels : aplats gris #888888 (piliers, chapeaux, murets)
 * et zone portail. Remplace l'export PNG manuel du mockup et les superpositions Photoshop.
 */

export const APLAT_COLOR = '#888888'
export const GATE_OUTLINE_COLOR = '#FF0000'

/** SVG des aplats d'une taille donnée, projeté aux dimensions de travail. */
export function gabaritSvg(
  size: SizeCm,
  params: Partial<GabaritParams>,
  mesW: number,
  mesH: number
): string {
  const layout = computeLayout(size, params)
  const p = projection(mesW, mesH, layout.sceneW, layout.sceneH)

  const rects = [layout.pillarLeft, layout.pillarRight, layout.muretLeft, layout.muretRight]
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => projectRect(r, p))
    .filter((r) => r.w > 0 && r.h > 0)
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${APLAT_COLOR}"/>`)

  const caps = [layout.capLeft, layout.capRight]
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => {
      const b = projectRect(c.bbox, p)
      if (b.w <= 0 || b.h <= 0) return ''
      return c.style === 'flat'
        ? `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${APLAT_COLOR}"/>`
        : `<path d="${gendarmePathD(b)}" fill="${APLAT_COLOR}"/>`
    })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${mesW}" height="${mesH}" viewBox="0 0 ${mesW} ${mesH}">${rects.join('')}${caps.join('')}</svg>`
}

/** PNG transparent contenant uniquement les aplats (équivalent de l'export gabarit du mockup). */
export async function renderGabaritPng(
  size: SizeCm,
  params: Partial<GabaritParams>,
  mesW: number,
  mesH: number
): Promise<Buffer> {
  return sharp(Buffer.from(gabaritSvg(size, params, mesW, mesH))).png().toBuffer()
}

/** Superpose les aplats gris sur un décor : c'est l'image d'entrée de l'étape Piliers. */
export async function overlayGabaritOnDecor(
  decor: Buffer | string,
  size: SizeCm,
  params: Partial<GabaritParams>
): Promise<{ image: Buffer; width: number; height: number }> {
  const meta = await sharp(decor).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  const overlay = await renderGabaritPng(size, params, width, height)
  const image = await sharp(decor)
    .composite([{ input: overlay }])
    .png()
    .toBuffer()
  return { image, width, height }
}

/**
 * Masque binaire des zones éditées (aplats dilatés d'une marge pour les ombres) :
 * blanc = zone où la sortie du modèle est conservée, noir = pixels verrouillés du décor.
 * Servira au compositing « pixel-lock » de l'étape Piliers (J2).
 */
export async function gabaritMask(
  size: SizeCm,
  params: Partial<GabaritParams>,
  mesW: number,
  mesH: number,
  marginPx = 24
): Promise<Buffer> {
  const layout = computeLayout(size, params)
  const p = projection(mesW, mesH, layout.sceneW, layout.sceneH)
  const grow = (r: { x: number; y: number; w: number; h: number }) => ({
    x: Math.max(0, r.x - marginPx),
    y: Math.max(0, r.y - marginPx),
    w: Math.min(mesW, r.x + r.w + marginPx) - Math.max(0, r.x - marginPx),
    h: Math.min(mesH, r.y + r.h + marginPx) - Math.max(0, r.y - marginPx),
  })
  const boxes = [
    layout.pillarLeft,
    layout.pillarRight,
    layout.muretLeft,
    layout.muretRight,
    layout.capLeft?.bbox,
    layout.capRight?.bbox,
  ]
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => grow(projectRect(r, p)))
    .filter((r) => r.w > 0 && r.h > 0)
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#ffffff"/>`)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${mesW}" height="${mesH}"><rect width="${mesW}" height="${mesH}" fill="#000000"/>${boxes.join('')}</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}
