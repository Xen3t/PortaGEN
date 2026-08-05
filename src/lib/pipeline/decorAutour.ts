import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { config } from '@/lib/config'
import { getDb } from '@/lib/db'
import { getActivePrompt } from '@/lib/db/prompts'
import { construirePlanGris } from '@/lib/decorAutour'
import { generateImage, type ImageSize } from '@/lib/genai/client'
import { piedsProduitCatalogue, piedsProduitLibre } from '@/lib/genai/jugePieds'
import { marquerImageIa } from '@/lib/images/marquage'
import { appliquerRalify } from '@/lib/images/ralify'
import { resolveRalifyCible } from '@/lib/ralify'
import { getMoteurDaReglages, moteurDaPromptName, type MoteurDaKey } from '@/lib/moteursDa'
import type { SizeCm } from '@/lib/geometry'

/**
 * Étape « DÉCOR AUTOUR » (bascule du 05/08/2026, docs/CADRAGE-DECOR-AUTOUR-2026-08-05.md).
 *
 * > Le code pose le produit au pixel à sa VRAIE échelle sur un plan gris ;
 * > Nano peint TOUT le décor autour (piliers, muret, maison, rue compris).
 *
 * NOUVEAU mode construit À CÔTÉ du legacy (pose-fusion / intégration 2 étapes) :
 * code copié où utile, jamais modifié chez lui. SES MOTEURS (séparation totale
 * 05/08 : src/lib/moteursDa.ts — janus/terminus/forculus), SES réglages, SES
 * prompts. Pipeline collapsé — pas de décor Canny, pas d'étape Piliers, pas de
 * composite pixel :
 *  1. RALify sur le PNG produit (réglage moteur, conservé — décision Mathias 05/08) ;
 *  2. plan gris format livraison + pose à l'échelle PortaGEN (lib/decorAutour) ;
 *  3. UN appel Nano — prompt DU moteur en base (janus-decor-autour / terminus-… /
 *     forculus-…), ossature « élévation à plat + produit verrouillé » ;
 *  4. la sortie BRUTE est l'image finale — seule la livraison est recadrée.
 *
 * Le result JSON pose deliveryPath + zoneFrac : la déclinaison Marketplace
 * (recadrage 1:1) fonctionne comme pour les MES legacy.
 */

export interface DecorAutourStepOptions {
  /** Image produit (PNG détouré) — chemin ABSOLU déjà validé par l'appelant */
  productPath: string
  size: SizeCm
  /** Qualité Nano ('2K' par défaut — choix au lancement, décision Mathias 05/08) */
  imageSize?: ImageSize
  slug?: string
  coloris?: string
  productName?: string
  /** Moteur décor autour : ses réglages, SON prompt. Absent = janus (battant). */
  moteur?: MoteurDaKey
  /** Fiche catalogue (drapeau pieds enregistré) — absent = image libre, jugée à chaque rendu */
  catalogProductId?: number
  /** Job existant (créé par le runner) — sinon la fonction crée le sien (scripts CLI) */
  jobId?: number
}

export interface DecorAutourStepResult {
  jobId: number
  sizeLabel: string
  imageSize: ImageSize
  /** Empreinte réelle du produit posé sur le plan (px livraison) */
  zonePx: { x: number; y: number; w: number; h: number }
  planPath: string
  rawOutputPath: string
  deliveryPath: string
  promptVersion: number
  ralifyCible: string | null
  alphaReparePx: number
  piedsProduit: boolean
}

/**
 * Description du coloris pour le prompt (placeholder {COLORIS}).
 * COPIE de src/lib/pipeline/poseFusion.ts (règle bascule 05/08 : on copie, on ne
 * modifie jamais le legacy). Palette CASANOOV, libellé libre toléré.
 */
function colorisPromptDescription(coloris?: string): string {
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
  return 'exactly the colour and finish visible on the placed product'
}

