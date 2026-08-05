import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { config } from '@/lib/config'
import { getDb } from '@/lib/db'
import { getActivePrompt } from '@/lib/db/prompts'
import { generateImage } from '@/lib/genai/client'
import { marquerImageIa } from '@/lib/images/marquage'
import { DEFAULT_PARAMS, computeLayout, projection, projectRect, type GabaritParams } from '@/lib/geometry'
import { poserDeuxVantaux, poserUnVantail } from '@/lib/images/pose'
import { prepareProduct } from '@/lib/images/product'
import { appliquerRalify } from '@/lib/images/ralify'
import { estimateShift, applyShift, compositeWithMask } from '@/lib/images/composite'
import { addShadowsToMask } from '@/lib/images/shadows'
import { resolveRalifyCible } from '@/lib/ralify'
import { parseSizeFromProductName } from '@/lib/productName'
import { getMoteurReglages, moteurPromptName, type MoteurKey } from '@/lib/moteurs'
import { runPillarsStep, type PillarsStepResult } from '@/lib/pipeline/pillars'
import { piedsProduitCatalogue, piedsProduitLibre } from '@/lib/genai/jugePieds'
import { cibleOuverture } from '@/lib/genai/mesureOuverture'
import {
  appliquerSectionsPieds,
  type PoseFusionStepOptions,
  type PoseFusionStepResult,
} from '@/lib/pipeline/poseFusion'

/**
 * CIRCUIT « INTÉGRATION 2 ÉTAPES » — moteurs BATTANT (industrialisé le 29/07/2026,
 * validé en test sur ARLBERG/ATHOS/VALIER 300×140) et PORTILLON (report 30/07/2026).
 * Remplace l'appel pose-fusion unique : au lieu d'un seul rendu « stuc +
 * intégration », le décor et les piliers sont d'abord finis SANS produit, le code
 * pose ensuite le PNG au pixel près, puis un appel Nano SERRÉ ne fait que
 * l'intégration photographique (lumière + ombres de contact). Le décor est enfin
 * verrouillé à l'octet par un composite pixel-lock. Le périmètre réduit de l'appel
 * d'intégration est ce qui empêche Nano de « nettoyer » la petite quincaillerie.
 *
 * ADAPTATION PAR MOTEUR (règle « moteur = contenu adapté ») : le battant a DEUX
 * vantaux (pose coupée au montant central sur le centre mesuré) ; le portillon a
 * UN vantail unique piéton (pose d'un seul tenant entre les faces mesurées). Chaque
 * moteur lit AUSSI ses propres réglages, piliers et prompt d'intégration serrée.
 *
 * SANS JUGE (demande Mathias 29/07 : « code moi ça en dur SANS le juge ») :
 * un seul tirage d'intégration, aucun appel de contrôle.
 *
 * Coût : 1 appel scène + 1 appel intégration par visuel. La SCÈNE (étape 1) ne
 * dépend que du décor + taille + params + alignement : elle est mise en cache et
 * RÉUTILISÉE entre produits d'une même gamme (mêmes coloris, même taille, même
 * décor) → souvent 1 seul appel image par visuel supplémentaire.
 *
 * Le contrat de sortie (PoseFusionStepResult + result JSON du job kind:'pose-fusion')
 * est IDENTIQUE à runPoseFusionStep : l'UI affiche la MES sans rien savoir du circuit.
 */

const MARGE_PX = 32
const FEATHER_SIGMA = 4

interface SceneCache {
  compositePath: string
  width: number
  height: number
  imageSize: PillarsStepResult['imageSize']
  groundOffsetPxNative: number
  groundAlign: PillarsStepResult['groundAlign']
}

/**
 * Rend la scène finie SANS produit, ou réutilise une scène identique déjà rendue.
 * Clé = décor + taille + params + alignement + moteur : deux coloris d'une même
 * gamme sur le même décor partagent la scène (1 seul appel Nano). Le rendu passe
 * par runPillarsStep SANS jobId (il crée son propre job 'pillars' — on ne
 * réutilise jamais le job pose-fusion, que runPillarsStep marquerait « done »).
 */
