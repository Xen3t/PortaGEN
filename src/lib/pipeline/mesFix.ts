import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { config } from '@/lib/config'
import { getDb } from '@/lib/db'
import { generateImage, type ImageSize } from '@/lib/genai/client'
import { NATIVE_DIMS } from '@/lib/pipeline/nativeFormats'

/**
 * Retouche d'une MES par prompt — « studio MES » (lot 4, page Génération, 13/07/2026).
 *
 * Équivalent de decorFix mais pour la MES finale : l'image courante de la MES est
 * renvoyée à Nano Banana Pro avec la consigne de l'opérateur, encadrée par un prompt
 * système qui VERROUILLE le produit (le portail ne bouge pas) et ne change QUE ce qui
 * est demandé. Le résultat est une NOUVELLE VERSION de la MES (un nouveau job « mes-fix »
 * rattaché à la MES d'origine par `rootJobId`) — l'historique n'est jamais écrasé.
 *
 * Rien n'est persisté au catalogue : les versions sont simplement les jobs du batch.
 */

const MES_EDIT_SYSTEM = [
  'You are editing a photorealistic product photo: an aluminium GATE installed between two masonry pillars',
  'in front of a house. Apply ONLY the change requested by the operator below, and keep EVERYTHING else identical.',
  'The GATE itself (its exact shape, colour, slats, proportions and position) is LOCKED and must stay pixel-for-pixel',
  'the same. The pillars, low walls, ground line, framing, camera angle, perspective, lighting and depth of field',
  'must also stay the same unless the change explicitly concerns them.',
  'No text, no logo, no watermark, no people, no animals, no vehicles (Google Merchant Center compliant).',
  'Photorealistic, perfectly seamless. Requested change:',
].join(' ')

function imageSizeFromDims(width: number, height: number): ImageSize | null {
  for (const [k, d] of Object.entries(NATIVE_DIMS)) {
    if (d.width === width && d.height === height) return k as ImageSize
  }
  return null
}

export interface MesFixOptions {
  jobId?: number
  /** Chemin ABSOLU de l'image source (rendu natif de la version à retoucher). */
  sourcePath: string
  /** Consigne de l'opérateur (français). */
  instruction: string
  /** Identifie la MES : id du job d'intégration d'origine (version 1). */
  rootJobId: number
  size?: { w: number; h: number }
  coloris?: string
  /** Zone du portail (fractions) reportée pour le recadrage Marketplace. */
  gateFrac?: { x: number; y: number; w: number; h: number }
  slug?: string
}

export async function runMesFixStep(opts: MesFixOptions): Promise<{ deliveryPath: string }> {
  const db = getDb()
  const instruction = (opts.instruction ?? '').trim()
  if (!instruction) throw new Error('Consigne de retour vide')

  let jobId = opts.jobId
  if (jobId === undefined) {
    const job = db
      .prepare(`INSERT INTO jobs (type, status, payload) VALUES ('mes-fix', 'running', ?)`)
      .run(JSON.stringify({ ...opts, instruction }))
    jobId = Number(job.lastInsertRowid)
  }

  try {
    if (!fs.existsSync(opts.sourcePath)) {
      throw new Error('Image source de la MES introuvable sur le disque')
    }
    const meta = await sharp(opts.sourcePath).metadata()
    const imageSize = imageSizeFromDims(meta.width ?? 0, meta.height ?? 0) ?? '4K'
    const slug = (opts.slug ?? `mes-${opts.rootJobId}`)
      .replace(/[^a-z0-9-]+/gi, '-')
      .slice(0, 40)
      .toLowerCase()

    const img = await generateImage({
      prompt: `${MES_EDIT_SYSTEM}\n${instruction}`,
      images: [{ source: opts.sourcePath }],
      aspectRatio: '3:2',
      imageSize,
      jobId,
      artifactName: `mes-retouche-${imageSize}`,
      artifactDir: path.join('generation-mes', slug),
    })

    // Livraison finale (toujours 2000×1330).
    const dir = path.join(config.artifactsDir, 'generation-mes', slug)
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const deliveryAbs = path.join(
      dir,
      `livraison-${config.delivery.width}x${config.delivery.height}-${stamp}.jpg`
    )
    const delivery = await sharp(img.buffer)
      .resize(config.delivery.width, config.delivery.height, { fit: 'fill' })
      .jpeg(config.deliveryJpeg)
      .toBuffer()
    fs.writeFileSync(deliveryAbs, delivery)
    const deliveryPath = path.relative(config.rootDir, deliveryAbs)

    db.prepare(
      `UPDATE jobs SET status = 'done', result = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      JSON.stringify({
        kind: 'mes-fix',
        rootJobId: opts.rootJobId,
        instruction,
        deliveryPath,
        rawOutputPath: path.relative(config.rootDir, img.artifactPath),
        zoneFrac: opts.gateFrac,
      }),
      jobId
    )
    return { deliveryPath }
  } catch (err) {
    db.prepare(
      `UPDATE jobs SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(err instanceof Error ? err.message : String(err), jobId)
    throw err
  }
}