export async function runDecorAutourStep(
  opts: DecorAutourStepOptions
): Promise<DecorAutourStepResult> {
  const moteurKey: MoteurDaKey = opts.moteur ?? 'janus'
  const moteur = getMoteurDaReglages(moteurKey)
  const sizeLabel = `${opts.size.w}x${opts.size.h}`
  const slug = opts.slug ?? 'decor-autour'
  const imageSize: ImageSize = opts.imageSize ?? '2K'

  const db = getDb()
  let jobId = opts.jobId
  if (jobId === undefined) {
    const job = db
      .prepare(`INSERT INTO jobs (type, status, payload) VALUES ('decor-autour', 'running', ?)`)
      .run(JSON.stringify({ productPath: opts.productPath, size: opts.size, slug }))
    jobId = Number(job.lastInsertRowid)
  }

  try {
    const dir = path.join(config.artifactsDir, 'decor-autour', slug, sizeLabel)
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')

    // 1. RALify (conservé — décision Mathias 05/08) : la teinte de la matière est
    //    ramenée au RAL cible du moteur AVANT la pose. null = ne pas toucher.
    const ralifyCible = resolveRalifyCible(
      moteur.ralify,
      `${opts.productName ?? ''} ${path.basename(opts.productPath)}`,
      opts.coloris
    )
    let produitPret: Buffer | string = opts.productPath
    if (ralifyCible) {
      const ralify = await appliquerRalify(fs.readFileSync(opts.productPath), ralifyCible, moteur.ralify.intensite)
      produitPret = ralify.image
      fs.writeFileSync(path.join(dir, `0-produit-ralify-${stamp}.png`), produitPret)
    }

    // Drapeau PIEDS (repris du legacy, validé 29/07) : pilote la réparation de
    // bande basse à la pose. TERMINUS (coulissant) : une lame n'a jamais de
    // pieds, et sa clairance sous-lame ne doit jamais être rebouchée.
    let piedsProduit = true
    if (moteurKey === 'terminus') {
      piedsProduit = false
    } else {
      const buf = Buffer.isBuffer(produitPret) ? produitPret : fs.readFileSync(produitPret)
      piedsProduit = opts.catalogProductId
        ? await piedsProduitCatalogue(opts.catalogProductId, buf, jobId)
        : await piedsProduitLibre(buf, jobId)
    }

    // 2. Plan gris : produit posé à sa vraie échelle (géométrie + pose PortaGEN).
    const plan = await construirePlanGris(produitPret, opts.size, {
      seuilAlpha: moteur.poseSeuilAlpha,
      reparePieds: piedsProduit,
      reparePochesPieds: moteurKey !== 'terminus',
    })
    const planPath = path.join(dir, `1-plan-gris-${stamp}.png`)
    fs.writeFileSync(planPath, plan.buffer)

    // 3. UN appel Nano : le prompt DU moteur (base), {COLORIS} injecté si présent.
    const promptRow = getActivePrompt(moteurDaPromptName(moteurKey, 'decor-autour'))
    const prompt = promptRow.content.replaceAll(
      '{COLORIS}',
      colorisPromptDescription(opts.coloris)
    )
    const generated = await generateImage({
      prompt,
      images: [{ source: plan.buffer, mimeType: 'image/png' }],
      aspectRatio: '3:2',
      imageSize,
      jobId,
      artifactName: `2-sortie-brute-${sizeLabel}`,
      artifactDir: path.join('decor-autour', slug, sizeLabel),
    })

    // 4. Sortie brute = image finale ; seule la livraison e-commerce est recadrée.
    const delivery = await sharp(generated.buffer)
      .resize(plan.planW, plan.planH, { fit: 'cover' })
      .jpeg(config.deliveryJpeg)
      .toBuffer()
    const deliveryPath = path.join(
      dir,
      `3-livraison-${plan.planW}x${plan.planH}-${stamp}.jpg`
    )
    fs.writeFileSync(deliveryPath, delivery)
    // Le réencodage sharp repart de zéro côté métadonnées → on re-marque le livrable.
    await marquerImageIa(deliveryPath)

    const result: DecorAutourStepResult = {
      jobId,
      sizeLabel,
      imageSize,
      zonePx: plan.portail,
      planPath,
      rawOutputPath: generated.artifactPath,
      deliveryPath,
      promptVersion: promptRow.version,
      ralifyCible,
      alphaReparePx: plan.alphaReparePx,
      piedsProduit,
    }

    db.prepare(
      `UPDATE jobs SET status = 'done', result = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      JSON.stringify({
        kind: 'decor-autour',
        sizeLabel,
        imageSize,
        productPath: path.relative(config.rootDir, opts.productPath),
        planPath: path.relative(config.rootDir, planPath),
        rawOutputPath: path.relative(config.rootDir, generated.artifactPath),
        deliveryPath: path.relative(config.rootDir, deliveryPath),
        zonePx: result.zonePx,
        // Zone produit en FRACTIONS (0..1) — le recadrage Marketplace s'en sert.
        zoneFrac: {
          x: plan.portail.x / plan.planW,
          y: plan.portail.y / plan.planH,
          w: plan.portail.w / plan.planW,
          h: plan.portail.h / plan.planH,
        },
        promptVersion: promptRow.version,
        ralifyCible,
        alphaReparePx: plan.alphaReparePx,
        piedsProduit,
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
