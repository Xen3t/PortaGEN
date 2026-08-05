import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { config } from '@/lib/config'
import { getDb } from '@/lib/db'
import { getActivePrompt } from '@/lib/db/prompts'
import { generateImage, generateText } from '@/lib/genai/client'
import { marquerImageIa } from '@/lib/images/marquage'
import {
  DEFAULT_PARAMS,
  computeLayout,
  computeCap,
  pilierDroitRectCm,
  projection,
  projectRect,
  type GabaritParams,
} from '@/lib/geometry'
import { getPilierDroitSaved, getPilierDroitDefault } from '@/lib/db/sizeParams'
import { APLAT_COLOR } from '@/lib/images/gabarits'
import { whiteLineBands, horizontalEdgeProfile, bandPatternShift, groundBandShift } from '@/lib/images/analyze'
import { poserProduitSurCible } from '@/lib/images/pose'
import { prepareProduct } from '@/lib/images/product'
import { appliquerRalify, rgbToLab } from '@/lib/images/ralify'
import { estimateShift, applyShift } from '@/lib/images/composite'
import { resolveRalifyCible } from '@/lib/ralify'
import { parseSizeFromProductName } from '@/lib/productName'
import { gabaritSetForSize } from '@/lib/gabaritSets'
import { getMoteurReglages, type MoteurKey } from '@/lib/moteurs'
import { cannyRefPath } from '@/lib/server/cannyRef'
import {
  colorisPromptDescription,
  type PoseFusionStepOptions,
  type PoseFusionStepResult,
} from '@/lib/pipeline/poseFusion'
import { NATIVE_DIMS } from '@/lib/pipeline/nativeFormats'
import type { ImageSize } from '@/lib/genai/client'

/**
 * CIRCUIT COULISSANT « 2 ÉTAPES » — moteur TERMINUS (câblé le 29/07/2026,
 * banc scripts/test-deux-etapes-stuc.ts validé par Mathias sur EIGER 300C140).
 *
 * Idée (Mathias, 28/07) : au lieu de demander à Nano de faire passer la lame
 * DERRIÈRE le pilier droit (loterie — jobs #19-26, ombre réglable, etc.), on
 * supprime le problème :
 *   ÉTAPE 1 — la scène est rendue SANS pilier droit (muret continu jusqu'au
 *   bord) ; la lame posée par le code montre son bout de profil devant le
 *   muret : rien à occulter, pas de piège de profondeur.
 *   ÉTAPE 2 — l'aplat gris du pilier droit (fût + chapeau) est peint SUR le
 *   rendu fini, un 2ᵉ appel Nano le transforme en pilier d'avant-plan.
 *   MASQUE — seule la silhouette du pilier (segmentation GEMINI : polygone —
 *   BiRefNet paniquait sur l'ombre du bas de fût, écarté le 29/07) vient du
 *   2ᵉ rendu ; le reste de l'image reste le rendu 1 au pixel près.
 *   → L'occlusion lame-derrière-pilier est garantie PAR CONSTRUCTION.
 *
 * SANS juge (décision Mathias 29/07) et SANS raccord de teinte (désactivé le
 * 29/07 : sous éclairage asymétrique il rendait le pilier bleuté ; Nano matche
 * déjà la teinte — l'écart LAB mesuré est seulement loggé).
 *
 * Coût : 2 appels image + 1 appel texte (segmentation) par visuel.
 * Le contrat de sortie (PoseFusionStepResult + result JSON kind:'pose-fusion')
 * est IDENTIQUE à runPoseFusionStep : l'UI ne sait rien du circuit.
 */

