import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { config } from '@/lib/config'
import { getDb } from '@/lib/db'
import { getActivePrompt } from '@/lib/db/prompts'
import { generateImage, type ImageSize } from '@/lib/genai/client'
import { marquerImageIa } from '@/lib/images/marquage'
import { DEFAULT_PARAMS, computeLayout, projection, projectRect, type GabaritParams, type SizeCm } from '@/lib/geometry'
import { overlayGabaritOnDecor, renderGabaritPng } from '@/lib/images/gabarits'
import { whiteLineBands, horizontalEdgeProfile, bandPatternShift, groundBandShift } from '@/lib/images/analyze'
import { poserProduit, poserProduitSurCible, type PoseResult } from '@/lib/images/pose'
import { detecterPieds, recollerPieds } from '@/lib/images/pieds'
import { prepareProduct } from '@/lib/images/product'
import { appliquerRalify } from '@/lib/images/ralify'
import { resolveRalifyCible } from '@/lib/ralify'
import { parseSizeFromProductName } from '@/lib/productName'
import { gabaritSetForSize } from '@/lib/gabaritSets'
import { getMoteurReglages, moteurPromptName, type MoteurKey } from '@/lib/moteurs'
import { NATIVE_DIMS } from '@/lib/pipeline/nativeFormats'
import { cannyRefPath } from '@/lib/server/cannyRef'

/**
 * Étape « pose + fusion » (chantier du 17/07/2026, docs/CADRAGE-POSE-FUSION-JANUS-2026-07-17.md).
 *
 * > Le code pose le produit au pixel près ; le modèle ne fait QUE la lumière et les ombres.
 *
 * Remplace le chaînage Piliers → Intégration par UN SEUL appel Nano Banana :
 * 1. le code prépare « décor + aplats gris + produit détouré POSÉ » (brique pose,
 *    src/lib/images/pose.ts — règle validée par Mathias le 17/07 sur l'Eiger et le
 *    Cervina Ruivo) ;
 * 2. Nano transforme les aplats en stuc et fait UNIQUEMENT la retouche photographique
 *    du portail déjà posé (lumière, ombres de contact, fusion des bords) ;
 * 3. la sortie brute du modèle est l'image finale (même philosophie que le masking
 *    off du 11/07) — seule la livraison e-commerce est redimensionnée.
 *
 * Les étapes Piliers et Intégration restent en réserve (changement de défaut, pas
 * de suppression). Artefacts conservés : entrée posée, sortie brute, livraison.
 */

export interface PoseFusionStepOptions {
  /** Décor issu de l'étape 1, au format natif */
  decorPath: string
  size: SizeCm
  params?: Partial<GabaritParams>
  /** Image produit (PNG détouré) — chemin ABSOLU déjà validé par l'appelant */
  productPath: string
  /** Alignement de la ligne de sol (absent = réglage du moteur) */
  align?: 'auto' | 'off' | number
  imageModel?: string
  slug?: string
  /** Coloris du produit (détection existante + choix utilisateur) — injecté dans le prompt */
  coloris?: string
  /**
   * Nom du produit (RALify, exceptions « nom contient ») : les PNG détourés du
   * catalogue s'appellent `coloris_taille.png`, le nom n'y est pas — l'appelant
   * qui le connaît le fournit, le nom de fichier sert de complément.
   */
  productName?: string
  /** Moteur produit : ses réglages, ses prompts. Absent = battant. */
  moteur?: MoteurKey
  /** Job existant (créé par le runner) — sinon la fonction crée le sien (scripts CLI) */
  jobId?: number
}

export interface PoseFusionStepResult {
  jobId: number
  sizeLabel: string
  width: number
  height: number
  imageSize: ImageSize
  groundOffsetPxNative: number
  groundAlign: 'measured' | 'fallback-canny' | 'manual' | 'off'
  /** Empreinte réelle du produit posé (zone portail + débordement piliers), px natifs */
  zonePx: { x: number; y: number; w: number; h: number }
  /** Entrée envoyée au modèle : décor + aplats + produit posé */
  posedInputPath: string
  rawOutputPath: string
  deliveryPath: string
  nativeSizeRespected: boolean
  promptVersion: number
  debordPct: number
  seuilAlpha: number
  /** Opacité de l'ombre pilier→lame appliquée (%, coulissant ; 0 = sans ombre) */
  ombrePilierPct: number
  /** Cible RALify appliquée au PNG produit ('#rrggbb', null = pas de traitement) */
  ralifyCible: string | null
  /** Pixels de matière restaurés dans les trous d'alpha du PNG fournisseur (pieds alu…) */
  alphaReparePx: number
  /** Pieds repérés sous le bord bas du produit (ombre de contact + recollage) */
  piedsDetectes: number
}

