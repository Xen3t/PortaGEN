import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { getJob, updateJob } from '@/lib/db'
import { getActivePrompt } from '@/lib/db/prompts'
import { generateImage } from '@/lib/genai/client'
import { config } from '@/lib/config'
import { moteurPromptName, type MoteurKey } from '@/lib/moteurs'

/**
 * Format Marketplace (carré 2000×2000) — chantier 3, bloc 3.3.
 *
 * But (retour Mathias 13/07/2026) : le PRODUIT prend un MAXIMUM de place.
 *  1. On RECADRE serré, centré sur le produit (côté ≈ sa plus GRANDE dimension).
 *  2. Si ce carré tient dans la hauteur du Site → recadrage PUR (aucune IA).
 *  3. Sinon (produit trop large) → on donne le recadrage paysage à Nano Banana Pro
 *     qui l'ÉTEND NATIVEMENT en 1:1 (outpainting : ciel en haut, sol en bas),
 *     sans couture. Pas de compositing manuel.
 *
 * PAR MOTEUR (retour Mathias 13/07/2026 — le MP portillon était faux) : le côté du
 * carré se calcule sur la plus grande dimension (un portillon est plus HAUT que
 * large — le calcul « largeur seule » de JANUS le coupait en haut et en bas), la
 * marge et l'estimation de secours sont propres au moteur, et le prompt d'extension
 * est un prompt SYSTÈME versionné du moteur (« marketplace-extension »), éditable
 * dans Admin → Réglages par moteur.
 */

const SITE_W = 2000
const SITE_H = 1330
const SQUARE = 2000

/** Filet de sécurité si le prompt versionné manque en base (base pas encore resemée). */
const EXTEND_PROMPT_FALLBACK = [
  'This is a landscape photo of an aluminium gate in front of a house.',
  'UNCROP / OUTPAINT it into a 1:1 SQUARE by generating MORE image above and below:',
  'more sky and the top of the house and architecture at the top, and more of the same paved driveway',
  'and road in the foreground at the bottom.',
  'Do NOT crop, zoom, stretch or modify the existing content — keep the gate and everything already visible',
  'exactly as it is; only ADD new area above and below to reach a square.',
  'Photorealistic, perfectly seamless continuation, matching the lighting, colours, perspective, depth of',
  'field and grain. No borders, no frame, no text, no watermark.',
].join(' ')

/** Réglages de recadrage PAR MOTEUR — jamais partagés (règle moteurs 13/07/2026). */
const CADRAGE_PAR_MOTEUR: Record<
  MoteurKey,
  { marge: number; refCm: number; fallbackFrac: { y: number; h: number } }
> = {
  // JANUS : produit large (300-400 cm), cadrage serré historique.
  battant: { marge: 1.06, refCm: 300, fallbackFrac: { y: 0.34, h: 0.44 } },
  // FORCULUS : vantail unique ~100 cm, plus haut que large → un peu d'air autour.
  portillon: { marge: 1.18, refCm: 100, fallbackFrac: { y: 0.3, h: 0.52 } },
  coulissant: { marge: 1.06, refCm: 300, fallbackFrac: { y: 0.34, h: 0.44 } },
}

