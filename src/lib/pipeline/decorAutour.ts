import fsp from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { config } from '@/lib/config'
import { getDb } from '@/lib/db'
import { getActivePrompt } from '@/lib/db/prompts'
import { cadrageDaEffectif } from '@/lib/cadrageDa'
import { construirePlanGris } from '@/lib/decorAutour'
import { generateImage, type ImageSize } from '@/lib/genai/client'
import { marquerImageIa } from '@/lib/images/marquage'
import { appliquerRalify } from '@/lib/images/ralify'
import { resolveRalifyCible } from '@/lib/ralify'
import { getMoteurDaReglages, moteurDaPromptName, type MoteurDaKey } from '@/lib/moteursDa'
import { sasCalculImage } from '@/lib/server/sasImages'
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
  /**
   * Largeur de référence imposée (cm) — posé UNIQUEMENT par le banc
   * « génération & resizing » (400, ordre Mathias 07/08). Absent (MES Écrin,
   * mini-app) = pose à la vraie largeur du produit.
   */
  refWidth?: number
  /** Bandes de sol dessinées sous le portail (BANC uniquement, rodage v3 07/08). */
  bandesSol?: boolean
  /** Bloc gabarit FIGÉ (banc portillon : zoom/décalage Y/hauteurs pilier…) —
   *  porté par le payload, JAMAIS lu sur les gabarits legacy (interdit 07/08). */
  gabarit?: Partial<import('@/lib/geometry').GabaritParams>
  /** Coulissant : lame passée DERRIÈRE les deux piliers (aplats repeints devant). */
  pilierDroitDevant?: boolean
  /**
   * Description PRODUIT (bibliothèque vision, rodage 07/08) — injectée dans le
   * prompt à la place de {PRODUIT} : structure, cadre, remplissage,
   * quincaillerie. Absente = phrase générique (produit tel que dans l'image).
   */
  productDescription?: string
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
    await fsp.mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')

    const ralifyCible = resolveRalifyCible(
      moteur.ralify,
      `${opts.productName ?? ''} ${path.basename(opts.productPath)}`,
      opts.coloris
    )

    // Phases 1-2 sous sas (07/08) : avec 20 jobs en vol, RALify + pose sharp
    // simultanés saturaient CPU/RAM du processus web (UI figée). Le sas les fait
    // passer 3 par 3 ; l'attente Nano, elle, reste libre.
    const { plan, planPath, produitBuffer } = await sasCalculImage(async () => {
      // 1. RALify (conservé — décision Mathias 05/08) : la teinte de la matière est
      //    ramenée au RAL cible du moteur AVANT la pose. null = ne pas toucher.
      let produitPret: Buffer | string = opts.productPath
      if (ralifyCible) {
        const ralify = await appliquerRalify(
          await fsp.readFile(opts.productPath),
          ralifyCible,
          moteur.ralify.intensite
        )
        produitPret = ralify.image
        await fsp.writeFile(path.join(dir, `0-produit-ralify-${stamp}.png`), produitPret)
      }

      // 2. Plan gris : produit posé à sa vraie échelle (géométrie + pose PortaGEN),
      //    TEL QUEL — aucun juge ni réparation dans la nouvelle méthode (demande
      //    Mathias 07/08) : les PNG sont propres, faits main (décision 21/07).
      // Zoom/décalage Y : valeurs FIGÉES portées par le payload (banc). AUCUNE
      // lecture des gabarits legacy ici — INTERDIT (Mathias 07/08) : leurs
      // curseurs ne sont qu'un outil de réglage visuel, les valeurs retenues
      // sont extraites puis figées dans la recette.
      // Couleurs + recouvrement + seuils de queue : réglage « Cadrage & scène »
      // du moteur, lu au moment du run (comme RALify) — 07/08.
      const cadrage = cadrageDaEffectif(moteurKey, moteur.cadrageDa)
      const plan = await construirePlanGris(produitPret, opts.size, {
        seuilAlpha: moteur.poseSeuilAlpha,
        refWidth: opts.refWidth,
        bandesSol: opts.bandesSol,
        gabarit: opts.gabarit,
        pilierDroitDevant: opts.pilierDroitDevant,
        couleurs: cadrage.couleurs,
        recouvrementCm: cadrage.recouvrementCm,
        queueCouverturePct: cadrage.queueCouverturePct,
        queueSeuilPct: cadrage.queueSeuilPct,
        produitLargeurPct: cadrage.produitLargeurPct,
        produitHauteurPct: cadrage.produitHauteurPct,
      })
      const planPath = path.join(dir, `1-plan-gris-${stamp}.png`)
      await fsp.writeFile(planPath, plan.buffer)
      // Le produit prêt (RALifié ou brut) ressort en Buffer : le COULISSANT le
      // joint en 2ᵉ image de référence à l'appel Nano (rodage 07/08).
      const produitBuffer =
        typeof produitPret === 'string' ? await fsp.readFile(produitPret) : produitPret
      return { plan, planPath, produitBuffer }
    })

    // 3. UN appel Nano : le prompt DU moteur (base). La consigne de finition
    //    ({COLORIS}) doit TOUJOURS partir : placeholder remplacé s'il existe,
    //    sinon ajoutée en fin de prompt (prompts en base seedés sans placeholder
    //    avant le 06/08 — le replaceAll seul était un no-op silencieux).
    //    {PRODUIT} (rodage 07/08) : description vision de la bibliothèque —
    //    quand elle existe, ELLE porte matières et couleurs, l'ajout {COLORIS}
    //    de secours est inutile (et contredirait un produit bi-matière).
    const promptRow = getActivePrompt(moteurDaPromptName(moteurKey, 'decor-autour'))
    const colorisTxt = colorisPromptDescription(opts.coloris)
    const productDesc = opts.productDescription?.trim()
    let prompt = promptRow.content.includes('{COLORIS}')
      ? promptRow.content.replaceAll('{COLORIS}', colorisTxt)
      : productDesc
        ? promptRow.content
        : `${promptRow.content}\n\nThe placed product keeps ${colorisTxt}.`
    if (prompt.includes('{PRODUIT}')) {
      prompt = prompt.replaceAll(
        '{PRODUIT}',
        productDesc ?? 'the gate exactly as it appears in the input image'
      )
    } else if (productDesc) {
      prompt = `${prompt}\n\nTHE PRODUCT, factually (trust this and the input image):\n${productDesc}`
    }
    // COULISSANT (rodage 07/08, après échec des leviers texte sur la lecture
    // « battant ») : le PNG produit est joint en 2ᵉ image de RÉFÉRENCE — le
    // prompt terminus v5 désigne image 1 = plan à éditer, image 2 = le produit
    // exact (UN panneau). Approche « photo jointe » validée 5/5 sur les maisons
    // plausibles. Battant/portillon (recettes validées) : une seule image.
    const images = [{ source: plan.buffer, mimeType: 'image/png' }]
    if (moteurKey === 'terminus') images.push({ source: produitBuffer, mimeType: 'image/png' })
    const generated = await generateImage({
      prompt,
      images,
      aspectRatio: '3:2',
      imageSize,
      jobId,
      artifactName: `2-sortie-brute-${sizeLabel}`,
      artifactDir: path.join('decor-autour', slug, sizeLabel),
    })

    // 4. Sortie brute = image finale ; seule la livraison e-commerce est recadrée.
    //    Recadrage sharp sous sas lui aussi (même raison que les phases 1-2).
    const delivery = await sasCalculImage(() =>
      sharp(generated.buffer)
        .resize(plan.planW, plan.planH, { fit: 'cover' })
        .jpeg(config.deliveryJpeg)
        .toBuffer()
    )
    const deliveryPath = path.join(
      dir,
      `3-livraison-${plan.planW}x${plan.planH}-${stamp}.jpg`
    )
    await fsp.writeFile(deliveryPath, delivery)
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
    }

    db.prepare(
      `UPDATE jobs SET status = 'done', result = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      JSON.stringify({
        kind: 'decor-autour',
        sizeLabel,
        imageSize,
        // Prompt COMPLET réellement envoyé ({PRODUIT}/{COLORIS} substitués) —
        // affiché par le banc (demande Mathias 07/08 : contrôle à l'œil).
        promptFinal: prompt,
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