function imageSizeFromDims(width: number, height: number): ImageSize | null {
  for (const [k, d] of Object.entries(NATIVE_DIMS)) {
    if (d.width === width && d.height === height) return k as ImageSize
  }
  return null
}

/**
 * Description du coloris pour le prompt (placeholder {COLORIS} du prompt Admin).
 * Palette CASANOOV (Gris 7016 · Noir 9005 · Blanc · Teck) — un libellé libre est
 * toléré (la génération directe lit le coloris dans le nom de fichier). Coloris
 * inconnu ou absent : formulation neutre, le produit posé fait foi.
 */
export function colorisPromptDescription(coloris?: string): string {
  const c = (coloris ?? '').toUpperCase()
  if (c.includes('TECK') || c.includes('BOIS')) {
    return 'a warm teak wood-effect finish with visible wood grain'
  }
  if (c.includes('GRIS') || c.includes('ANTHRACITE') || c.includes('7016')) {
    return 'a dark anthracite gray RAL 7016 powder-coated finish'
  }
  if (c.includes('NOIR') || c.includes('9005')) {
    return 'a black RAL 9005 powder-coated finish'
  }
  if (c.includes('BLANC')) {
    return 'a pure white powder-coated finish'
  }
  return 'exactly the colour and finish visible on the pasted gate'
}

