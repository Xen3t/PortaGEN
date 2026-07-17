import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { config } from '@/lib/config'
import { getDb, getJob } from '@/lib/db'
import { getActivePrompt } from '@/lib/db/prompts'
import { generateImage, type ImageSize } from '@/lib/genai/client'
import {
  computeLayout,
  projection,
  projectRect,
  DEFAULT_PARAMS,
  type GabaritParams,
  type SizeCm,
} from '@/lib/geometry'
import { estimateShift, applyShift, compositeWithMask } from '@/lib/images/composite'
import { measureInnerPillarEdges } from '@/lib/images/analyze'
import { addShadowsToMask } from '@/lib/images/shadows'
import {
  prepareProduct,
  parseSizeFromProductName,
  type PillarDetection,
} from '@/lib/images/product'
import { productInvariance } from '@/lib/images/invariance'
import { getMoteurReglages, moteurPromptName, type MoteurKey } from '@/lib/moteurs'
import { NATIVE_DIMS } from '@/lib/pipeline/nativeFormats'

export type IntegrationMethod = 'simple' | 'rectangle' | 'pose-directe'

export interface IntegrationStepOptions {
  /** Job Piliers terminé dont on part (composite + géométrie + décalage de sol) */
  pillarsJobId: number
  /** Image produit (PNG détouré de préférence ; fond blanc uni accepté) */
  productPath: string
  /**
   * 'simple' (défaut, décision Mathias 11/07/2026) : rectangle rouge à l'empreinte
   * exacte du portail (gabarit), PNG produit envoyé tel quel en 2ᵉ image, sortie du
   * modèle = image finale — aucune détection, aucune invariance, aucun masque.
   * 'rectangle' : ex-défaut (calage sur piliers rendus, pixel-lock, ombres, invariance).
   * 'pose-directe' : méthode archivée (produit posé pixel par pixel avant l'appel) —
   * cf. docs/ARCHIVE-methode-pose-directe.md.
   */
  method?: IntegrationMethod
  imageModel?: string
  /** Ombres auto/off — méthodes 'rectangle' et 'pose-directe' uniquement */
  shadows?: 'auto' | 'off'
  /** Moteur produit (13/07/2026) : ses réglages, ses prompts. Absent = battant. */
  moteur?: MoteurKey
  jobId?: number
}

/** Résultat de la méthode « simple » : la sortie brute du modèle est l'image finale. */
export interface IntegrationSimpleResult {
  jobId: number
  method: 'simple'
  sizeLabel: string
  width: number
  height: number
  /** Empreinte du portail (rectangle rouge), en px natifs */
  zonePx: { x: number; y: number; w: number; h: number }
  inputPath: string
  rawOutputPath: string
  deliveryPath: string
  nativeSizeRespected: boolean
  promptVersion: number
}

export interface IntegrationStepResult {
  jobId: number
  method: 'rectangle' | 'pose-directe'
  sizeLabel: string
  width: number
  height: number
  zonePx: { x: number; y: number; w: number; h: number }
  /** Zone d'ancrage (portail + moitié intérieure des piliers) couverte par le rectangle et le masque */
  anchorZonePx: { x: number; y: number; w: number; h: number }
  /** Décalage mesuré entre pilier rendu et aplat théorique (px, null = bord non mesurable) */
  pillarEdgeShiftPx: { left: number | null; right: number | null }
  /** Dépassement du produit hors zone : gonds sur les piliers, quincaillerie sous les vantaux (px natifs) */
  hingeOverlapPx: { left: number; right: number; bottom: number }
  /** true si le dépassement détecté était anormal → pose historique (boîte englobante) */
  hingeFallback: boolean
  /** Visuel de contrôle du retrait des piliers du visuel produit (null si rien à montrer) */
  detourPath: string | null
  productPillars: PillarDetection | null
  placedPath: string
  inputPath: string
  maskPath: string
  rawOutputPath: string
  compositePath: string
  deliveryPath: string
  invarianceScore: number
  invarianceOk: boolean
  shadowFraction: number
  shadowAborted: boolean
  nativeSizeRespected: boolean
  alignShift: { dx: number; dy: number; atBound: boolean }
  promptVersion: number
}