/** Face de retour 3D admise à gauche du gabarit (perspective, px natifs 4K). */
const RETOUR_GAUCHE_PX = 150
/** Bande dégradée sous la ligne de sol : l'ombre de contact du pied (px). */
const BANDE_BASE_PX = 20
/** Bande de muret gardée à droite du pilier (× largeur pilier) : ombre portée. */
const MURET_BANDE_FACTEUR = 1.3
/** Marge de silhouette autour du rectangle chapeau (px). */
const MARGE_CHAPEAU_PX = 25
/**
 * Marge fixe de recouvrement de la lame derrière le pilier droit (× largeur du
 * pilier). La lame est posée jusqu'à ce point pour que son bout soit caché sous
 * le pilier — technique, pas un réglage (28/07 : c'était 0,5 en dur, conservé).
 */
const LAME_OVERLAP_FRAC = 0.5

function imageSizeFromDims(width: number, height: number): ImageSize | null {
  for (const [k, d] of Object.entries(NATIVE_DIMS)) {
    if (d.width === width && d.height === height) return k as ImageSize
  }
  return null
}

export async function runCoulissant2EtapesStep(
  opts: PoseFusionStepOptions
): Promise<PoseFusionStepResult> {
  const moteurKey: MoteurKey = opts.moteur ?? 'coulissant'
  const moteur = getMoteurReglages(moteurKey)
  const sizeLabel = `${opts.size.w}x${opts.size.h}`
  const slug = opts.slug ?? 'pose-fusion'

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

  // Verrou LARGEUR (règle du 17/07) : même largeur obligatoire, l'étirement
  // libre absorbe l'écart de hauteur — cohérent avec runPoseFusionStep.
  const nameSize = parseSizeFromProductName(path.basename(opts.productPath))
  if (nameSize && nameSize.w !== opts.size.w) {
    throw new Error(
      `Produit incompatible : « ${path.basename(opts.productPath)} » est un ${nameSize.w} cm de large, ` +
        `ce job est un ${opts.size.w}×${opts.size.h}.`
    )
  }

  // Alignement sol : réglages du JEU de la taille (Canny XL pour ≥ 450).
  const jeu = gabaritSetForSize(moteurKey, opts.size.w)
  const cannyReg = jeu === moteurKey ? moteur : getMoteurReglages(jeu)
  const align =
    opts.align ??
    (cannyReg.cannyPlacement === 'manuel' ? cannyReg.cannyOffsetPx : cannyReg.cannyPlacement)

  const db = getDb()
  let jobId = opts.jobId
  if (jobId === undefined) {
    const job = db
      .prepare(`INSERT INTO jobs (type, status, payload) VALUES ('pose-fusion', 'running', ?)`)
      .run(
        JSON.stringify({
          decorPath: opts.decorPath,
          size: opts.size,
          productPath: opts.productPath,
          align,
          slug,
        })
      )
    jobId = Number(job.lastInsertRowid)
  }

  try {
    // 1. Alignement de la ligne de sol (même logique que runPoseFusionStep).
    const cannyPath = cannyRefPath(jeu)
    let groundOffsetPxNative = 0
    let groundAlign: PoseFusionStepResult['groundAlign']
    if (typeof align === 'number') {
      groundOffsetPxNative = Math.round(align)
      groundAlign = 'manual'
    } else if (align === 'auto') {
      const bands = (await whiteLineBands(cannyPath)).filter((b) => b.yNorm > 0.5)
      const profile = await horizontalEdgeProfile(opts.decorPath)
      const mesure = jeu === 'coulissant-xl' ? groundBandShift : bandPatternShift
      const match = mesure(
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
    const offsetCm = (groundOffsetPxNative / height) * baseParams.sceneH
    const adjusted: Partial<GabaritParams> = {
      ...opts.params,
      groundY: baseParams.groundY - offsetCm,
    }

    const dir = path.join(config.artifactsDir, 'pose-fusion', slug, sizeLabel)
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')

    const layout = computeLayout(opts.size, adjusted)
    const p = projection(width, height, layout.sceneW, layout.sceneH)
    const R = (r: { x: number; y: number; w: number; h: number }) => projectRect(r, p)
    const gate = R({ x: layout.gateLeft, y: layout.gateTop, w: layout.gateW, h: layout.gateH })
    // 2ᵉ gabarit (04/08/2026) : le pilier droit du coulissant.
    //  - NON réglé (Phase 2 jamais enregistrée) : on reprend EXACTEMENT le
    //    pilier de l'étape 1 (gabarit général, hauteur interpolée par taille) —
    //    aucun changement de rendu.
    //  - Réglé : largeur + décalage voulus, MÊME hauteur que le pilier gauche,
    //    chapeau selon le style du gabarit. Le muret droit de l'étape 1 reste
    //    continu jusqu'au bord dans les deux cas (le pilier n'existe qu'à l'étape 2).
    const pilierDroitSaved = getPilierDroitSaved(jeu)
    let pRight: ReturnType<typeof R>
    let cap: ReturnType<typeof R> | null
    if (pilierDroitSaved) {
      const pd = { ...getPilierDroitDefault(jeu), ...pilierDroitSaved }
      const pilierCm = pilierDroitRectCm(layout, pd)
      pRight = R(pilierCm)
      const capCm = computeCap(
        baseParams.capStyle,
        pilierCm.x,
        pilierCm.y,
        pilierCm.w,
        layout.sceneW,
        layout.sceneH
      )
      cap = capCm ? R(capCm.bbox) : null
    } else {
      pRight = R(layout.pillarRight)
      cap = layout.capRight ? R(layout.capRight.bbox) : null
    }
    const muret = layout.muretRight ? R(layout.muretRight) : null

    // 2. ÉTAPE 1 — aplats SANS pilier droit : pilier gauche + murets, le muret
    //    droit court de l'ouverture jusqu'au bord de scène. La lame (préparée,
    //    RALifiée) est posée PAR-DESSUS : son bout de profil est visible.
    const muretH = layout.muretRight?.h ?? 0
    const muretDroit = R({
      x: layout.gateLeft + layout.gateW,
      y: layout.groundLine - muretH,
      w: layout.sceneW - (layout.gateLeft + layout.gateW),
      h: muretH,
    })
    const shapes: string[] = []
    for (const r of [layout.pillarLeft, layout.muretLeft]) {
      if (!r) continue
      const q = R(r)
      if (q.w > 0 && q.h > 0)
        shapes.push(`<rect x="${q.x}" y="${q.y}" width="${q.w}" height="${q.h}" fill="${APLAT_COLOR}"/>`)
    }
    if (layout.capLeft) {
      const b = R(layout.capLeft.bbox)
      shapes.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${APLAT_COLOR}"/>`)
    }
    if (muretDroit.w > 0 && muretDroit.h > 0)
      shapes.push(
        `<rect x="${muretDroit.x}" y="${muretDroit.y}" width="${muretDroit.w}" height="${muretDroit.h}" fill="${APLAT_COLOR}"/>`
      )
    const aplats1 = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shapes.join('')}</svg>`
    const fondAplats = await sharp(opts.decorPath)
      .composite([{ input: Buffer.from(aplats1) }])
      .png()
      .toBuffer()

    const prepared = await prepareProduct(opts.productPath, {
      removePillars: true,
      expectedSize: opts.size,
    })
    const ralifyCible = resolveRalifyCible(
      moteur.ralify,
      `${opts.productName ?? ''} ${path.basename(opts.productPath)}`,
      opts.coloris
    )
    let produitPret = prepared.image
    if (ralifyCible) {
      const ralify = await appliquerRalify(prepared.image, ralifyCible, moteur.ralify.intensite)
      produitPret = ralify.image
      fs.writeFileSync(path.join(dir, `0-produit-ralify-${stamp}.png`), produitPret)
    }

    // Cible TERMINUS : la lame recouvre l'ouverture + une marge fixe derrière le
    // pilier droit (LAME_OVERLAP_FRAC), pour que son bout soit caché sans joint —
    // marge TECHNIQUE, pas un réglage (l'intégration du portail est faite ici, à
    // l'étape 1 ; la phase 2 ne fait que placer le pilier). Bord gauche ancré EN
    // DUR. Pas de réparation de pieds (une lame n'en a pas).
    const cible = {
      x: gate.x,
      y: gate.y,
      w: Math.round(pRight.x + pRight.w * LAME_OVERLAP_FRAC - gate.x),
      h: Math.round(gate.h),
    }
    const pose = await poserProduitSurCible(fondAplats, produitPret, cible, moteur.poseSeuilAlpha, false)
    const posedInputPath = path.join(dir, `1-entree-posee-${stamp}.png`)
    fs.writeFileSync(posedInputPath, pose.image)

    const promptScene = getActivePrompt('coulissant-2etapes-scene')
    const gen1 = await generateImage({
      prompt: promptScene.content.replaceAll('{COLORIS}', colorisPromptDescription(opts.coloris)),
      images: [{ source: pose.image, mimeType: 'image/png' }],
      aspectRatio: '3:2',
      imageSize,
      model: opts.imageModel,
      jobId,
      artifactName: `2-scene-sans-pilier-${sizeLabel}`,
      artifactDir: path.join('pose-fusion', slug, sizeLabel),
    })
    let etape1 = gen1.buffer
    if (gen1.width !== width || gen1.height !== height) {
      etape1 = await sharp(gen1.buffer, { limitInputPixels: false })
        .resize(width, height, { fit: 'fill' })
        .png()
        .toBuffer()
    }

    // 3. ÉTAPE 2 — aplat pilier droit (fût + chapeau) peint SUR le rendu fini.
    const shapes2 = [
      `<rect x="${pRight.x}" y="${pRight.y}" width="${pRight.w}" height="${pRight.h}" fill="${APLAT_COLOR}"/>`,
    ]
    if (cap)
      shapes2.push(`<rect x="${cap.x}" y="${cap.y}" width="${cap.w}" height="${cap.h}" fill="${APLAT_COLOR}"/>`)
    const aplats2 = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shapes2.join('')}</svg>`
    const entree2 = await sharp(etape1)
      .composite([{ input: Buffer.from(aplats2) }])
      .png()
      .toBuffer()
    fs.writeFileSync(path.join(dir, `3-entree-pilier-${stamp}.png`), entree2)

    const promptPilier = getActivePrompt('coulissant-2etapes-pilier')
    const gen2 = await generateImage({
      prompt: promptPilier.content,
      images: [{ source: entree2, mimeType: 'image/png' }],
      aspectRatio: '3:2',
      imageSize,
      model: opts.imageModel,
      jobId,
      artifactName: `4-sortie-pilier-${sizeLabel}`,
      artifactDir: path.join('pose-fusion', slug, sizeLabel),
    })
    const nativeSizeRespected = gen2.width === width && gen2.height === height
    let sortie = gen2.buffer
    if (!nativeSizeRespected) {
      sortie = await sharp(gen2.buffer, { limitInputPixels: false })
        .resize(width, height, { fit: 'fill' })
        .png()
        .toBuffer()
    }
    // 4-5. MASQUE + COMPOSITE — DÉSACTIVABLE par moteur (réglage Admin
    //      « Masquage / composite » = 'off', 05/08/2026) : sur 'off', la sortie
    //      BRUTE du 2ᵉ rendu (pilier peint par Nano) EST l'image finale, sans
    //      masque de silhouette ni recalage — l'occlusion lame-derrière-pilier
    //      n'est alors plus garantie par le code, on fait confiance au rendu.
    let sortieFinale: Buffer
    let recalage = { dx: 0, dy: 0 }
    let segPoints = 0
    let segVersion: number | undefined
    if (moteur.poseFusionComposite === 'off') {
      sortieFinale = sortie
      fs.writeFileSync(path.join(dir, `5-finale-brute-${stamp}.png`), sortieFinale)
    } else {
      let shift = await estimateShift(entree2, sortie, 8, 4)
      if (shift.atBound) shift = await estimateShift(entree2, sortie, 16, 4)
      if (!shift.atBound && (shift.dx !== 0 || shift.dy !== 0)) {
        sortie = await applyShift(sortie, shift.dx, shift.dy)
      }
      recalage = { dx: shift.dx, dy: shift.dy }

      // 4. MASQUE — silhouette du pilier par segmentation GEMINI (polygone JSON,
      //    le modèle 3.5 ne renvoie pas de masque PNG : on demande les points et
      //    on rasterise), puis garde-fous géométriques à DEUX ZONES :
      //    CHAPEAU (au-dessus du haut de fût) : strict — le ciel trahit le
      //    moindre écart de ton entre les deux rendus → silhouette × filtre
      //    couleur anti-ciel + remplissage vertical, jamais de rectangle forcé.
      //    FÛT : généreux — fond chargé (lame, muret, enrobé) → rectangle forcé
      //    plein, face de retour admise à gauche, bande dégradée sous la ligne
      //    de sol (ombre de contact), bande muret (ombre portée du pilier).
      const crop = {
        left: Math.max(0, (cap ? Math.min(pRight.x, cap.x) : pRight.x) - 60),
        top: Math.max(0, (cap ? cap.y : pRight.y) - 60),
        width: 0,
        height: 0,
      }
      const cropRight = Math.min(width, pRight.x + pRight.w + Math.round(pRight.w * 1.4) + 60)
      const cropBottom = Math.min(height, pRight.y + pRight.h + 40)
      crop.width = cropRight - crop.left
      crop.height = cropBottom - crop.top

      const zone = sharp(sortie).extract(crop).removeAlpha()
      const { info } = await zone.clone().raw().toBuffer({ resolveWithObject: true })
      const zoneJpeg = await zone.clone().resize({ width: 800 }).jpeg({ quality: 90 }).toBuffer()
      // Un pilier + chapeau se décrit dès 6 points ; le modèle en rend parfois
      // peu — 3 tentatives (appel texte, coût négligeable) avant d'abandonner.
      const promptSeg = getActivePrompt('coulissant-2etapes-segmentation')
      let rep: { polygon: Array<[number, number]> } | null = null
      for (let t = 1; t <= 3 && !rep; t++) {
        const seg = await generateText({
          prompt: promptSeg.content,
          images: [{ source: zoneJpeg, mimeType: 'image/jpeg' }],
          jobId,
        })
        try {
          const cand = JSON.parse(seg.text.replace(/```json|```/g, '').trim()) as {
            polygon: Array<[number, number]>
          }
          if (cand.polygon?.length >= 6) rep = cand
        } catch {
          /* JSON illisible → nouvelle tentative */
        }
      }
      if (!rep) {
        throw new Error('Segmentation pilier invalide après 3 tentatives')
      }
      const points = rep.polygon
        .map(
          ([py, px]) =>
            `${((px / 1000) * info.width).toFixed(1)},${((py / 1000) * info.height).toFixed(1)}`
        )
        .join(' ')
      const svgMasque = `<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}"><rect width="${info.width}" height="${info.height}" fill="black"/><polygon points="${points}" fill="white"/></svg>`
      const alphaCrop = await sharp(Buffer.from(svgMasque))
        .blur(1.2)
        .toColourspace('b-w')
        .raw()
        .toBuffer()

      const { data: rgb2 } = await sharp(sortie)
        .extract(crop)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })

      // Moyenne couleur du pilier rendu (cœur de fût) — sert au filtre anti-ciel
      // du chapeau, quel que soit le matériau (mesurée, jamais codée en dur).
      const marge = 20
      let A0 = 0
      let B0 = 0
      {
        const cx0 = pRight.x - crop.left + marge
        const cx1 = pRight.x - crop.left + pRight.w - marge
        const cy0 = pRight.y - crop.top + Math.round(pRight.h * 0.3)
        const cy1 = cy0 + Math.round(pRight.h * 0.5)
        let n0 = 0
        for (let y = cy0; y < cy1; y++) {
          for (let x = cx0; x < cx1; x++) {
            const i = y * info.width + x
            const [, a2, b2] = rgbToLab(rgb2[i * 3], rgb2[i * 3 + 1], rgb2[i * 3 + 2])
            A0 += a2
            B0 += b2
            n0++
          }
        }
        A0 /= n0
        B0 /= n0
      }
      const pilierProba = (a2: number, b2: number) => {
        const d = Math.hypot(a2 - A0, b2 - B0)
        return d <= 8 ? 1 : d >= 16 ? 0 : (16 - d) / 8
      }

      const faceRel = pRight.x - crop.left
      const rightRel = faceRel + pRight.w
      const futTopRel = pRight.y - crop.top
      const baseRel = pRight.y + pRight.h - crop.top
      const capX0 = cap ? cap.x - crop.left - MARGE_CHAPEAU_PX : faceRel - MARGE_CHAPEAU_PX
      const capX1 = cap
        ? cap.x - crop.left + cap.w - 1 + MARGE_CHAPEAU_PX
        : rightRel + MARGE_CHAPEAU_PX
      const inFut = (x: number, y: number) =>
        x >= faceRel && x < rightRel && y >= futTopRel && y < baseRel
      for (let y = 0; y < info.height; y++) {
        const enChapeau = y < futTopRel
        for (let x = 0; x < info.width; x++) {
          const i = y * info.width + x
          let a = alphaCrop[i]
          if (enChapeau) {
            if (x < capX0 || x > capX1) a = 0
            else if (a > 0) {
              const [, a2, b2] = rgbToLab(rgb2[i * 3], rgb2[i * 3 + 1], rgb2[i * 3 + 2])
              a = Math.round(a * pilierProba(a2, b2))
            }
          } else {
            if (x < faceRel - RETOUR_GAUCHE_PX || x > rightRel + MARGE_CHAPEAU_PX) a = 0
            if (inFut(x, y)) a = 255
            if (
              x >= faceRel - 80 &&
              x <= rightRel + 15 &&
              y >= baseRel &&
              y <= baseRel + BANDE_BASE_PX
            ) {
              a = Math.max(a, Math.round(255 * (1 - (y - baseRel) / BANDE_BASE_PX)))
            }
          }
          alphaCrop[i] = a
        }
      }
      // Remplissage vertical de la zone chapeau : un chapeau n'a pas de trous
      // (l'ombre sous le chapeau revient, le ciel reste dehors).
      for (let x = Math.max(0, capX0); x <= Math.min(info.width - 1, capX1); x++) {
        let y0 = -1
        let y1 = -1
        for (let y = 0; y < futTopRel; y++) {
          if (alphaCrop[y * info.width + x] >= 250) {
            if (y0 < 0) y0 = y
            y1 = y
          }
        }
        if (y0 >= 0) {
          for (let y = y0; y <= y1; y++) {
            const i = y * info.width + x
            if (alphaCrop[i] < 250) alphaCrop[i] = 255
          }
        }
      }
      // Bande muret : l'ombre portée du pilier sur le muret (info de profondeur —
      // sans elle le pilier flotte, retour Mathias 29/07).
      if (muret) {
        const bandW = Math.round(pRight.w * MURET_BANDE_FACTEUR)
        const y0m = Math.max(0, muret.y + 4 - crop.top)
        const y1m = Math.min(info.height - 1, muret.y + muret.h - 1 - crop.top)
        for (let y = y0m; y <= y1m; y++) {
          for (let dx = 0; dx < bandW; dx++) {
            const x = rightRel + dx
            if (x < 0 || x >= info.width) continue
            const a = Math.round(255 * (1 - dx / bandW))
            const i = y * info.width + x
            if (a > alphaCrop[i]) alphaCrop[i] = a
          }
        }
      }

      // 5. COMPOSITE — le pilier (et ses ombres) vient du rendu 2, tout le reste
      //    est le rendu 1 au pixel près. Aucun raccord de teinte (29/07).
      const n = info.width * info.height
      const rgba = Buffer.alloc(n * 4)
      for (let i = 0; i < n; i++) {
        rgba[i * 4] = rgb2[i * 3]
        rgba[i * 4 + 1] = rgb2[i * 3 + 1]
        rgba[i * 4 + 2] = rgb2[i * 3 + 2]
        rgba[i * 4 + 3] = alphaCrop[i]
      }
      const calque = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
        .png()
        .toBuffer()
      sortieFinale = await sharp(etape1)
        .composite([{ input: calque, left: crop.left, top: crop.top }])
        .png()
        .toBuffer()
      fs.writeFileSync(path.join(dir, `5-finale-masquee-${stamp}.png`), sortieFinale)
      segPoints = rep.polygon.length
      segVersion = promptSeg.version
    }

    // 6. Livraison e-commerce (unique transformation de l'image finale).
    const delivery = await sharp(sortieFinale)
      .resize(config.delivery.width, config.delivery.height, { fit: 'fill' })
      .jpeg(config.deliveryJpeg)
      .toBuffer()
    const deliveryPath = path.join(
      dir,
      `3-livraison-${config.delivery.width}x${config.delivery.height}-${stamp}.jpg`
    )
    fs.writeFileSync(deliveryPath, delivery)
    await marquerImageIa(deliveryPath)

    const result: PoseFusionStepResult = {
      jobId,
      sizeLabel,
      width,
      height,
      imageSize,
      groundOffsetPxNative,
      groundAlign,
      zonePx: pose.cible,
      posedInputPath,
      rawOutputPath: gen2.artifactPath,
      deliveryPath,
      nativeSizeRespected,
      promptVersion: promptScene.version,
      debordPct: moteur.poseDebordPct,
      seuilAlpha: moteur.poseSeuilAlpha,
      // Plus d'ombre dessinée : l'occlusion est garantie par construction.
      ombrePilierPct: 0,
      ralifyCible,
      alphaReparePx: pose.produit.alphaReparePx,
      piedsDetectes: 0,
      piedsProduit: true,
    }

    db.prepare(
      `UPDATE jobs SET status = 'done', result = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      JSON.stringify({
        kind: 'pose-fusion',
        sizeLabel,
        imageSize,
        productPath: path.relative(config.rootDir, opts.productPath),
        posedInputPath: path.relative(config.rootDir, posedInputPath),
        rawOutputPath: path.relative(config.rootDir, gen2.artifactPath),
        deliveryPath: path.relative(config.rootDir, deliveryPath),
        zonePx: result.zonePx,
        zoneFrac: {
          x: pose.cible.x / width,
          y: pose.cible.y / height,
          w: pose.cible.w / width,
          h: pose.cible.h / height,
        },
        groundOffsetPxNative,
        groundAlign,
        nativeSizeRespected,
        promptVersion: promptScene.version,
        promptPilierVersion: promptPilier.version,
        promptSegmentationVersion: segVersion,
        debordPct: moteur.poseDebordPct,
        seuilAlpha: moteur.poseSeuilAlpha,
        ombrePilierPct: 0,
        ralifyCible,
        alphaReparePx: pose.produit.alphaReparePx,
        piedsDetectes: 0,
        piedsProduit: true,
        methode: 'coulissant-2-etapes',
        composite: moteur.poseFusionComposite,
        segmentationPoints: segPoints,
        recalage,
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