export async function runPoseFusionStep(opts: PoseFusionStepOptions): Promise<PoseFusionStepResult> {
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
  const slug = opts.slug ?? 'pose-fusion'
  const moteurKey: MoteurKey = opts.moteur ?? 'battant'
  const moteur = getMoteurReglages(moteurKey)
  // Coulissants XL (22/07/2026) : alignement et image Canny du JEU de la taille
  // (section « Canny XL » de la fiche TERMINUS) — le reste suit le moteur.
  const jeu = gabaritSetForSize(moteurKey, opts.size.w)
  const cannyReg = jeu === moteurKey ? moteur : getMoteurReglages(jeu)
  const align =
    opts.align ??
    (cannyReg.cannyPlacement === 'manuel' ? cannyReg.cannyOffsetPx : cannyReg.cannyPlacement)

  // Verrou LARGEUR uniquement : la règle validée le 17/07 choisit le PNG de même
  // largeur et de hauteur la plus proche, l'étirement libre absorbe l'écart de
  // hauteur (ex. taille 400×100 → PNG 400B115). Une largeur différente reste interdite.
  const nameSize = parseSizeFromProductName(path.basename(opts.productPath))
  if (nameSize && nameSize.w !== opts.size.w) {
    throw new Error(
      `Produit incompatible : « ${path.basename(opts.productPath)} » est un ${nameSize.w} cm de large, ` +
        `ce job est un ${opts.size.w}×${opts.size.h}.`
    )
  }

  const db = getDb()
  let jobId = opts.jobId
  if (jobId === undefined) {
    const job = db
      .prepare(`INSERT INTO jobs (type, status, payload) VALUES ('pose-fusion', 'running', ?)`)
      .run(JSON.stringify({ decorPath: opts.decorPath, size: opts.size, productPath: opts.productPath, align, slug }))
    jobId = Number(job.lastInsertRowid)
  }

  try {
    // 1. Alignement de la ligne de sol sur le trottoir réel — même logique que
    //    l'étape Piliers (le repli « offset 0 » est le plan de base, 11/07/2026).
    const cannyPath = cannyRefPath(jeu)
    let groundOffsetPxNative = 0
    let groundAlign: PoseFusionStepResult['groundAlign']
    if (typeof align === 'number') {
      groundOffsetPxNative = Math.round(align)
      groundAlign = 'manual'
    } else if (align === 'auto') {
      const bands = (await whiteLineBands(cannyPath)).filter((b) => b.yNorm > 0.5)
      const profile = await horizontalEdgeProfile(opts.decorPath)
      // XL (22/07/2026) : mesure calée sur le bord HAUT du trottoir — même
      // aiguillage que l'étape Piliers (voir pillars.ts, jobs #136-148).
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
    const adjustedParams: Partial<GabaritParams> = {
      ...opts.params,
      groundY: baseParams.groundY - offsetCm,
    }

    const dir = path.join(config.artifactsDir, 'pose-fusion', slug, sizeLabel)
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')

    // 2. Brouillon composite : décor + aplats gris + produit détouré POSÉ (brique pose).
    const { image: overlay } = await overlayGabaritOnDecor(opts.decorPath, opts.size, adjustedParams)
    const layout = computeLayout(opts.size, adjustedParams)
    const p = projection(width, height, layout.sceneW, layout.sceneH)
    const gate = projectRect(
      { x: layout.gateLeft, y: layout.gateTop, w: layout.gateW, h: layout.gateH },
      p
    )
    // Retrait des piliers du visuel fournisseur (brique existante du chantier 2,
    // garde-fous inclus — détection ambiguë = image conservée telle quelle) :
    // certains rendus (ARLBERG…) gardent leurs piliers blancs en PLEINE opacité,
    // et en pose-fusion tout pixel posé se retrouve dans la MES.
    const prepared = await prepareProduct(opts.productPath, {
      removePillars: true,
      expectedSize: opts.size,
    })

    // RALify (28/07/2026, maquette ralify-v2) : la teinte de la matière est
    // ramenée au RAL cible du moteur (espace LAB, luminance conservée — ombres
    // et reflets d'origine gardés) AVANT la pose. Cible résolue par coloris
    // détecté + exceptions par nom de produit ; null = ne pas toucher.
    const ralifyCible = resolveRalifyCible(
      moteur.ralify,
      `${opts.productName ?? ''} ${path.basename(opts.productPath)}`,
      opts.coloris
    )
    let produitPret = prepared.image
    if (ralifyCible) {
      const ralify = await appliquerRalify(prepared.image, ralifyCible, moteur.ralify.intensite)
      produitPret = ralify.image
      // Artefact de contrôle : ce qui part réellement chez Nano.
      fs.writeFileSync(path.join(dir, `0-produit-ralify-${stamp}.png`), produitPret)
    }

    let pose: PoseResult
    let posedImage: Buffer
    if (moteurKey === 'coulissant') {
      // COULISSANT « TERMINUS » (recherche 13/07, docs/MOTEUR-COULISSANT-prompt.md) :
      // la lame est plus large que l'ouverture — cible = ouverture + 50 % du pilier
      // droit EN RECOUVREMENT, bord gauche ancré EN DUR sur l'ouverture. La lame
      // passe DERRIÈRE le pilier : les aplats sont redessinés PAR-DESSUS la lame
      // (avant tout rendu — rien à voir avec le recollage de stucco rejeté le
      // 13/07), et le prompt fait du pilier un volume d'avant-plan qui l'occulte.
      const pRight = projectRect(layout.pillarRight, p)
      const cible = {
        x: gate.x,
        y: gate.y,
        w: Math.round(gate.w + pRight.w * 0.5),
        h: Math.round(gate.h),
      }
      // Une lame n'a pas de pieds : la réparation « poches enclavées » est coupée,
      // sinon la clairance sous-lame (compartimentée par les galets) serait rebouchée.
      pose = await poserProduitSurCible(overlay, produitPret, cible, moteur.poseSeuilAlpha, false)
      const gabarit = await renderGabaritPng(opts.size, adjustedParams, width, height)
      // Ombre du pilier droit sur la lame (28/07/2026, réglage Admin « Ombre du
      // pilier ») : la scène frontale n'offre aucun autre indice de profondeur,
      // et Nano terminait la lame AVANT le pilier (joint sombre) au lieu de la
      // faire disparaître derrière (jobs #19-26). La bande dégradée d'occlusion
      // ambiante le long de la face gauche du pilier lui dit « le pilier est
      // devant ». Profil retenu par Mathias (28/07 apm, 2ᵉ itération) : dégradé
      // TRÈS progressif — bande d'1,5 × la largeur du pilier, de 0 à l'opacité
      // réglée (25 % par défaut) au contact de la face. Jamais de bloc sombre.
      // 3ᵉ itération (retour Mathias) : la bande descend JUSQU'AU SOL — sinon la
      // fente sous la lame reste claire au pied du pilier et Nano y montre herbe
      // et jour, comme si la lame S'ARRÊTAIT au pilier au lieu de filer derrière.
      const calques: sharp.OverlayOptions[] = [{ input: gabarit }]
      if (moteur.ombrePilierPct > 0) {
        const bandW = Math.round(pRight.w * 1.5)
        const bandH = Math.round(pRight.y + pRight.h - gate.y)
        const opacite = Math.min(100, moteur.ombrePilierPct) / 100
        const ombre = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="black" stop-opacity="0"/>
      <stop offset="1" stop-color="black" stop-opacity="${opacite}"/>
    </linearGradient>
  </defs>
  <rect x="${pRight.x - bandW}" y="${gate.y}" width="${bandW}" height="${bandH}" fill="url(#g)"/>
</svg>`
        calques.push({ input: Buffer.from(ombre) })
      }
      posedImage = await sharp(pose.image).composite(calques).png().toBuffer()
    } else {
      // BATTANT / PORTILLON : produit posé PAR-DESSUS les aplats (gonds et pieds
      // en débord sur les piliers), débord réglé dans l'Admin.
      pose = await poserProduit(overlay, produitPret, gate, {
        debord: moteur.poseDebordPct / 100,
        seuilAlpha: moteur.poseSeuilAlpha,
      })
      posedImage = pose.image
    }

    // Protection des PIEDS (28/07/2026, brique src/lib/images/pieds.ts) : Nano
    // « nettoie » les petits pieds alu malgré la section SUPPORT FEET du prompt
    // (constat job #33). Repérage ici, recollage des pixels d'origine APRÈS
    // l'appel (étape 3 bis). L'ombre de contact dessinée AVANT l'appel a été
    // testée et REJETÉE le 28/07 : Nano transforme le pied ombré en sabot noir.
    // Coulissant : les aplats piliers sont redessinés PAR-DESSUS la lame — un
    // galet dans ces zones n'est plus visible dans l'entrée, on l'écarte.
    const exclusionsPieds =
      moteurKey === 'coulissant'
        ? [projectRect(layout.pillarLeft, p), projectRect(layout.pillarRight, p)]
        : []
    // Décision Mathias 28/07 : protection des PIEDS UNIQUEMENT — le recollage
    // des poteaux (brique detecterPoteaux, testée) reste débranché.
    const pieds = await detecterPieds(pose.etire, pose.cible, exclusionsPieds)
    const posedInputPath = path.join(dir, `1-entree-posee-${stamp}.png`)
    fs.writeFileSync(posedInputPath, posedImage)

    // 3. UN appel Nano : stuc + intégration photographique du portail déjà posé.
    //    Prompt système versionné, PROPRE au moteur, coloris injecté ({COLORIS}).
    const promptRow = getActivePrompt(moteurPromptName(moteurKey, 'pose-fusion'))
    const prompt = promptRow.content.replaceAll('{COLORIS}', colorisPromptDescription(opts.coloris))
    const generated = await generateImage({
      prompt,
      images: [{ source: posedImage, mimeType: 'image/png' }],
      aspectRatio: '3:2',
      imageSize,
      model: opts.imageModel,
      jobId,
      artifactName: `2-sortie-brute-${sizeLabel}`,
      artifactDir: path.join('pose-fusion', slug, sizeLabel),
    })
    const nativeSizeRespected = generated.width === width && generated.height === height

    // 3 bis. Recollage des pieds : le portail ne bouge pas d'un pixel entre
    // entrée et sortie, on recopie donc les pixels des pieds de l'entrée posée
    // sur la sortie (masque = alpha du produit rétréci d'un pixel, exposition
    // recalée sur le rendu, bord haut fondu). Artefact 2b conservé pour
    // comparer avec la sortie brute.
    let sortieFinale = generated.buffer
    if (pieds.length) {
      const recolle = await recollerPieds(
        generated.buffer,
        { width: generated.width, height: generated.height },
        posedImage,
        { width, height },
        pose.etire,
        pose.cible,
        pieds
      )
      if (recolle) {
        sortieFinale = recolle
        fs.writeFileSync(path.join(dir, `2b-sortie-pieds-recolles-${stamp}.png`), sortieFinale)
      }
    }

    // 4. La sortie brute est l'image finale — la livraison e-commerce est l'unique
    //    transformation appliquée.
    const delivery = await sharp(sortieFinale)
      .resize(config.delivery.width, config.delivery.height, { fit: 'fill' })
      .jpeg(config.deliveryJpeg)
      .toBuffer()
    const deliveryPath = path.join(
      dir,
      `3-livraison-${config.delivery.width}x${config.delivery.height}-${stamp}.jpg`
    )
    fs.writeFileSync(deliveryPath, delivery)
    // Le réencodage sharp repart de zéro côté métadonnées → on re-marque le livrable.
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
      rawOutputPath: generated.artifactPath,
      deliveryPath,
      nativeSizeRespected,
      promptVersion: promptRow.version,
      debordPct: moteur.poseDebordPct,
      seuilAlpha: moteur.poseSeuilAlpha,
      ombrePilierPct: moteurKey === 'coulissant' ? moteur.ombrePilierPct : 0,
      ralifyCible,
      alphaReparePx: pose.produit.alphaReparePx,
      piedsDetectes: pieds.length,
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
        rawOutputPath: path.relative(config.rootDir, generated.artifactPath),
        deliveryPath: path.relative(config.rootDir, deliveryPath),
        zonePx: result.zonePx,
        // Zone produit en FRACTIONS (0..1) — sert au recadrage Marketplace (bloc 3.3).
        zoneFrac: {
          x: pose.cible.x / width,
          y: pose.cible.y / height,
          w: pose.cible.w / width,
          h: pose.cible.h / height,
        },
        groundOffsetPxNative,
        groundAlign,
        nativeSizeRespected,
        promptVersion: promptRow.version,
        debordPct: moteur.poseDebordPct,
        seuilAlpha: moteur.poseSeuilAlpha,
        ombrePilierPct: result.ombrePilierPct,
        ralifyCible,
        alphaReparePx: pose.produit.alphaReparePx,
        piedsDetectes: pieds.length,
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
