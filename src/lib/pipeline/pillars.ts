import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { config } from '@/lib/config'
import { getDb } from '@/lib/db'
import { getActivePrompt } from '@/lib/db/prompts'
import { generateImage, type ImageSize } from '@/lib/genai/client'
import { DEFAULT_PARAMS, type GabaritParams, type SizeCm } from '@/lib/geometry'
import { overlayGabaritOnDecor, gabaritMask } from '@/lib/images/gabarits'
import { whiteLineBands, horizontalEdgeProfile, bandPatternShift } from '@/lib/images/analyze'
import { estimateShift, applyShift, compositeWithMask } from '@/lib/images/composite'
import { addShadowsToMask } from '@/lib/images/shadows'
import { resizeExact } from '@/lib/images/resize'
import { getMoteurReglages, moteurPromptName, type MoteurKey } from '@/lib/moteurs'
import { NATIVE_DIMS } from '@/lib/pipeline/nativeFormats'
import { cannyRefPath } from '@/lib/server/cannyRef'

export interface PillarsStepOptions {
  /** Décor issu de l'étape 1, au format natif */
  decorPath: string
  size: SizeCm
  params?: Partial<GabaritParams>
  /** CANNY de référence pour l'alignement (bandes normalisées) */
  cannyPath?: string
  /**
   * Alignement de la ligne de sol sur le trottoir réel du décor :
   * 'auto' = décalage mesuré, 'off' = aucun, nombre = décalage manuel en px (positif = plus bas).
   */
  align?: 'auto' | 'off' | number
  imageModel?: string
  slug?: string
  /**
   * Masquage de la sortie : 'off' (DÉFAUT, décision Mathias 11/07/2026 — le rendu
   * brut de Nano est l'image finale de l'étape, pas de masque ni de compositing) ou
   * 'pixel-lock' (ancien comportement : masque + ombres détectées + compositing,
   * conservé en réserve pour comparaison).
   */
  masking?: 'off' | 'pixel-lock'
  /** Marge du masque autour des aplats (ombres de contact), en px natifs — pixel-lock */
  maskMarginPx?: number
  featherSigma?: number
  /** Conservation des ombres portées générées (pixel-lock) : détection auto par défaut */
  shadows?: 'auto' | 'off'
  /** Moteur produit (13/07/2026) : ses réglages, ses prompts. Absent = battant. */
  moteur?: MoteurKey
  /** Job existant (créé par le runner) — sinon la fonction crée le sien (scripts CLI) */
  jobId?: number
}

export interface PillarsStepResult {
  jobId: number
  sizeLabel: string
  width: number
  height: number
  imageSize: ImageSize
  /** Décalage de ligne de sol appliqué (px natifs, positif = descendu) */
  groundOffsetPxNative: number
  /**
   * Provenance de l'alignement : 'measured' (trottoir mesuré), 'fallback-canny'
   * (mesure non concluante → position du CANNY de référence, sur laquelle les
   * gabarits sont calibrés — plan de base, décision Mathias 11/07/2026),
   * 'manual' (décalage fourni), 'off' (désactivé).
   */
  groundAlign: 'measured' | 'fallback-canny' | 'manual' | 'off'
  overlayPath: string
  /** null quand le masquage est désactivé (rendu brut) */
  maskPath: string | null
  rawOutputPath: string
  /** Image finale de l'étape (sortie brute recalée si masquage off, composite sinon) */
  compositePath: string
  alignShift: { dx: number; dy: number; atBound: boolean }
  nativeSizeRespected: boolean
  masking: 'off' | 'pixel-lock'
  /** null quand le masquage est désactivé */
  changedFraction: number | null
  /** Fraction d'image ajoutée au masque au titre des ombres détectées (0..1, pixel-lock) */
  shadowFraction: number
  shadowAborted: boolean
}

function imageSizeFromDims(width: number, height: number): ImageSize | null {
  for (const [k, d] of Object.entries(NATIVE_DIMS)) {
    if (d.width === width && d.height === height) return k as ImageSize
  }
  return null
}

/**
 * Étape 2 du pipeline MES Contraintes : piliers & murets.
 * 1. Aligne la ligne de sol des gabarits sur le trottoir réel du décor (mesuré).
 * 2. Superpose les aplats gris et fait rendre le stucco par Nano Banana.
 * 3. Recale la sortie si besoin, puis compositing pixel-lock : hors zones de maçonnerie,
 *    chaque pixel provient du décor d'origine, à l'octet près.
 */