/** Consigne moteur commune : jamais d'ombre projetée devant, pas de végétation sur le portail. */
const SHADOW_ADDENDUM = `

SHADOW DIRECTION (binding): the gate must NEVER cast a shadow forward, toward the camera, onto the sidewalk or the driveway in front of it. Only a very subtle, tight contact shadow at its base is allowed. No grass, leaves or vegetation may overlap or touch the gate; if vegetation appears at the gate base inside the work area, replace it with the paved driveway surface.`

/**
 * Consigne moteur de la méthode ARCHIVÉE « pose-directe » : le produit est déjà posé
 * dans l'image, le rectangle colle au portail et chevauche la moitié des piliers.
 */
const HINGE_ADDENDUM = `

IMPORTANT — MOUNTING: the red rectangle deliberately overlaps the inner half of the two masonry pillars. The gate is MOUNTED ON these pillars and its hinges are ALREADY PRESENT in the image, overlapping the pillars' inner faces at their exact mounting position. Blend these existing hinges naturally into the pillars (lighting, contact shadows). The gate leaves rest at ground level; the central locking rod and hinge feet slightly overlap the driveway — keep them and give them their contact shadows. Do NOT invent any additional hardware, do NOT widen the gap between the gate and the pillars, and do not modify the pillars in any other way (same stucco, same edges, same lighting).${SHADOW_ADDENDUM}`

function imageSizeFromDims(width: number, height: number): ImageSize | null {
  for (const [k, d] of Object.entries(NATIVE_DIMS)) {
    if (d.width === width && d.height === height) return k as ImageSize
  }
  return null
}

/**
 * Étape 3 du pipeline MES Contraintes : intégration du produit.
 * Méthode par défaut « simple » (Mathias 11/07/2026) : rectangle rouge issu du gabarit
 * (empreinte exacte du portail entre les piliers), PNG produit envoyé tel quel en
 * 2ᵉ image, et la sortie de Nano Banana EST l'image finale. Pas de détection, pas
 * d'invariance, pas de masque de compositing — on teste et on ramifie selon les retours.
 * Méthodes archivées : « rectangle » (ex-défaut : pixel-lock, calage sur piliers
 * rendus, ombres, invariance) et « pose-directe » (produit posé pixel par pixel,
 * docs/ARCHIVE-methode-pose-directe.md).
 */