async function rendreOuReutiliserScene(opts: PoseFusionStepOptions, moteur: MoteurKey): Promise<SceneCache> {
  const sizeLabel = `${opts.size.w}x${opts.size.h}`
  const cle = crypto
    .createHash('sha1')
    .update(
      JSON.stringify({
        decor: path.relative(config.rootDir, opts.decorPath),
        sizeLabel,
        params: opts.params ?? {},
        align: opts.align ?? null,
        moteur,
      })
    )
    .digest('hex')
    .slice(0, 16)
  const cacheDir = path.join(config.artifactsDir, 'scene-cache')
  fs.mkdirSync(cacheDir, { recursive: true })
  const cachePath = path.join(cacheDir, `${cle}.json`)

  if (fs.existsSync(cachePath)) {
    try {
      const c = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as SceneCache
      if (fs.existsSync(c.compositePath)) return c
    } catch {
      /* cache illisible → on re-rend */
    }
  }

  const pillars = await runPillarsStep({
    decorPath: opts.decorPath,
    size: opts.size,
    params: opts.params,
    align: opts.align,
    imageModel: opts.imageModel,
    moteur,
    slug: opts.slug ?? 'pose-fusion',
  })
  const c: SceneCache = {
    compositePath: pillars.compositePath,
    width: pillars.width,
    height: pillars.height,
    imageSize: pillars.imageSize,
    groundOffsetPxNative: pillars.groundOffsetPxNative,
    groundAlign: pillars.groundAlign,
  }
  fs.writeFileSync(cachePath, JSON.stringify(c))
  return c
}