export async function runPillarsStep(opts: PillarsStepOptions): Promise<PillarsStepResult> {
  const decorMeta = await sharp(opts.decorPath).metadata()
  const width = decorMeta.width ?? 0
  const height = decorMeta.height ?? 0
  const imageSize = imageSizeFromDims(width, height)
  if (!imageSize) {
    throw new Error(
      `Le décor ${width}x${height} n'est pas à un format natif Nano Banana (attendus : ${Object.values(
        NATIVE_DIMS
      )
        .map((d) => `${d.width}x${d.height}`)
        .join(', ')})`
    )
  }

  const sizeLabel = `${opts.size.w}x${opts.size.h}`
  const slug = opts.slug ?? 'pillars'
  // Réglages DU MOTEUR DU JOB (Admin → Réglages par moteur, câblés le 13/07/2026) :
  // ils servent de DÉFAUT quand l'appelant ne précise rien. Jamais partagés entre
  // moteurs. Hiérarchie : appel explicite > réglage coloris (catalogue) > moteur > code.
  const moteurKey: MoteurKey = opts.moteur ?? 'battant'
  const moteur = getMoteurReglages(moteurKey)
  const align =
    opts.align ??
    (moteur.cannyPlacement === 'manuel' ? moteur.cannyOffsetPx : moteur.cannyPlacement)
  // CANNY du MOTEUR : image personnalisée déposée dans l'admin, sinon trottoir d'origine.
  const cannyPath = opts.cannyPath ?? cannyRefPath(moteurKey)

  const db = getDb()
  let jobId = opts.jobId
  if (jobId === undefined) {
    const job = db
      .prepare(`INSERT INTO jobs (type, status, payload) VALUES ('pillars', 'running', ?)`)
      .run(JSON.stringify({ decorPath: opts.decorPath, size: opts.size, align, slug }))
    jobId = Number(job.lastInsertRowid)
  }

  try {
    // 1. Alignement de la ligne de sol sur le trottoir réel.
    //    Position PAR DÉFAUT calibrée sur le CANNY de référence (ligne de sol des
    //    gabarits à 76,9 % ↔ bande trottoir du CANNY à 77,1 %) : le décor étant
    //    lui-même généré sur ce CANNY, le repli « offset 0 » quand la mesure est
    //    non concluante est le PLAN DE BASE, pas un pis-aller (Mathias 11/07/2026).
    let groundOffsetPxNative = 0
    let groundAlign: PillarsStepResult['groundAlign']
    if (typeof align === 'number') {
      groundOffsetPxNative = Math.round(align)
      groundAlign = 'manual'
    } else if (align === 'auto') {
      const bands = (await whiteLineBands(cannyPath)).filter((b) => b.yNorm > 0.5)
      const profile = await horizontalEdgeProfile(opts.decorPath)
      const match = bandPatternShift(
        profile,
        bands.map((b) => b.yNorm)
      )
      if (match) {
        groundOffsetPxNative = Math.round(match.shiftNorm * height)
        groundAlign = 'measured'
      } else {
        groundAlign = 'fallback-canny'
      }
    } else {
      groundAlign = 'off'
    }

    const baseParams: GabaritParams = { ...DEFAULT_PARAMS, ...opts.params }
    // Conversion px → cm : la scène fait sceneH cm pour `height` px.
    const offsetCm = (groundOffsetPxNative / height) * baseParams.sceneH
    const adjustedParams: Partial<GabaritParams> = {
      ...opts.params,
      groundY: baseParams.groundY - offsetCm,
    }

    // 2. Aplats + masque, avec les mêmes paramètres ajustés.
    const dir = path.join(config.artifactsDir, 'pillars', slug, sizeLabel)
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')

    const { image: overlay } = await overlayGabaritOnDecor(opts.decorPath, opts.size, adjustedParams)
    const overlayPath = path.join(dir, `1-entree-aplats-${stamp}.png`)
    fs.writeFileSync(overlayPath, overlay)

    const masking = opts.masking ?? moteur.masking

    // 3. Rendu stucco par Nano Banana (prompt système versionné, PROPRE au moteur).
    const promptRow = getActivePrompt(moteurPromptName(moteurKey, 'piliers-murets'))
    const generated = await generateImage({
      prompt: promptRow.content,
      images: [{ source: overlay, mimeType: 'image/png' }],
      aspectRatio: '3:2',
      imageSize,
      model: opts.imageModel,
      jobId,
      artifactName: `3-sortie-brute-${sizeLabel}`,
      artifactDir: path.join('pillars', slug, sizeLabel),
    })

    // 4. Sécurités dimensionnelles : format natif + recalage global.
    const nativeSizeRespected = generated.width === width && generated.height === height
    let output = generated.buffer
    if (!nativeSizeRespected) {
      output = await resizeExact(output, width, height)
    }
    // Recalage global : si l'estimation sature à ±8 px, on élargit une fois à ±16 ;
    // si elle sature encore, on n'applique RIEN — mieux vaut aucun recalage qu'un
    // recalage tronqué.
    let shift = await estimateShift(overlay, output, 8, 4)
    if (shift.atBound) shift = await estimateShift(overlay, output, 16, 4)
    if (shift.atBound) {
      shift = { dx: 0, dy: 0, score: shift.score, atBound: true }
    } else if (shift.dx !== 0 || shift.dy !== 0) {
      output = await applyShift(output, shift.dx, shift.dy)
    }

    // 5. Image finale de l'étape.
    //    Masquage OFF (défaut, décision Mathias 11/07/2026) : le rendu brut de Nano
    //    (recalé si besoin) EST l'image finale — pas de masque, pas de détection
    //    d'ombres, pas de compositing. Le pixel-lock complet reste disponible via
    //    masking: 'pixel-lock' (« on verra plus tard si besoin »).
    let maskPath: string | null = null
    let shadowFraction = 0
    let shadowAborted = false
    let changedFraction: number | null = null
    let finalImage = output
    if (masking === 'pixel-lock') {
      const baseMask = await gabaritMask(
        opts.size,
        adjustedParams,
        width,
        height,
        opts.maskMarginPx ?? 24
      )
      // Ombres portées : détection automatique (diff sortie/décor, croissance depuis
      // la maçonnerie) — l'ombre dessinée par le modèle rejoint le masque.
      let mask = baseMask
      if ((opts.shadows ?? moteur.shadows) === 'auto') {
        const det = await addShadowsToMask(opts.decorPath, output, baseMask)
        mask = det.mask
        shadowFraction = det.shadowFraction
        shadowAborted = det.aborted
      }
      maskPath = path.join(dir, `2-masque-${stamp}.png`)
      fs.writeFileSync(maskPath, mask)
      const composited = await compositeWithMask(opts.decorPath, output, mask, opts.featherSigma ?? 4)
      finalImage = composited.image
      changedFraction = composited.changedFraction
    }
    const compositePath = path.join(dir, `4-finale-${stamp}.png`)
    fs.writeFileSync(compositePath, finalImage)

    const result: PillarsStepResult = {
      jobId,
      sizeLabel,
      width,
      height,
      imageSize,
      groundOffsetPxNative,
      groundAlign,
      overlayPath,
      maskPath,
      rawOutputPath: generated.artifactPath,
      compositePath,
      alignShift: { dx: shift.dx, dy: shift.dy, atBound: shift.atBound },
      nativeSizeRespected,
      masking,
      changedFraction,
      shadowFraction,
      shadowAborted,
    }

    db.prepare(
      `UPDATE jobs SET status = 'done', result = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      JSON.stringify({
        kind: 'pillars',
        sizeLabel,
        imageSize,
        overlayPath: path.relative(config.rootDir, overlayPath),
        maskPath: maskPath ? path.relative(config.rootDir, maskPath) : undefined,
        rawOutputPath: path.relative(config.rootDir, generated.artifactPath),
        compositePath: path.relative(config.rootDir, compositePath),
        promptVersion: promptRow.version,
        groundOffsetPxNative,
        groundAlign,
        alignShift: result.alignShift,
        nativeSizeRespected,
        masking,
        changedFraction:
          changedFraction === null ? undefined : Number(changedFraction.toFixed(4)),
        shadowFraction: masking === 'pixel-lock' ? Number(shadowFraction.toFixed(4)) : undefined,
        shadowAborted: masking === 'pixel-lock' ? shadowAborted : undefined,
      }),
      jobId
    )
    return result
  } catch (err) {
    db.prepare(
      `UPDATE jobs SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(err instanceof Error ? err.message : String(err), jobId)
    throw err
  }
}