export interface MarketplaceOptions {
  jobId?: number
  /** Chemin ABSOLU de la MES Site source (2000×1330). */
  sourcePath: string
  slug?: string
  lab?: boolean
  /** Zone du produit en fractions (0..1) du Site, si connue (sinon estimée via sizeW). */
  gateFrac?: { x: number; y: number; w: number; h: number }
  /** Largeur du produit en cm — estimation si gateFrac absent. */
  sizeW?: number
  /** Moteur produit — réglages de cadrage + prompt d'extension. Absent = battant. */
  moteur?: MoteurKey
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function extendPrompt(moteur: MoteurKey): string {
  try {
    return getActivePrompt(moteurPromptName(moteur, 'marketplace-extension')).content
  } catch {
    return EXTEND_PROMPT_FALLBACK
  }
}

export async function runMarketplaceStep(opts: MarketplaceOptions): Promise<{ deliveryPath: string }> {
  const jobId = opts.jobId
  if (jobId) updateJob(jobId, { status: 'running' })
  try {
    if (!fs.existsSync(opts.sourcePath)) throw new Error('MES Site source introuvable')

    const moteur: MoteurKey = opts.moteur ?? 'battant'
    const cadrage = CADRAGE_PAR_MOTEUR[moteur] ?? CADRAGE_PAR_MOTEUR.battant
    const site = await sharp(opts.sourcePath).resize(SITE_W, SITE_H, { fit: 'cover' }).toBuffer()

    // Zone du produit (px Site). gateFrac prioritaire ; sinon estimation par la taille.
    const estFrac = clamp(0.62 * ((opts.sizeW ?? cadrage.refCm) / cadrage.refCm), 0.2, 0.96)
    const gf = opts.gateFrac ?? { x: (1 - estFrac) / 2, w: estFrac, ...cadrage.fallbackFrac }
    const gw = gf.w * SITE_W
    const gh = gf.h * SITE_H
    const gcx = (gf.x + gf.w / 2) * SITE_W
    const gcy = (gf.y + gf.h / 2) * SITE_H

    // Côté du carré = la plus GRANDE dimension du produit (+ marge du moteur) :
    // largeur pour un battant, HAUTEUR pour un portillon (sinon il est coupé).
    const side = clamp(Math.round(Math.max(gw, gh) * cadrage.marge), 200, SITE_W)
    const left = clamp(Math.round(gcx - side / 2), 0, SITE_W - side)

    if (side <= SITE_H) {
      // ---- Recadrage PUR : le carré tient dans la hauteur (aucune IA).
      const top = clamp(Math.round(gcy - side / 2), 0, SITE_H - side)
      const delivery = await sharp(site)
        .extract({ left, top, width: side, height: side })
        .resize(SQUARE, SQUARE, { fit: 'fill' })
        .jpeg(config.deliveryJpeg)
        .toBuffer()
      return finish(delivery, opts, jobId, false)
    }

    // ---- Produit trop large : recadrage horizontal serré, puis EXTENSION NATIVE
    //      de Nano vers le carré (il ajoute ciel + sol lui-même, sans couture).
    const cropLandscape = await sharp(site)
      .extract({ left, top: 0, width: side, height: SITE_H })
      .jpeg({ quality: 95 })
      .toBuffer()
    const generated = await generateImage({
      prompt: extendPrompt(moteur),
      images: [{ source: cropLandscape, mimeType: 'image/jpeg' }],
      aspectRatio: '1:1',
      imageSize: '2K',
      model: config.imageModel,
      jobId,
    })
    const delivery = await sharp(generated.buffer)
      .resize(SQUARE, SQUARE, { fit: 'fill' })
      .jpeg(config.deliveryJpeg)
      .toBuffer()
    return finish(delivery, opts, jobId, true)
  } catch (err) {
    if (jobId) {
      const cur = getJob(jobId)
      if (cur && cur.status === 'running') {
        updateJob(jobId, { status: 'error', error: err instanceof Error ? err.message : String(err) })
      }
    }
    throw err
  }
}

async function finish(
  delivery: Buffer,
  opts: MarketplaceOptions,
  jobId: number | undefined,
  usedOutpaint: boolean
): Promise<{ deliveryPath: string }> {
  const slug = (opts.slug ?? 'marketplace').replace(/[^a-z0-9-]+/gi, '-').slice(0, 40).toLowerCase()
  const dir = path.join(config.artifactsDir, 'marketplace', slug)
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const deliveryAbs = path.join(dir, `livraison-2000x2000-${stamp}.jpg`)
  fs.writeFileSync(deliveryAbs, delivery)
  const deliveryPath = path.relative(config.rootDir, deliveryAbs)
  if (jobId) {
    updateJob(jobId, {
      status: 'done',
      result: JSON.stringify({
        kind: 'marketplace',
        sourcePath: path.relative(config.rootDir, opts.sourcePath),
        deliveryPath,
        usedOutpaint,
      }),
    })
  }
  return { deliveryPath }
}