export async function runIntegration2EtapesStep(
  opts: PoseFusionStepOptions
): Promise<PoseFusionStepResult> {
  const moteurKey: MoteurKey = opts.moteur ?? 'battant'
  const moteur = getMoteurReglages(moteurKey)
  const sizeLabel = `${opts.size.w}x${opts.size.h}`
  const slug = opts.slug ?? 'pose-fusion'

  // Verrou LARGEUR (règle du 17/07) : même largeur obligatoire, l'étirement libre
  // absorbe l'écart de hauteur — cohérent avec runPoseFusionStep.
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
      .run(
        JSON.stringify({
          decorPath: opts.decorPath,
          size: opts.size,
          productPath: opts.productPath,
          align: opts.align,
          slug,
        })
      )
    jobId = Number(job.lastInsertRowid)
  }

  try {
    const dir = path.join(config.artifactsDir, 'pose-fusion', slug, sizeLabel)
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')

    // ÉTAPE 1 — scène finie SANS produit (rendue ou réutilisée).
    const scene = await rendreOuReutiliserScene(opts, moteurKey)
    const { width, height, imageSize } = scene

    // Géométrie calée sur le SOL DE LA SCÈNE (son décalage, pas un nouveau calcul).
    const baseParams: GabaritParams = { ...DEFAULT_PARAMS, ...opts.params }
    const offsetCm = (scene.groundOffsetPxNative / height) * baseParams.sceneH
    const adjusted: Partial<GabaritParams> = { ...opts.params, groundY: baseParams.groundY - offsetCm }
    const layout = computeLayout(opts.size, adjusted)
    const p = projection(width, height, layout.sceneW, layout.sceneH)
    const gate = projectRect({ x: layout.gateLeft, y: layout.gateTop, w: layout.gateW, h: layout.gateH }, p)

    // OUVERTURE MESURÉE (30/07/2026, validé Mathias) : on ne fait plus confiance
    // au gabarit pour la largeur/position — UN appel vision flash lit les 2 faces
    // des piliers + le centre de l'ouverture sur la scène finie. La pose « deux
    // vantaux » posera le montant central sur le CENTRE mesuré et étirera chaque
    // vantail jusqu'à sa face (± marge de recouvrement). SANS juge ; mesure
    // invraisemblable/erreur → repli sur le gabarit.
    const ouv = await cibleOuverture(scene.compositePath, gate, width, jobId)

    // Produit : préparé (piliers fournisseur retirés) puis RALify (comme pose-fusion).
    const prepared = await prepareProduct(opts.productPath, { removePillars: true, expectedSize: opts.size })
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

    // Drapeau PIEDS (29/07) : fiche catalogue jugée une fois puis lue ; image
    // libre jugée à chaque rendu. Pilote la réparation de bande basse ET les
    // sections [PIEDS]/[SANS-PIEDS] du prompt d'intégration.
    const piedsProduit = opts.catalogProductId
      ? await piedsProduitCatalogue(opts.catalogProductId, prepared.image, jobId)
      : await piedsProduitLibre(prepared.image, jobId)

    // ÉTAPE 2 — pose du produit sur l'ouverture mesurée (blueL/blueR = faces ±
    // recouvrement). Vertical (y, h) = gabarit. Le `layer` (produit seul sur fond
    // transparent) servira à dériver le masque du composite. La pose diffère selon
    // le moteur : BATTANT = « deux vantaux » (coupé au montant central posé sur le
    // CENTRE mesuré, chaque moitié étirée jusqu'à sa face) ; PORTILLON = vantail
    // UNIQUE étiré d'un seul tenant entre les faces (centre ignoré, pas de coupe).
    const pose =
      moteurKey === 'portillon'
        ? await poserUnVantail(
            scene.compositePath,
            produitPret,
            { blueL: ouv.blueL, blueR: ouv.blueR, y: gate.y, h: gate.h },
            moteur.poseSeuilAlpha,
            piedsProduit
          )
        : await poserDeuxVantaux(
            scene.compositePath,
            produitPret,
            { blueL: ouv.blueL, blueR: ouv.blueR, centre: ouv.centre, y: gate.y, h: gate.h },
            moteur.poseSeuilAlpha,
            piedsProduit
          )
    const cible = pose.cible
    const posedInputPath = path.join(dir, `1-entree-posee-${stamp}.png`)
    fs.writeFileSync(posedInputPath, pose.image)

    // ÉTAPE 3 — appel Nano d'intégration SERRÉ (prompt dynamique pieds), 1 tirage.
    const promptRow = getActivePrompt(moteurPromptName(moteurKey, 'pose-fusion-integration'))
    const prompt = appliquerSectionsPieds(promptRow.content, piedsProduit)
    const generated = await generateImage({
      prompt,
      images: [{ source: pose.image, mimeType: 'image/png' }],
      aspectRatio: '3:2',
      imageSize,
      model: opts.imageModel,
      jobId,
      artifactName: `2-sortie-brute-${sizeLabel}`,
      artifactDir: path.join('pose-fusion', slug, sizeLabel),
    })
    const nativeSizeRespected = generated.width === width && generated.height === height

    // ÉTAPE 4 — composite pixel-lock : le décor de l'entrée posée est verrouillé à
    // l'octet, seule la zone produit (+ ombres de contact détectées) vient de la
    // sortie Nano. Recette validée le 29/07 (test-2-etapes-composite). DÉSACTIVABLE
    // par moteur (réglage Admin « Masquage / composite » — 05/08/2026) : sur 'off',
    // la sortie brute de Nano est l'image finale, sans verrouillage du décor.
    let sortie = await sharp(generated.buffer, { limitInputPixels: false })
      .resize(width, height, { fit: 'fill' })
      .png()
      .toBuffer()
    let sortieFinale: Buffer
    let changedFraction: number | null = null
    if (moteur.poseFusionComposite === 'off') {
      sortieFinale = sortie
    } else {
      let shift = await estimateShift(posedInputPath, sortie, 8, 4)
      if (shift.atBound) shift = await estimateShift(posedInputPath, sortie, 16, 4)
      if (!shift.atBound && (shift.dx !== 0 || shift.dy !== 0)) {
        sortie = await applyShift(sortie, shift.dx, shift.dy)
      }

      // Masque = alpha du LAYER réellement posé (pose deux vantaux), BINARISÉ (les
      // pieds ont un alpha voile → binariser AVANT dilatation) puis dilaté ≈ MARGE_PX.
      // Le layer est déjà à la taille de la scène → composite à (0,0). Deux threshold()
      // dans le même pipeline sharp ne s'enchaînent pas → pipelines séparés.
      const binaire = await sharp(pose.layer)
        .ensureAlpha()
        .extractChannel(3)
        .threshold(1)
        .png()
        .toBuffer()
      const dilate = await sharp(binaire).blur(MARGE_PX / 2).threshold(8).png().toBuffer()
      // Bande de contact au sol : toute la zone pieds + sol immédiat vient de la
      // SORTIE (le pied translucide de l'entrée ne doit jamais transparaître).
      const bandeY = Math.max(0, cible.y + cible.h - 60)
      const bande = Buffer.from(
        `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect x="${cible.x - 20}" y="${bandeY}" width="${cible.w + 40}" height="150" fill="white"/></svg>`
      )
      const masqueBase = await sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } })
        .composite([{ input: dilate }, { input: bande }])
        .png()
        .toBuffer()
      const det = await addShadowsToMask(posedInputPath, sortie, masqueBase)
      const composite = await compositeWithMask(posedInputPath, sortie, det.mask, FEATHER_SIGMA)
      sortieFinale = composite.image
      changedFraction = Number(composite.changedFraction.toFixed(4))
      fs.writeFileSync(path.join(dir, `2b-composite-${stamp}.png`), sortieFinale)
    }

    // Livraison e-commerce (unique transformation appliquée à l'image finale).
    const delivery = await sharp(sortieFinale)
      .resize(config.delivery.width, config.delivery.height, { fit: 'fill' })
      .jpeg(config.deliveryJpeg)
      .toBuffer()
    const deliveryPath = path.join(dir, `3-livraison-${config.delivery.width}x${config.delivery.height}-${stamp}.jpg`)
    fs.writeFileSync(deliveryPath, delivery)
    await marquerImageIa(deliveryPath)

    const result: PoseFusionStepResult = {
      jobId,
      sizeLabel,
      width,
      height,
      imageSize,
      groundOffsetPxNative: scene.groundOffsetPxNative,
      groundAlign: scene.groundAlign,
      zonePx: pose.cible,
      posedInputPath,
      rawOutputPath: generated.artifactPath,
      deliveryPath,
      nativeSizeRespected,
      promptVersion: promptRow.version,
      debordPct: 0,
      seuilAlpha: moteur.poseSeuilAlpha,
      ombrePilierPct: 0,
      ralifyCible,
      alphaReparePx: pose.produit.alphaReparePx,
      piedsDetectes: 0,
      piedsProduit,
    }

    db.prepare(`UPDATE jobs SET status = 'done', result = ?, updated_at = datetime('now') WHERE id = ?`).run(
      JSON.stringify({
        kind: 'pose-fusion',
        sizeLabel,
        imageSize,
        productPath: path.relative(config.rootDir, opts.productPath),
        posedInputPath: path.relative(config.rootDir, posedInputPath),
        rawOutputPath: path.relative(config.rootDir, generated.artifactPath),
        deliveryPath: path.relative(config.rootDir, deliveryPath),
        zonePx: result.zonePx,
        zoneFrac: {
          x: pose.cible.x / width,
          y: pose.cible.y / height,
          w: pose.cible.w / width,
          h: pose.cible.h / height,
        },
        groundOffsetPxNative: scene.groundOffsetPxNative,
        groundAlign: scene.groundAlign,
        nativeSizeRespected,
        promptVersion: promptRow.version,
        debordPct: 0,
        seuilAlpha: moteur.poseSeuilAlpha,
        ombrePilierPct: 0,
        ralifyCible,
        alphaReparePx: pose.produit.alphaReparePx,
        piedsDetectes: 0,
        piedsProduit,
        methode: 'integration-2-etapes',
        composite: moteur.poseFusionComposite,
        changedFraction: changedFraction ?? undefined,
        // Recalage vision de l'ouverture (30/07/2026).
        ouvertureMesuree: ouv.mesuree,
        ouverture: ouv.mesure ?? undefined,
        ouvertureCible: { blueL: ouv.blueL, blueR: ouv.blueR, centre: ouv.centre },
      }),
      jobId
    )
    return result
  } catch (err) {
    db.prepare(`UPDATE jobs SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?`).run(
      err instanceof Error ? err.message : String(err),
      jobId
    )
    throw err
  }
}
