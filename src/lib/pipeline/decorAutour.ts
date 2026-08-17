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
import { appliquerRalifyPostMes } from '@/lib/images/ralifyPostMes'
import { resolveRalifyDecision } from '@/lib/ralify'
import { getMesDecor, getMesDecorDefaut } from '@/lib/db/mesDecors'
import { MOTEURS_DA, getMoteurDaReglages, moteurDaPromptName, type MoteurDaKey } from '@/lib/moteursDa'
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
  /**
   * DÉCOR choisi (bibliothèque mes_decors, 08/08) — son texte remplit {DECOR},
   * ses images de référence sont jointes à l'appel Nano. Absent = décor par
   * défaut de la bibliothèque.
   */
  decorId?: number
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

    // Décision RALify : cible + moments d'application PAR RÈGLE (17/08 —
    // chaque RAL du tableau porte son « avant / après »).
    const ralifyDecision = resolveRalifyDecision(
      moteur.ralify,
      `${opts.productName ?? ''} ${path.basename(opts.productPath)}`,
      opts.coloris
    )
    const ralifyCible = ralifyDecision.cible

    // Phases 1-2 sous sas (07/08) : avec 20 jobs en vol, RALify + pose sharp
    // simultanés saturaient CPU/RAM du processus web (UI figée). Le sas les fait
    // passer 3 par 3 ; l'attente Nano, elle, reste libre.
    const { plan, planPath, produitBuffer } = await sasCalculImage(async () => {
      // 1. RALify (conservé — décision Mathias 05/08) : la teinte de la matière est
      //    ramenée au RAL cible du moteur AVANT la pose. null = ne pas toucher.
      //    Depuis le 17/08 le moment est réglable, RAL par RAL (application avant/après).
      let produitPret: Buffer | string = opts.productPath
      if (ralifyCible && ralifyDecision.application.avant) {
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
    // {AJOURE} (17/08, étendu aux 3 moteurs le soir même) : le paragraphe
    // « openwork » historique ne part que si le produit est réellement ajouré.
    // Sur un produit PLEIN de grande hauteur (≥ 50 % de la hauteur d'image), il
    // donnait à Nano une sortie légitime pour percer le panneau et montrer le
    // décor à travers — sessions banc-msxgayzw (battants 7/7) et jobs 92-96
    // (coulissants). Détection sur la ligne STRUCTURE de la description vision
    // (vocabulaire garanti : solid / openwork / mixed, cf.
    // PROMPT_DESCRIPTION_DEFAUT). « mixed » décrit ses zones pleines avec le mot
    // « solid », d'où les deux exclusions. Sans description : paragraphe
    // historique (non-régression). Prompt sans {AJOURE} : rien à faire.
    // Textes PAR MOTEUR (jamais cloner-renommer) : le battant a deux vantaux et
    // une allée carrossable, le portillon UN vantail et une allée de jardin, le
    // coulissant UN panneau continu.
    if (prompt.includes('{AJOURE}')) {
      const AJOURE_OUVERT: Record<MoteurDaKey, string> = {
        janus:
          'If the gate is an OPENWORK design (bars or slats with gaps between them), the gaps are SEE-THROUGH openings: paint the environment BEHIND the gate through every gap — driveway, garden, the house further back. NEVER fill the gaps with gate material, panels or solid colour: the exact silhouette of bars AND openings from the input is preserved, opening for opening.',
        forculus:
          'If the gate is an OPENWORK design (bars or slats with gaps between them), the gaps are SEE-THROUGH openings: paint the environment BEHIND the gate through every gap — garden path, garden, the house further back. NEVER fill the gaps with gate material, panels or solid colour: the exact silhouette of bars AND openings from the input is preserved, opening for opening.',
        terminus:
          'If the gate has an OPENWORK section (bars or slats with gaps between them), the gaps are SEE-THROUGH openings: paint the environment BEHIND the gate through every gap — driveway, garden, the house further back. NEVER fill the gaps with gate material, panels or solid colour: the exact silhouette of bars AND openings from the input is preserved, opening for opening.',
      }
      const AJOURE_PLEIN: Record<MoteurDaKey, string> = {
        janus:
          'The gate is a SOLID opaque panel: NOTHING behind it is ever visible through it. The grooves between slats are shallow surface joints on a closed panel, NOT gaps — NEVER open them, NEVER paint sky, garden, driveway or house through ANY part of the gate, and NEVER lower, shorten or cut the gate to reveal what stands behind: whatever the scenery places behind the gate stays HIDDEN behind it.',
        forculus:
          'The gate is a SOLID opaque leaf: NOTHING behind it is ever visible through it. The grooves between slats are shallow surface joints on a closed leaf, NOT gaps — NEVER open them, NEVER paint sky, garden, path or house through ANY part of the gate, and NEVER lower, shorten or cut the gate to reveal what stands behind: whatever the scenery places behind the gate stays HIDDEN behind it.',
        terminus:
          'The gate is ONE SOLID opaque panel: NOTHING behind it is ever visible through it. The grooves between slats are shallow surface joints on a closed panel, NOT gaps — NEVER open them, NEVER paint sky, garden, driveway or house through ANY part of the panel, and NEVER lower, shorten or cut the panel to reveal what stands behind: whatever the scenery places behind the gate stays HIDDEN behind it.',
      }
      const structureLigne = productDesc?.match(/^STRUCTURE:(.*)$/im)?.[1]?.toLowerCase() ?? ''
      const produitPlein =
        structureLigne.includes('solid') &&
        !structureLigne.includes('openwork') &&
        !structureLigne.includes('mixed')
      prompt = prompt.replaceAll(
        '{AJOURE}',
        produitPlein ? AJOURE_PLEIN[moteurKey] : AJOURE_OUVERT[moteurKey]
      )
    }
    // {DECOR} (08/08) : l'ambiance vient de la bibliothèque de décors — celui
    // demandé par le lancement, sinon le décor par défaut. La règle « maison
    // toujours vue de face » vit dans le texte FIGÉ du prompt, pas ici. Prompt
    // antérieur sans {DECOR} (version active pas encore migrée) : son paragraphe
    // ENVIRONMENT en dur reste tel quel, on n'ajoute rien (non-régression).
    const decor = (opts.decorId !== undefined ? getMesDecor(opts.decorId) : undefined) ?? getMesDecorDefaut()
    if (prompt.includes('{DECOR}')) {
      // Version IA d'abord (réécriture LLM obligatoire, 08/08 soir) — repli sur
      // le texte humain si la réécriture a échoué à l'enregistrement.
      prompt = prompt.replaceAll(
        '{DECOR}',
        decor?.promptIa?.trim() ||
          decor?.prompt.trim() ||
          'A typical French residential suburb: a paved driveway and a tidy garden behind the entrance, a classic French detached house (pavillon) in the background. Wide clear blue sky, bright sunny daylight. Realistic materials, fine detail, photorealistic.'
      )
    }
    // COULISSANT (rodage 07/08, après échec des leviers texte sur la lecture
    // « battant ») : le PNG produit est joint en 2ᵉ image de RÉFÉRENCE — le
    // prompt terminus v5 désigne image 1 = plan à éditer, image 2 = le produit
    // exact (UN panneau). Approche « photo jointe » validée 5/5 sur les maisons
    // plausibles. Battant/portillon (recettes validées) : une seule image.
    const images: { source: Buffer; mimeType: string }[] = [
      { source: plan.buffer, mimeType: 'image/png' },
    ]
    if (moteurKey === 'terminus') images.push({ source: produitBuffer, mimeType: 'image/png' })
    // Images de RÉFÉRENCE du décor (08/08) : jointes après le plan (et le produit
    // pour le coulissant) — le prompt figé les cadre comme inspiration d'ambiance,
    // jamais comme structure à copier. Seulement si le prompt actif connaît le
    // système de décors ({DECOR}) : un vieux prompt ne saurait pas les cadrer.
    if (promptRow.content.includes('{DECOR}') && decor) {
      const MIME_REF: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
      }
      for (const rel of decor.images) {
        const full = path.resolve(config.rootDir, rel)
        const mime = MIME_REF[path.extname(full).toLowerCase()]
        if (!mime) continue
        try {
          images.push({ source: await fsp.readFile(full), mimeType: mime })
        } catch {
          // image de référence disparue : la génération part sans elle
        }
      }
    }
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
    let deliveryPath = path.join(
      dir,
      `3-livraison-${plan.planW}x${plan.planH}-${stamp}.jpg`
    )
    await fsp.writeFile(deliveryPath, delivery)
    // Le réencodage sharp repart de zéro côté métadonnées → on re-marque le livrable.
    await marquerImageIa(deliveryPath)

    // 4 bis. RALify APRÈS génération (validé Mathias 17/08, gamme EIGER) :
    // harmonisation de l'alu vers le RAL cible SUR la livraison — Nano dérive la
    // teinte à chaque génération, cette passe réaligne la gamme. Jamais bloquant
    // (échec détection = la livraison 3- reste le livrable). L'artefact 3- est
    // conservé tel quel pour le contrôle avant/après.
    let ralifyApres: {
      avantHex: string
      apresHex: string
      boxPct: [number, number, number, number]
      model: string
    } | null = null
    if (ralifyCible && ralifyDecision.application.apres) {
      // Phase affichée par le banc (demande Mathias 17/08 : « Harmonisation
      // RAL » à la place de « Génération » pendant la passe finale). Payload
      // seulement — l'échec de cette écriture ne doit jamais bloquer le job.
      try {
        const row = db.prepare('SELECT payload FROM jobs WHERE id = ?').get(jobId) as
          | { payload: string | null }
          | undefined
        const p = row?.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : {}
        p.phase = 'harmonisation-ral'
        db.prepare(`UPDATE jobs SET payload = ?, updated_at = datetime('now') WHERE id = ?`).run(
          JSON.stringify(p),
          jobId
        )
      } catch {
        // payload illisible : l'affichage de phase est décoratif, on continue
      }
      const def = MOTEURS_DA.find((m) => m.key === moteurKey)!
      const produitEn =
        def.lettre === 'C'
          ? 'the aluminum sliding gate'
          : def.lettre === 'P'
            ? 'the aluminum pedestrian gate'
            : 'the aluminum double swing gate'
      const post = await appliquerRalifyPostMes({
        scene: delivery,
        cibleHex: ralifyCible,
        intensitePct: moteur.ralify.intensite,
        produitEn,
        jobId,
      })
      if (post) {
        const postJpeg = await sasCalculImage(() =>
          sharp(post.image).jpeg(config.deliveryJpeg).toBuffer()
        )
        const postPath = path.join(
          dir,
          `4-livraison-ralify-${plan.planW}x${plan.planH}-${stamp}.jpg`
        )
        await fsp.writeFile(postPath, postJpeg)
        await marquerImageIa(postPath)
        deliveryPath = postPath
        ralifyApres = {
          avantHex: post.avantHex,
          apresHex: post.apresHex,
          boxPct: post.boxPct,
          model: post.model,
        }
      }
    }

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
        // Harmonisation post-MES appliquée (17/08) — traçabilité avant/après.
        ...(ralifyApres ? { ralifyApres } : {}),
        alphaReparePx: plan.alphaReparePx,
        // Décor appliqué (08/08) — traçabilité dans la vue en grand / versions.
        ...(decor ? { decorId: decor.id, decorName: decor.name } : {}),
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
