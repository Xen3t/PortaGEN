import sharp from 'sharp'

/**
 * Compositing « pixel-lock » : après un appel Nano Banana, on ne conserve de la sortie
 * que les zones réellement éditées (masque), tout le reste revient à l'image d'entrée,
 * à l'octet près. C'est ce qui élimine la sur-génération et garantit l'effet catalogue
 * (fond strictement identique entre toutes les tailles d'une gamme).
 */

interface RawImage {
  data: Buffer
  width: number
  height: number
  channels: number
}

async function toRaw(input: Buffer | string, greyscale = false): Promise<RawImage> {
  let s = sharp(input)
  if (greyscale) s = s.greyscale()
  else s = s.removeAlpha()
  const { data, info } = await s.raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

export interface ShiftEstimate {
  dx: number
  dy: number
  /** Erreur moyenne absolue au meilleur décalage (0..255) */
  score: number
  /** true si le meilleur décalage touche la limite de recherche (résultat douteux) */
  atBound: boolean
}

/**
 * Estime le décalage global (dx, dy) de `moved` par rapport à `reference` en minimisant
 * l'erreur absolue moyenne sur une grille de pixels. Sert de garde-fou : avec la règle
 * des formats natifs, le décalage attendu est (0,0).
 */
export async function estimateShift(
  reference: Buffer | string,
  moved: Buffer | string,
  maxShift = 8,
  gridStep = 4
): Promise<ShiftEstimate> {
  const a = await toRaw(reference, true)
  const b = await toRaw(moved, true)
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`estimateShift : dimensions différentes (${a.width}x${a.height} vs ${b.width}x${b.height})`)
  }
  const { width, height } = a

  const mad = (dx: number, dy: number, step: number): number => {
    let sum = 0
    let n = 0
    for (let y = maxShift; y < height - maxShift; y += step) {
      const rowA = y * width
      const rowB = (y + dy) * width
      for (let x = maxShift; x < width - maxShift; x += step) {
        sum += Math.abs(a.data[rowA + x] - b.data[rowB + x + dx])
        n++
      }
    }
    return sum / n
  }

  // Passe 1 : balayage complet sur grille espacée.
  let best: ShiftEstimate = { dx: 0, dy: 0, score: Infinity, atBound: false }
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      const score = mad(dx, dy, gridStep)
      if (score < best.score) {
        best = { dx, dy, score, atBound: Math.abs(dx) === maxShift || Math.abs(dy) === maxShift }
      }
    }
  }

  // Passe 2 : raffinage exhaustif (tous les pixels) sur ±2 autour du meilleur candidat —
  // évite les ex æquo de la grille espacée et fixe le décalage au pixel près.
  if (gridStep > 1) {
    // L'incumbent est re-scoré en dense : comparer un score épars (passe 1) à des
    // scores denses favorisait un candidat dont la grille espacée était chanceuse.
    best = { ...best, score: mad(best.dx, best.dy, 1) }
    for (let dy = best.dy - 2; dy <= best.dy + 2; dy++) {
      for (let dx = best.dx - 2; dx <= best.dx + 2; dx++) {
        if (Math.abs(dx) > maxShift || Math.abs(dy) > maxShift) continue
        const score = mad(dx, dy, 1)
        if (score < best.score || (score === best.score && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) {
          best = { dx, dy, score, atBound: Math.abs(dx) === maxShift || Math.abs(dy) === maxShift }
        }
      }
    }
  }
  return best
}

/**
 * Recale une image de (dx, dy) : aligned(x, y) = source(x + dx, y + dy).
 * Les bords découverts sont remplis en répétant le pixel de bord (mieux que du noir,
 * et de toute façon récupérés par le décor via le masque).
 */
export async function applyShift(input: Buffer | string, dx: number, dy: number): Promise<Buffer> {
  if (dx === 0 && dy === 0) {
    return sharp(input).png().toBuffer()
  }
  const meta = await sharp(input).metadata()
  const w = meta.width ?? 0
  const h = meta.height ?? 0
  const pad = Math.max(Math.abs(dx), Math.abs(dy))
  // extend puis extract doivent être deux pipelines séparés : dans un même pipeline,
  // sharp applique extract avant extend, quel que soit l'ordre d'écriture.
  const extended = await sharp(input)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, extendWith: 'copy' })
    .toBuffer()
  return sharp(extended)
    .extract({ left: pad + dx, top: pad + dy, width: w, height: h })
    .png()
    .toBuffer()
}

export interface CompositeResult {
  image: Buffer
  /** Fraction (0..1) de pixels pris majoritairement à la sortie du modèle */
  changedFraction: number
}

/**
 * Fusionne : décor partout, sortie du modèle uniquement dans le masque (blanc = sortie).
 * Le masque est adouci (flou gaussien) pour éviter toute couture visible à la frontière.
 */
export async function compositeWithMask(
  decor: Buffer | string,
  modelOutput: Buffer | string,
  mask: Buffer | string,
  featherSigma = 4
): Promise<CompositeResult> {
  const base = await toRaw(decor)
  const out = await toRaw(modelOutput)
  const softMaskBuffer = await sharp(mask).greyscale().blur(featherSigma).raw().toBuffer({
    resolveWithObject: true,
  })
  const m: RawImage = {
    data: softMaskBuffer.data,
    width: softMaskBuffer.info.width,
    height: softMaskBuffer.info.height,
    channels: softMaskBuffer.info.channels,
  }
  if (
    base.width !== out.width ||
    base.height !== out.height ||
    base.width !== m.width ||
    base.height !== m.height
  ) {
    throw new Error('compositeWithMask : décor, sortie et masque doivent avoir les mêmes dimensions')
  }

  const px = base.width * base.height
  const res = Buffer.allocUnsafe(px * 3)
  let changed = 0
  for (let i = 0; i < px; i++) {
    const alpha = m.data[i] / 255
    if (alpha > 0.5) changed++
    const o = i * 3
    if (alpha === 0) {
      res[o] = base.data[o]
      res[o + 1] = base.data[o + 1]
      res[o + 2] = base.data[o + 2]
    } else if (alpha === 1) {
      res[o] = out.data[o]
      res[o + 1] = out.data[o + 1]
      res[o + 2] = out.data[o + 2]
    } else {
      res[o] = Math.round(base.data[o] * (1 - alpha) + out.data[o] * alpha)
      res[o + 1] = Math.round(base.data[o + 1] * (1 - alpha) + out.data[o + 1] * alpha)
      res[o + 2] = Math.round(base.data[o + 2] * (1 - alpha) + out.data[o + 2] * alpha)
    }
  }

  const image = await sharp(res, { raw: { width: base.width, height: base.height, channels: 3 } })
    .png()
    .toBuffer()
  return { image, changedFraction: changed / px }
}
