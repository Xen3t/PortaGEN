import sharp from 'sharp'

/**
 * Détection automatique des ombres portées générées par Nano Banana.
 *
 * Principe : on compare la sortie brute au décor d'origine. Une ombre est un pixel
 * (1) nettement assombri, (2) sans changement de teinte (une ombre fonce, elle ne
 * repeint pas), (3) CONNECTÉ au masque de maçonnerie (l'ombre part du pied des
 * piliers/murets). Ces zones sont ajoutées au masque de compositing : l'ombre
 * exacte dessinée par le modèle est conservée, tout le reste demeure verrouillé.
 */

export interface ShadowDetectOptions {
  /** Ratio de luminosité sortie/décor sous lequel un pixel est « assombri » */
  darkenMax?: number
  /** Écart max entre ratios de canaux (teinte préservée) */
  hueTolerance?: number
  /** Distance max de croissance depuis la maçonnerie, en px natifs */
  maxGrowPx?: number
  /** Fraction d'image au-delà de laquelle on n'y croit plus (dérive du modèle) */
  maxShadowFraction?: number
}

export interface ShadowDetectResult {
  /** Masque combiné (maçonnerie + ombres détectées), PNG aux dimensions d'entrée */
  mask: Buffer
  /** Fraction d'image ajoutée au masque au titre des ombres (0..1) */
  shadowFraction: number
  /** true si la détection a été abandonnée (résultat suspect) — masque de base renvoyé */
  aborted: boolean
}

export async function addShadowsToMask(
  decor: Buffer | string,
  modelOutput: Buffer | string,
  baseMask: Buffer,
  opts: ShadowDetectOptions = {}
): Promise<ShadowDetectResult> {
  const { darkenMax = 0.92, hueTolerance = 0.16, maxGrowPx = 600, maxShadowFraction = 0.18 } = opts

  const meta = await sharp(baseMask).metadata()
  const W = meta.width ?? 0
  const H = meta.height ?? 0

  // Travail à demi-résolution : les ombres sont douces, la précision au pixel près
  // est restituée par l'upscale + le feather du compositing.
  const w = Math.round(W / 2)
  const h = Math.round(H / 2)
  const [dec, out, seed] = await Promise.all([
    sharp(decor).removeAlpha().resize(w, h, { fit: 'fill' }).raw().toBuffer(),
    sharp(modelOutput).removeAlpha().resize(w, h, { fit: 'fill' }).raw().toBuffer(),
    sharp(baseMask).greyscale().resize(w, h, { fit: 'fill' }).raw().toBuffer(),
  ])

  const n = w * h
  const candidate = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 3
    const dr = dec[o]
    const dg = dec[o + 1]
    const db = dec[o + 2]
    const ld = (dr + dg + db) / 3
    if (ld < 25) continue // zones déjà sombres : trop bruité pour juger
    const or_ = out[o]
    const og = out[o + 1]
    const ob = out[o + 2]
    const lo = (or_ + og + ob) / 3
    const ratio = lo / ld
    if (ratio >= darkenMax || ratio < 0.2) continue // pas assombri, ou repeint en noir
    // Teinte préservée : les trois canaux doivent avoir baissé dans les mêmes proportions.
    const rr = dr > 12 ? or_ / dr : ratio
    const rg = dg > 12 ? og / dg : ratio
    const rb = db > 12 ? ob / db : ratio
    const mean = (rr + rg + rb) / 3
    if (
      Math.abs(rr - mean) > hueTolerance ||
      Math.abs(rg - mean) > hueTolerance ||
      Math.abs(rb - mean) > hueTolerance
    ) {
      continue
    }
    candidate[i] = 1
  }

  // Croissance en largeur depuis la maçonnerie, sur les candidats uniquement.
  const selected = new Uint8Array(n)
  const dist = new Int32Array(n).fill(-1)
  const queue = new Int32Array(n)
  let qHead = 0
  let qTail = 0
  for (let i = 0; i < n; i++) {
    if (seed[i] > 127) {
      dist[i] = 0
      queue[qTail++] = i
    }
  }
  const maxSteps = Math.round(maxGrowPx / 2) // demi-résolution
  while (qHead < qTail) {
    const i = queue[qHead++]
    const d = dist[i]
    if (d >= maxSteps) continue
    const x = i % w
    const neighbors = [
      x > 0 ? i - 1 : -1,
      x < w - 1 ? i + 1 : -1,
      i - w >= 0 ? i - w : -1,
      i + w < n ? i + w : -1,
    ]
    for (const j of neighbors) {
      if (j < 0 || dist[j] !== -1 || candidate[j] === 0) continue
      dist[j] = d + 1
      selected[j] = 1
      queue[qTail++] = j
    }
  }

  let shadowCount = 0
  for (let i = 0; i < n; i++) if (selected[i] === 1 && seed[i] <= 127) shadowCount++
  const shadowFraction = shadowCount / n

  if (shadowFraction > maxShadowFraction) {
    return { mask: baseMask, shadowFraction, aborted: true }
  }
  if (shadowCount === 0) {
    return { mask: baseMask, shadowFraction: 0, aborted: false }
  }

  // Masque des ombres seul → léger lissage → upscale → union avec le masque de base.
  const shadowRaw = Buffer.alloc(n)
  for (let i = 0; i < n; i++) shadowRaw[i] = selected[i] ? 255 : 0
  const shadowPng = await sharp(shadowRaw, { raw: { width: w, height: h, channels: 1 } })
    .blur(1.2)
    .threshold(60)
    .resize(W, H, { fit: 'fill' })
    .png()
    .toBuffer()
  const mask = await sharp(baseMask)
    .composite([{ input: shadowPng, blend: 'lighten' }])
    .png()
    .toBuffer()

  return { mask, shadowFraction, aborted: false }
}
