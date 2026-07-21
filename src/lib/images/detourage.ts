import path from 'node:path'
import fs from 'node:fs'
import sharp from 'sharp'
import * as ort from 'onnxruntime-node'
import { config } from '@/lib/config'

/**
 * Moteur de détourage produit — BiRefNet (segmentation dichotomique haute
 * résolution, licence MIT), exécuté EN LOCAL via onnxruntime-node (aucun Python).
 * Remplace l'ancienne méthode « remplissage par la couleur » (incapable de gérer
 * les portails ajourés et le blanc sur blanc — décision Mathias 12/07/2026).
 *
 * Le produit n'est jamais réinventé : le modèle ne fournit qu'un ALPHA (masque),
 * appliqué aux pixels d'origine intacts.
 *
 * À AMÉLIORER (backlog) : sur les portails BLANCS ajourés, les interstices entre
 * lames ne sont pas percés (lame blanche = fond blanc, pas de contraste) → tester
 * une variante matting/full, ou percer les lames après obtention de la silhouette.
 */

const MODEL_PATH = path.join(config.rootDir, 'models', 'birefnet-tiny.onnx')
const SIZE = 1024
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

export interface DetourageResult {
  /** PNG RGBA rogné sur la boîte englobante de l'alpha (fond transparent). */
  png: Buffer
  width: number
  height: number
  /** false = moteur indisponible (modèle manquant/illisible) → l'UI propose l'import. */
  ok: boolean
  reason?: string
}

let sessionPromise: Promise<ort.InferenceSession> | null = null
function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) sessionPromise = ort.InferenceSession.create(MODEL_PATH)
  return sessionPromise
}

const fail = (reason: string): DetourageResult => ({
  png: Buffer.alloc(0),
  width: 0,
  height: 0,
  ok: false,
  reason,
})

/**
 * Le visuel a-t-il déjà une VRAIE transparence (déjà détouré) ? Même critère que
 * prepareProduct : un pixel d'alpha < 250 quelque part. Un PNG fournisseur déjà
 * détouré ne repasse JAMAIS par BiRefNet (« le produit n'est jamais réinventé ») :
 * re-détourer un rendu à piliers blancs les rendrait opaques — c'est l'alpha
 * d'origine, nettoyé au seuil par la brique pose, qui est la référence validée
 * (méthode 1 du 17/07/2026).
 */
export async function hasRealTransparency(input: Buffer | string): Promise<boolean> {
  const meta = await sharp(input).metadata()
  if (!meta.hasAlpha) return false
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .resize({ width: 256, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true })
  for (let i = 3; i < data.length; i += info.channels) {
    if (data[i] < 250) return true
  }
  return false
}

export async function detourProduct(input: Buffer | string): Promise<DetourageResult> {
  if (!fs.existsSync(MODEL_PATH)) {
    return fail('moteur de détourage indisponible (modèle BiRefNet manquant)')
  }
  let session: ort.InferenceSession
  try {
    session = await getSession()
  } catch {
    sessionPromise = null
    return fail('moteur de détourage indisponible')
  }
  const inName = session.inputNames[0]
  const outName = session.outputNames[session.outputNames.length - 1]
  const plane = SIZE * SIZE

  // Source normalisée (auto-orient) ; dimensions RÉELLES depuis le buffer.
  const oriented = sharp(input).rotate().removeAlpha()
  const { data: rgb, info } = await oriented.clone().raw().toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height

  // Prétraitement BiRefNet : 1024², normalisation ImageNet, NCHW.
  const small = await oriented.clone().resize(SIZE, SIZE, { fit: 'fill' }).raw().toBuffer()
  const chw = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    chw[i] = (small[i * 3] / 255 - MEAN[0]) / STD[0]
    chw[plane + i] = (small[i * 3 + 1] / 255 - MEAN[1]) / STD[1]
    chw[2 * plane + i] = (small[i * 3 + 2] / 255 - MEAN[2]) / STD[2]
  }
  const results = await session.run({ [inName]: new ort.Tensor('float32', chw, [1, 3, SIZE, SIZE]) })
  const od = results[outName].data as Float32Array
  const off = od.length - plane
  let mn = Infinity
  let mx = -Infinity
  for (let i = 0; i < plane; i++) {
    const v = od[off + i]
    if (v < mn) mn = v
    if (v > mx) mx = v
  }
  const needSig = mx > 1.5 || mn < -0.5
  const alpha = Buffer.alloc(plane)
  for (let i = 0; i < plane; i++) {
    let v = od[off + i]
    if (needSig) v = 1 / (1 + Math.exp(-v))
    alpha[i] = Math.max(0, Math.min(255, Math.round(v * 255)))
  }

  // Masque 1024 → pleine résolution VIA PNG (jamais un resize de buffer BRUT 1 canal : striping).
  const maskPng = await sharp(alpha, { raw: { width: SIZE, height: SIZE, channels: 1 } })
    .png()
    .toBuffer()
  const maskFull = await sharp(maskPng)
    .resize(W, H, { fit: 'fill' })
    .toColourspace('b-w')
    .raw()
    .toBuffer()

  // Alpha appliqué aux pixels d'ORIGINE (produit intact) + rognage sur l'alpha.
  const rgba = Buffer.alloc(W * H * 4)
  let minX = W
  let minY = H
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      rgba[i * 4] = rgb[i * 3]
      rgba[i * 4 + 1] = rgb[i * 3 + 1]
      rgba[i * 4 + 2] = rgb[i * 3 + 2]
      const a = maskFull[i]
      rgba[i * 4 + 3] = a
      if (a > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return fail('aucun produit détecté dans l’image')

  const outW = maxX - minX + 1
  const outH = maxY - minY + 1
  const png = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: minX, top: minY, width: outW, height: outH })
    .png()
    .toBuffer()
  return { png, width: outW, height: outH, ok: true }
}