export async function runIntegrationStep(
  opts: IntegrationStepOptions
): Promise<IntegrationStepResult | IntegrationSimpleResult> {
  const db = getDb()
  let jobId = opts.jobId
  if (jobId === undefined) {
    const job = db
      .prepare(`INSERT INTO jobs (type, status, payload) VALUES ('integration', 'running', ?)`)
      .run(JSON.stringify({ pillarsJobId: opts.pillarsJobId, productPath: opts.productPath }))
    jobId = Number(job.lastInsertRowid)
  }

  try {
    // Contexte hérité du job Piliers : image de base, taille, réglages, décalage de sol.
    const pillarsJob = getJob(opts.pillarsJobId)
    if (!pillarsJob || pillarsJob.type !== 'pillars' || pillarsJob.status !== 'done' || !pillarsJob.result) {
      throw new Error(`Job Piliers #${opts.pillarsJobId} introuvable ou non terminé`)
    }
    const pr = JSON.parse(pillarsJob.result) as {
      compositePath: string
      sizeLabel: string
      groundOffsetPxNative: number
    }
    const pillarsPayload = (pillarsJob.payload ? JSON.parse(pillarsJob.payload) : {}) as {
      size?: SizeCm | string
      params?: Partial<GabaritParams>
      slug?: string
    }
    // La taille du job Piliers peut être un objet {w,h} (UI) ou un label « 300x140 »
    // (scripts) — le sizeLabel du résultat fait foi en dernier recours.
    const [wCm, hCm] = pr.sizeLabel.split('x').map(Number)
    const size: SizeCm =
      typeof pillarsPayload.size === 'object' &&
      pillarsPayload.size !== null &&
      Number.isFinite(pillarsPayload.size.w) &&
      Number.isFinite(pillarsPayload.size.h)
        ? pillarsPayload.size
        : { w: wCm, h: hCm }

    const baseImagePath = path.resolve(config.rootDir, pr.compositePath)
    const meta = await sharp(baseImagePath).metadata()
    const width = meta.width ?? 0
    const height = meta.height ?? 0
    const imageSize = imageSizeFromDims(width, height)
    if (!imageSize) throw new Error(`Image Piliers ${width}x${height} hors formats natifs`)

    // Zone produit : même géométrie et même décalage de sol que l'étape Piliers.
    const baseParams: GabaritParams = { ...DEFAULT_PARAMS, ...(pillarsPayload.params ?? {}) }
    const offsetCm = ((pr.groundOffsetPxNative ?? 0) / height) * baseParams.sceneH
    const adjustedParams: Partial<GabaritParams> = {
      ...(pillarsPayload.params ?? {}),
      groundY: baseParams.groundY - offsetCm,
    }
    const layout = computeLayout(size, adjustedParams)
    const p = projection(width, height, layout.sceneW, layout.sceneH)
    const zoneTheoretical = projectRect(
      { x: layout.gateLeft, y: layout.gateTop, w: layout.gateW, h: layout.gateH },
      p
    )

    const slug = pillarsPayload.slug ?? 'integration'
    const dir = path.join(config.artifactsDir, 'integration', slug, pr.sizeLabel)
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')

    // Verrou taille : la nomenclature produit (« 300B140 ») doit correspondre à la
    // taille du job — toute déformation du produit est interdite par le brief.
    const nameSize = parseSizeFromProductName(path.basename(opts.productPath))
    if (nameSize && (nameSize.w !== size.w || nameSize.h !== size.h)) {
      throw new Error(
        `Produit incompatible : « ${path.basename(opts.productPath)} » est un ${nameSize.w}×${nameSize.h} cm, ` +
          `ce job Piliers est un ${size.w}×${size.h}. Utilisez le PNG du produit ${size.w}×${size.h}, ` +
          `ou lancez une gamme ${nameSize.w}×${nameSize.h}.`
      )
    }

    // Défaut = réglage DU MOTEUR DU JOB (Admin → Réglages par moteur, câblé le
    // 13/07/2026) ; un appel explicite (Lab, API) garde la priorité.
    const moteurKey: MoteurKey = opts.moteur ?? 'battant'
    const moteur = getMoteurReglages(moteurKey)
    const method = opts.method ?? moteur.integrationMethod
    const strokeW = Math.max(3, Math.round(width / 840))

    if (method === 'simple') {
      // ============ MÉTHODE PAR DÉFAUT : « simple » (décision Mathias 11/07/2026) ============
      // Le rectangle rouge est l'empreinte exacte du portail donnée par le gabarit
      // (largeur du passage entre piliers, hauteur du portail, bas au sol). Le PNG
      // produit part TEL QUEL en 2ᵉ image. La sortie brute du modèle est l'image
      // finale — aucun recalage, aucun masque, aucun contrôle automatique.
      //
      // COULISSANT « TERMINUS » (recherche validée 13/07/2026, docs/
      // MOTEUR-COULISSANT-prompt.md) : la lame est plus large que l'ouverture, son
      // bord droit disparaît DERRIÈRE le pilier droit. Le rectangle s'étend de
      // ~50 % de la largeur du pilier droit EN RECOUVREMENT, bord gauche ancré EN
      // DUR sur l'ouverture (le prolonger autrement fait tout glisser à droite).
      let zone = zoneTheoretical
      if (moteurKey === 'coulissant') {
        const pRight = projectRect(layout.pillarRight, p)
        zone = { ...zoneTheoretical, w: zoneTheoretical.w + Math.round(pRight.w * 0.5) }
      }
      const rectSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <rect x="${zone.x - strokeW - 1}" y="${zone.y - strokeW - 1}" width="${zone.w + 2 * (strokeW + 1)}" height="${zone.h + 2 * (strokeW + 1)}" fill="none" stroke="#FF0000" stroke-width="${strokeW}"/>
      </svg>`
      const inputImage = await sharp(baseImagePath)
        .composite([{ input: Buffer.from(rectSvg) }])
        .png()
        .toBuffer()
      const inputPath = path.join(dir, `1-entree-rect-rouge-${stamp}.png`)
      fs.writeFileSync(inputPath, inputImage)

      const promptRow = getActivePrompt(moteurPromptName(moteurKey, 'integration-simple'))
      const productMime = /\.jpe?g$/i.test(opts.productPath)
        ? 'image/jpeg'
        : /\.webp$/i.test(opts.productPath)
          ? 'image/webp'
          : 'image/png'
      const generated = await generateImage({
        prompt: promptRow.content,
        images: [
          { source: inputImage, mimeType: 'image/png' },
          { source: fs.readFileSync(opts.productPath), mimeType: productMime },
        ],
        aspectRatio: '3:2',
        imageSize,
        model: opts.imageModel,
        jobId,
        artifactName: `2-sortie-brute-${pr.sizeLabel}`,
        artifactDir: path.join('integration', slug, pr.sizeLabel),
      })
      const nativeSizeRespected = generated.width === width && generated.height === height

      // Livraison e-commerce : l'UNIQUE transformation appliquée à la sortie du modèle.
      const delivery = await sharp(generated.buffer)
        .resize(config.delivery.width, config.delivery.height, { fit: 'fill' })
        .jpeg(config.deliveryJpeg)
        .toBuffer()
      const deliveryPath = path.join(
        dir,
        `3-livraison-${config.delivery.width}x${config.delivery.height}-${stamp}.jpg`
      )
      fs.writeFileSync(deliveryPath, delivery)

      const result: IntegrationSimpleResult = {
        jobId,
        method: 'simple',
        sizeLabel: pr.sizeLabel,
        width,
        height,
        zonePx: { x: zone.x, y: zone.y, w: zone.w, h: zone.h },
        inputPath,
        rawOutputPath: generated.artifactPath,
        deliveryPath,
        nativeSizeRespected,
        promptVersion: promptRow.version,
      }
      db.prepare(
        `UPDATE jobs SET status = 'done', result = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(
        JSON.stringify({
          kind: 'integration',
          method: 'simple',
          sizeLabel: pr.sizeLabel,
          pillarsJobId: opts.pillarsJobId,
          productPath: path.relative(config.rootDir, opts.productPath),
          inputPath: path.relative(config.rootDir, inputPath),
          rawOutputPath: path.relative(config.rootDir, generated.artifactPath),
          deliveryPath: path.relative(config.rootDir, deliveryPath),
          zonePx: result.zonePx,
          // Zone produit en FRACTIONS (0..1) — sert au recadrage Marketplace,
          // indépendant de la résolution native (bloc 3.3).
          zoneFrac: {
            x: zone.x / width,
            y: zone.y / height,
            w: zone.w / width,
            h: zone.h / height,
          },
          nativeSizeRespected,
          promptVersion: promptRow.version,
        }),
        jobId
      )
      return result
    }

    // ============ MÉTHODES ARCHIVÉES : « rectangle » (ex-défaut) et « pose-directe » ============
    // Calage sur les piliers RENDUS : à l'étape Piliers, le modèle peut rendre le stucco
    // quelques centimètres plus large ou plus étroit que l'aplat théorique (dans la marge
    // du masque). On mesure les bords intérieurs réels et on y colle la zone produit —
    // sinon un vide apparaît entre portail et pilier, que le modèle comble n'importe comment.
    const edges = await measureInnerPillarEdges(baseImagePath, zoneTheoretical)
    const zoneLeft = edges.left ?? zoneTheoretical.x
    const zoneRight = edges.right ?? zoneTheoretical.x + zoneTheoretical.w
    const zone = { ...zoneTheoretical, x: zoneLeft, w: zoneRight - zoneLeft }
    const pillarEdgeShiftPx = {
      left: edges.left === null ? null : zoneLeft - zoneTheoretical.x,
      right: edges.right === null ? null : zoneRight - (zoneTheoretical.x + zoneTheoretical.w),
    }

    // Zone d'ancrage : la zone produit élargie sur la moitié intérieure de chaque pilier.
    // Le rectangle rouge et le masque pixel-lock la couvrent, pour que le modèle fixe les
    // gonds SUR les piliers et que ces gonds survivent au compositing.
    const halfPillarPx = Math.round((baseParams.pillarWidth / 2) * p.sx)
    const anchor = {
      x: zone.x - halfPillarPx,
      y: zone.y,
      w: zone.w + 2 * halfPillarPx,
      h: zone.h,
    }

    // 1. Produit préparé : détourage de secours, rognage des marges, et retrait des
    //    piliers présents dans le visuel (ce sont les piliers du décor qui encadrent
    //    le portail — jamais ceux du PNG produit). Puis pose à sa taille exacte.
    const product = await prepareProduct(opts.productPath, {
      removePillars: true,
      expectedSize: size,
    })
    let detourPath: string | null = null
    if (product.annotated) {
      detourPath = path.join(dir, `0-detourage-piliers-${stamp}.png`)
      fs.writeFileSync(detourPath, product.annotated)
    }
    // Sans taille dans le nom : garde-fou de proportion (photo non frontale, mauvais export…).
    // Le ratio pertinent est celui du CADRE (hors gonds et tige qui dépassent).
    const zoneRatio = zone.w / zone.h
    const productRatio =
      (product.width - product.frameInsetLeftPx - product.frameInsetRightPx) /
      Math.max(1, product.height - product.frameInsetBottomPx)
    const ratioDeviation = Math.abs(productRatio - zoneRatio) / zoneRatio
    const deformationWarning = !nameSize && ratioDeviation > 0.08

    const margin = 20

    let placed: Buffer
    let inputImage: Buffer
    let attachProduct = false
    let hingeOverlap = { left: 0, right: 0, bottom: 0 }
    let hingeFallback = false
    let maskRect = { x: anchor.x, y: anchor.y, w: anchor.w, h: anchor.h }
    let shadowFloorY = Math.min(height, zone.y + zone.h + margin)

    if (method === 'pose-directe') {
      // ============ MÉTHODE ARCHIVÉE (docs/ARCHIVE-methode-pose-directe.md) ============
      // Pose calée sur le CADRE du portail (pas sur la boîte englobante) : le cadre fait
      // exactement la largeur du passage ; les gonds chevauchent la face des piliers.
      let insetL = product.frameInsetLeftPx
      let insetR = product.frameInsetRightPx
      const maxOverlapPx = zone.x - anchor.x // moitié intérieure du pilier
      const scaleFor = (l: number, r: number) => zone.w / Math.max(1, product.width - l - r)
      if (
        Math.round(insetL * scaleFor(insetL, insetR)) > maxOverlapPx ||
        Math.round(insetR * scaleFor(insetL, insetR)) > maxOverlapPx
      ) {
        insetL = 0
        insetR = 0
        hingeFallback = true
      }
      const s = scaleFor(insetL, insetR)
      const scaledW = Math.max(zone.w, Math.round(product.width * s))
      // Verticalement : le BAS DES VANTAUX se cale sur le sol ; la quincaillerie déborde.
      let insetB = product.frameInsetBottomPx
      const scaleVFor = (b: number) => zone.h / Math.max(1, product.height - b)
      if (Math.round(insetB * scaleVFor(insetB)) > Math.round(zone.h * 0.08)) {
        insetB = 0
        hingeFallback = true
      }
      const scaledH = Math.max(zone.h, Math.round(product.height * scaleVFor(insetB)))
      const scaledInsetB = scaledH - zone.h
      hingeOverlap = { left: Math.round(insetL * s), right: Math.round(insetR * s), bottom: scaledInsetB }

      const productResized = await sharp(product.image)
        .resize(scaledW, scaledH, { fit: 'fill' })
        .png()
        .toBuffer()
      placed = await sharp(baseImagePath)
        .composite([{ input: productResized, left: zone.x - hingeOverlap.left, top: zone.y }])
        .png()
        .toBuffer()
      anchor.h += scaledInsetB
      maskRect = { x: anchor.x, y: anchor.y, w: anchor.w, h: anchor.h }
      shadowFloorY = Math.min(height, zone.y + zone.h + scaledInsetB + margin)
      const rectSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <rect x="${anchor.x - strokeW - 1}" y="${anchor.y - strokeW - 1}" width="${anchor.w + 2 * (strokeW + 1)}" height="${anchor.h + 2 * (strokeW + 1)}" fill="none" stroke="#FF0000" stroke-width="${strokeW}"/>
      </svg>`
      inputImage = await sharp(placed).composite([{ input: Buffer.from(rectSvg) }]).png().toBuffer()
    } else {
      // ==== MÉTHODE « rectangle » / « Verrouillée » (ex-défaut — le défaut est le réglage moteur) ====
      // Le décor Piliers reste INTACT ; le rectangle rouge est l'EMPREINTE EXACTE du
      // portail (hauteur du portail, largeur du passage + moitié intérieure des piliers).
      // Le produit part en 2ᵉ image jointe et doit REMPLIR tout le rectangle — c'est le
      // rectangle qui garantit position et proportions.
      const rectSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <rect x="${anchor.x - strokeW - 1}" y="${anchor.y - strokeW - 1}" width="${anchor.w + 2 * (strokeW + 1)}" height="${anchor.h + 2 * (strokeW + 1)}" fill="none" stroke="#FF0000" stroke-width="${strokeW}"/>
      </svg>`
      inputImage = await sharp(baseImagePath).composite([{ input: Buffer.from(rectSvg) }]).png().toBuffer()
      attachProduct = true
      // Référence interne du contrôle d'invariance (jamais envoyée au modèle) :
      // le produit à sa position/taille théoriques.
      const refResized = await sharp(product.image)
        .resize(zone.w, zone.h, { fit: 'fill' })
        .png()
        .toBuffer()
      placed = await sharp(baseImagePath)
        .composite([{ input: refResized, left: zone.x, top: zone.y }])
        .png()
        .toBuffer()
      maskRect = { x: anchor.x, y: anchor.y, w: anchor.w, h: anchor.h }
      shadowFloorY = Math.min(height, zone.y + zone.h + margin)
    }

    const placedPath = path.join(dir, `1-produit-pose-${stamp}.png`)
    fs.writeFileSync(placedPath, placed)
    const inputPath = path.join(dir, `2-entree-rect-rouge-${stamp}.png`)
    fs.writeFileSync(inputPath, inputImage)

    // 3. Prompt système versionné, format natif substitué + consigne moteur
    //    (ajoutée par le moteur, comme l'addendum couloir — pas dans le prompt éditable).
    const promptRow = getActivePrompt(moteurPromptName(moteurKey, 'integration'))
    const prompt =
      promptRow.content
        .replaceAll('2000 × 1330', `${width} × ${height}`)
        .replaceAll('2000×1330', `${width}×${height}`)
        .replaceAll('2000x1330', `${width}x${height}`) +
      (method === 'pose-directe' ? HINGE_ADDENDUM : SHADOW_ADDENDUM)

    // 4. Intégration par Nano Banana (méthode rectangle : le produit est la 2ᵉ image).
    const generated = await generateImage({
      prompt,
      images: [
        { source: inputImage, mimeType: 'image/png' },
        ...(attachProduct ? [{ source: product.image, mimeType: 'image/png' }] : []),
      ],
      aspectRatio: '3:2',
      imageSize,
      model: opts.imageModel,
      jobId,
      artifactName: `4-sortie-brute-${pr.sizeLabel}`,
      artifactDir: path.join('integration', slug, pr.sizeLabel),
    })
    const nativeSizeRespected = generated.width === width && generated.height === height
    let output = generated.buffer
    if (!nativeSizeRespected) {
      output = await sharp(output).resize(width, height, { fit: 'fill' }).png().toBuffer()
    }
    // Recalage global : élargi une fois si saturé, abandonné si toujours saturé
    // (même règle que l'étape Piliers — jamais de recalage tronqué).
    let shift = await estimateShift(inputImage, output, 8, 4)
    if (shift.atBound) shift = await estimateShift(inputImage, output, 16, 4)
    if (shift.atBound) {
      shift = { dx: 0, dy: 0, score: shift.score, atBound: true }
    } else if (shift.dx !== 0 || shift.dy !== 0) {
      output = await applyShift(output, shift.dx, shift.dy)
    }

    // 5. Masque pixel-lock : zone de travail (portail + moitié intérieure des piliers)
    //    + marge, puis ombres détectées (référence = Piliers).
    const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="${width}" height="${height}" fill="black"/>
      <rect x="${Math.max(0, maskRect.x - margin)}" y="${Math.max(0, maskRect.y - margin)}" width="${Math.min(width, maskRect.w + 2 * margin)}" height="${Math.min(height, maskRect.h + 2 * margin)}" fill="white"/>
    </svg>`
    const baseMask = await sharp(Buffer.from(maskSvg)).png().toBuffer()
    let mask = baseMask
    let shadowFraction = 0
    let shadowAborted = false
    if ((opts.shadows ?? moteur.shadows) === 'auto') {
      const det = await addShadowsToMask(baseImagePath, output, baseMask)
      mask = det.mask
      shadowFraction = det.shadowFraction
      shadowAborted = det.aborted
    }
    // JAMAIS d'ombre projetée DEVANT le portail (règle Mathias 09/07) : le masque est
    // coupé net sous la ligne de sol du portail — en dessous, le pixel-lock restitue le
    // sol d'origine à l'octet près, une ombre y est donc mathématiquement impossible.
    if (shadowFloorY < height) {
      const floorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <rect x="0" y="${shadowFloorY}" width="${width}" height="${height - shadowFloorY}" fill="black"/>
      </svg>`
      mask = await sharp(mask).composite([{ input: Buffer.from(floorSvg) }]).png().toBuffer()
    }
    const maskPath = path.join(dir, `3-masque-${stamp}.png`)
    fs.writeFileSync(maskPath, mask)

    // 6. Compositing pixel-lock sur l'image Piliers.
    const { image: composite } = await compositeWithMask(
      baseImagePath,
      output,
      mask,
      4
    )
    const compositePath = path.join(dir, `5-composite-${stamp}.png`)
    fs.writeFileSync(compositePath, composite)

    // 7. Contrôle d'invariance produit : structure des contours avant/après.
    const invariance = await productInvariance(placed, composite, zone)

    // 8. Livraison e-commerce : l'UNIQUE redimensionnement du pipeline.
    const delivery = await sharp(composite)
      .resize(config.delivery.width, config.delivery.height, { fit: 'fill' })
      .jpeg(config.deliveryJpeg)
      .toBuffer()
    const deliveryPath = path.join(
      dir,
      `6-livraison-${config.delivery.width}x${config.delivery.height}-${stamp}.jpg`
    )
    fs.writeFileSync(deliveryPath, delivery)

    const result: IntegrationStepResult = {
      jobId,
      method,
      sizeLabel: pr.sizeLabel,
      width,
      height,
      zonePx: { x: zone.x, y: zone.y, w: zone.w, h: zone.h },
      anchorZonePx: { x: anchor.x, y: anchor.y, w: anchor.w, h: anchor.h },
      pillarEdgeShiftPx,
      hingeOverlapPx: hingeOverlap,
      hingeFallback,
      detourPath,
      productPillars: product.pillars,
      placedPath,
      inputPath,
      maskPath,
      rawOutputPath: generated.artifactPath,
      compositePath,
      deliveryPath,
      invarianceScore: Number(invariance.score.toFixed(4)),
      invarianceOk: invariance.ok,
      shadowFraction,
      shadowAborted,
      nativeSizeRespected,
      alignShift: { dx: shift.dx, dy: shift.dy, atBound: shift.atBound },
      promptVersion: promptRow.version,
    }

    db.prepare(
      `UPDATE jobs SET status = 'done', result = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      JSON.stringify({
        kind: 'integration',
        method,
        sizeLabel: pr.sizeLabel,
        pillarsJobId: opts.pillarsJobId,
        productPath: path.relative(config.rootDir, opts.productPath),
        productBackgroundRemoved: product.backgroundRemoved,
        productTrimmed: product.trimmed,
        detourPath: detourPath ? path.relative(config.rootDir, detourPath) : null,
        productPillars: product.pillars
          ? {
              applied: product.pillars.applied,
              reason: product.pillars.reason,
              leftPx: product.pillars.left?.widthPx ?? 0,
              rightPx: product.pillars.right?.widthPx ?? 0,
            }
          : null,
        deformationWarning,
        ratioDeviation: Number(ratioDeviation.toFixed(4)),
        placedPath: path.relative(config.rootDir, placedPath),
        inputPath: path.relative(config.rootDir, inputPath),
        maskPath: path.relative(config.rootDir, maskPath),
        rawOutputPath: path.relative(config.rootDir, generated.artifactPath),
        compositePath: path.relative(config.rootDir, compositePath),
        deliveryPath: path.relative(config.rootDir, deliveryPath),
        zonePx: result.zonePx,
        anchorZonePx: result.anchorZonePx,
        pillarEdgeShiftPx,
        hingeOverlapPx: result.hingeOverlapPx,
        hingeFallback,
        invarianceScore: result.invarianceScore,
        invarianceOk: result.invarianceOk,
        shadowFraction: Number(shadowFraction.toFixed(4)),
        shadowAborted,
        nativeSizeRespected,
        alignShift: result.alignShift,
        promptVersion: promptRow.version,
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
