import path from 'node:path'
import fs from 'node:fs'
import sharp from 'sharp'
import * as ort from 'onnxruntime-node'
import { config } from '@/lib/config'

/**
 * Empreintes visuelles pour la détection des images (chantier 24/07/2026) —
 * DINOv2-small (Meta, licence Apache 2.0), exporté ONNX (repo Xenova/dinov2-small),
 * exécuté EN LOCAL via onnxruntime-node comme le détourage BiRefNet. Aucune
 * image ne quitte le poste, aucun coût par appel.
 *
 * Une empreinte = 384 nombres (jeton CLS) qui résument CE QUE MONTRE l'image
 * (silhouette, cadrage, style) — mesuré le 24/07 : ~140 ms/image CPU, deux faces
 * gris/noir ≈ 0,98 de similarité (la couleur n'y est presque pas ⇒ le coloris
 * se classe à part, par mesure de couleur, voir classify.ts).
 */

const MODEL_PATH = path.join(config.rootDir, 'models', 'dinov2-small.onnx')
/** Prétraitement officiel du modèle (preprocessor_config.json du repo). */
const RESIZE = 256
const CROP = 224
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

export const EMBEDDING_DIM = 384

export function embeddingModelAvailable(): boolean {
  return fs.existsSync(MODEL_PATH)
}

let sessionPromise: Promise<ort.InferenceSession> | null = null
function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) sessionPromise = ort.InferenceSession.create(MODEL_PATH)
  return sessionPromise
}

/**
 * Empreinte d'une image (chemin ou buffer). Les PNG détourés sont APLATIS SUR
 * BLANC d'abord — l'alpha disparaît du raw sinon, et un portail transparent
 * deviendrait une empreinte de bruit.
 */
export async function computeEmbedding(input: Buffer | string): Promise<Float32Array> {
  const session = await getSession().catch((e) => {
    sessionPromise = null
    throw e
  })
  const raw = await sharp(input)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(RESIZE, RESIZE, { fit: 'outside' })
    .resize(CROP, CROP, { fit: 'cover', position: 'centre' })
    .removeAlpha()
    .raw()
    .toBuffer()
  const plane = CROP * CROP
  const chw = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    chw[i] = (raw[i * 3] / 255 - MEAN[0]) / STD[0]
    chw[plane + i] = (raw[i * 3 + 1] / 255 - MEAN[1]) / STD[1]
    chw[2 * plane + i] = (raw[i * 3 + 2] / 255 - MEAN[2]) / STD[2]
  }
  const out = await session.run({
    [session.inputNames[0]]: new ort.Tensor('float32', chw, [1, 3, CROP, CROP]),
  })
  const t = out[session.outputNames[0]]
  const hidden = t.dims[t.dims.length - 1]
  // Jeton CLS = résumé global de l'image (les 256 autres jetons sont locaux).
  return (t.data as Float32Array).slice(0, hidden)
}

/** Similarité cosinus entre deux empreintes (1 = identiques). */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const d = Math.sqrt(na * nb)
  return d === 0 ? 0 : dot / d
}

/** Sérialisation BLOB SQLite ↔ Float32Array. */
export function embeddingToBlob(e: Float32Array): Buffer {
  return Buffer.from(e.buffer, e.byteOffset, e.byteLength)
}

export function blobToEmbedding(blob: Buffer): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4)
}
