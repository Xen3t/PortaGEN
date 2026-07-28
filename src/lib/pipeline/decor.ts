import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import sharp from 'sharp'
import { config } from '@/lib/config'
import { getDb } from '@/lib/db'
import { getActivePrompt } from '@/lib/db/prompts'
import {
  generateText,
  generateImage,
  type ImageSize,
  type GeneratedImage,
} from '@/lib/genai/client'
import {
  whiteLineBands,
  horizontalEdgeProfile,
  bandPatternShift,
  corridorVegetationFraction,
} from '@/lib/images/analyze'
import { GABARIT_SET_DEFAULTS, type GabaritSetKey } from '@/lib/gabaritSets'
import { buildCanny, type CorridorInfo } from '@/lib/images/canny'
import { getMoteurReglages } from '@/lib/moteurs'
import { NATIVE_DIMS } from '@/lib/pipeline/nativeFormats'
import { cannyRefPath } from '@/lib/server/cannyRef'
import { extraireMaisonRef } from '@/lib/pipeline/maisonRef'
import { registerDecor } from '@/lib/db/decors'
import { autoTagDecor } from '@/lib/pipeline/autoTags'

/**
 * Addendum couloir (refonte 11/07/2026) : prompt versionné « decor-couloir »
 * (Admin → Prompts), placeholders remplis par le moteur — {WIDTH_M} en mètres
 * (asservi aux tailles actives) et {WIDTH_FRACTION} en % de la largeur d'image
 * (ancre visuelle que le modèle sait lire, contrairement aux mètres).
 * Couloir désactivé (null) : la contrainte d'ouverture part QUAND MÊME, sans la
 * phrase de largeur — et l'appelant pose un avertissement visible sur le job.
 */
export function buildCorridorAddendum(
  corridorWidthCm: number | null,
  corridor: CorridorInfo | null,
  imageWidth: number,
  db: Database.Database = getDb()
): { text: string; version: number; degraded: boolean } {
  const row = getActivePrompt('decor-couloir', db)
  let text = row.content.trim()
  const degraded = !corridorWidthCm || !corridor
  if (!degraded && corridorWidthCm && corridor) {
    const meters = (corridorWidthCm / 100).toFixed(1)
    const pct = Math.round(((corridor.x2Px - corridor.x1Px) / imageWidth) * 20) * 5
    text = text.replaceAll('{WIDTH_M}', meters).replaceAll('{WIDTH_FRACTION}', `${pct}%`)
  } else {
    text = text
      .replace(
        /about\s+\{WIDTH_M\}\s+m\s+wide\s+—\s+spanning\s+roughly\s+\{WIDTH_FRACTION\}\s+of\s+the\s+image\s+width\s+—\s+/,
        ''
      )
      .replaceAll('{WIDTH_M}', '')
      .replaceAll('{WIDTH_FRACTION}', '')
  }
  return { text: `\n\n${text}`, version: row.version, degraded }
}

/**
 * Insère les addenda AVANT le bloc LAYOUT du prompt (v4) : le verrou CANNY doit
 * rester la DERNIÈRE chose que lit le modèle. Sans marqueur (prompts v3 et
 * antérieurs), comportement historique : addenda ajoutés à la fin.
 */
export function insertAddenda(promptText: string, addenda: string): string {
  const idx = promptText.indexOf('LAYOUT GUIDE')
  if (idx < 0) return promptText + addenda
  return promptText.slice(0, idx).trimEnd() + addenda + '\n\n' + promptText.slice(idx)
}

/** Verdict du juge de vraisemblance architecturale (R3, 28/07/2026). */
export interface ArchitectureVerdict {
  roofBuildable: boolean
  volumeJunctions: boolean
  doorAtGround: boolean
  windowsAligned: boolean
  pass: boolean
  reasons: string
}

/**
 * R3 : juge décor automatique — un appel vision note la constructibilité de la
 * maison (toit, jonctions de volumes, porte, travées). Non bloquant : prompt
 * absent (serveur pas encore redémarré) ou réponse illisible → null, le
 * pipeline continue comme avant.
 */
async function judgeArchitecture(
  imageBuffer: Buffer,
  jobId: number,
  model: string | undefined,
  db: Database.Database
): Promise<{ verdict: ArchitectureVerdict; promptVersion: number } | null> {
  let promptRow
  try {
    promptRow = getActivePrompt('decor-juge', db)
  } catch {
    return null
  }
  try {
    // Le jugement porte sur la volumétrie : 1280 px suffisent, et l'appel
    // vision coûte d'autant moins de tokens.
    const small = await sharp(imageBuffer)
      .resize({ width: 1280, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
    const res = await generateText({
      system: promptRow.content,
      prompt: 'Inspect the attached image and answer with the JSON only.',
      images: [{ source: small, mimeType: 'image/jpeg' }],
      model,
      jobId,
    })
    const match = res.text.match(/\{[\s\S]*\}/)
    if (!match) return null
    const v = JSON.parse(match[0]) as Record<string, unknown>
    return {
      promptVersion: promptRow.version,
      verdict: {
        roofBuildable: !!v.roofBuildable,
        volumeJunctions: !!v.volumeJunctions,
        doorAtGround: !!v.doorAtGround,
        windowsAligned: !!v.windowsAligned,
        pass: !!v.pass,
        reasons: String(v.reasons ?? ''),
      },
    }
  } catch (err) {
    console.warn('[decor] juge architecture :', err)
    return null
  }
}

export interface DecorStepOptions {
  /** Moodboard JPG/PNG (une page : ambiances + pastilles + descriptif) */
  moodboardPath: string
  /**
   * Photo de maison de référence envoyée à Nano (R1). Non fourni : détection
   * automatique du fichier « <moodboard> - Maison.jpg » à côté du moodboard.
   */
  housePhotoPath?: string
  /** CANNY trottoir de référence (sera redimensionné au format natif) */
  cannyPath?: string
  imageSize?: ImageSize
  textModel?: string
  imageModel?: string
  /** Sous-dossier d'artefacts, ex. « veymont-fond1 » */
  slug?: string
  /** Job existant (créé par le runner) — sinon la fonction crée le sien (scripts CLI) */
  jobId?: number
  /** Largeur du corridor d'allée dessiné dans le CANNY, en cm (null = désactivé) */
  corridorWidthCm?: number | null
  /** Gamme de rangement dans la bibliothèque de décors (facultative) */
  gamme?: string | null
  /** Nom du décor dans la bibliothèque (défaut : moodboard + horodatage) */
  name?: string
  /** Suffixe ajouté au nom, ex. « · tirage 2 » (tirages multiples) */
  nameSuffix?: string
  /**
   * Essai du Lab moteur : le décor n'entre JAMAIS dans la bibliothèque (règle
   * Mathias 11/07/2026), pas de tags automatiques, et ses artefacts vivent sous
   * data/artifacts/lab/ — hors du dossier scanné par la réconciliation
   * disque → bibliothèque (syncDecorsFromDisk).
   */
  lab?: boolean
  /**
   * Moteur produit (13/07/2026) : ses réglages de corridor et SON référentiel de
   * tailles (un portillon appelle une allée piétonne de 100 cm, pas une allée de
   * voiture de 400 cm). Absent = battant. Le décor généré porte le type du moteur.
   * Depuis le 22/07/2026, accepte aussi le JEU « coulissant-xl » : décor à
   * l'échelle XL (corridor 600 cm calculé dans la scène élargie, CANNY XL
   * « caméra reculée ») — réglages et prompts restent ceux du coulissant.
   */
  moteur?: GabaritSetKey
}

export interface DecorStepResult {
  jobId: number
  promptText: string
  promptPath: string
  cannySentPath: string
  imagePath: string
  width: number
  height: number
  /** Décalage du bord de trottoir vs CANNY, en px à l'échelle de livraison (négatif = trop haut) */
  sidewalkOffsetPxDelivery: number | null
  /** Fraction de végétation mesurée dans le couloir d'allée (0..1, null si pas de couloir) */
  corridorGreenFraction: number | null
  nativeSizeRespected: boolean
  /** Photo de maison de référence effectivement envoyée (R1), null sinon */
  housePhotoPath: string | null
  /** Verdicts du juge architecture (R3), un par tirage effectué ; null si juge inactif */
  architectureVerdicts: ArchitectureVerdict[] | null
}

/** Plus grande taille active DU JEU (cm) — pilote la largeur du corridor. */
function widestActiveSize(db: ReturnType<typeof getDb>, jeu: GabaritSetKey): number {
  const row = db
    .prepare('SELECT MAX(width_cm) AS w FROM sizes WHERE active = 1 AND moteur = ?')
    .get(jeu) as { w: number | null }
  return row.w ?? 400
}

/**
 * Étape 1 du pipeline MES Contraintes : génération du décor « ouvert »
 * (sans pilier ni clôture), guidé par le moodboard (analyse LLM → prompt)
 * et par le CANNY trottoir (position + perspective), au format natif.
 */
export async function runDecorStep(opts: DecorStepOptions): Promise<DecorStepResult> {
  const imageSize = opts.imageSize ?? '4K' // 4K par défaut (décision Mathias 13/07/2026)
  const native = NATIVE_DIMS[imageSize]
  // Jeu de gabarits du décor (22/07/2026) : « coulissant-xl » a ses propres
  // réglages Canny (section « Canny XL »), corridor, image Canny et scène.
  const jeu: GabaritSetKey = opts.moteur ?? 'battant'
  // Canny du JEU : image personnalisée déposée dans l'admin, sinon celle d'origine.
  const cannyPath = opts.cannyPath ?? cannyRefPath(jeu)
  const slug = opts.slug ?? 'decor'

  const db = getDb()
  let jobId = opts.jobId
  if (jobId === undefined) {
    const job = db
      .prepare(`INSERT INTO jobs (type, status, payload) VALUES ('decor', 'running', ?)`)
      .run(JSON.stringify({ moodboardPath: opts.moodboardPath, imageSize, slug }))
    jobId = Number(job.lastInsertRowid)
  }

  try {
    // 1. Analyse du moodboard par le LLM directeur artistique (prompt système versionné),
    //    avec GARDE-FOU VERBATIM (refonte 11/07/2026) : l'en-tête de format, le bloc
    //    caméra et la clause d'ouverture portent la géométrie et l'ouverture de la
    //    scène — s'ils manquent, un retry, puis erreur explicite du job. Les marqueurs
    //    choisis existent dans les prompts v3 ET v4 (retour arrière sans casse).
    // Prompt du JEU (22/07/2026) : le Canny XL seul ne suffit pas — Nano suit le
    // TEXTE pour le cadrage. Le jeu XL a donc son analyse moodboard adaptée
    // (caméra reculée, allée 6 m, trottoir remonté), éditable dans l'Admin.
    const promptRow = getActivePrompt(
      jeu === 'coulissant-xl' ? 'coulissant-xl-moodboard-llm' : 'moodboard-llm'
    )
    const systemPrompt = promptRow.content
    const REQUIRED_VERBATIM = ['Output format:', 'rontal symmetrical view', 'no pillars', 'no gate']
    let analysisText = ''
    for (let attempt = 1; ; attempt++) {
      const analysis = await generateText({
        system: systemPrompt,
        prompt:
          'Analyze the attached moodboard page and produce the final prompt, following your instructions exactly.',
        images: [{ source: opts.moodboardPath }],
        model: opts.textModel,
        jobId,
      })
      analysisText = analysis.text
      if (REQUIRED_VERBATIM.every((m) => analysisText.includes(m))) break
      if (attempt >= 2) {
        throw new Error(
          'Prompt décor invalide : le directeur artistique n’a pas recopié les clauses ' +
            'verrouillées (en-tête de format, bloc caméra, clause d’ouverture) après 2 tentatives'
        )
      }
    }
    // Le prompt système cite le format 2000×1330 : on substitue le format natif
    // de travail (la livraison 2000×1330 est un redimensionnement final, hors génération).
    let promptText = analysisText
      .replaceAll('2000×1330', `${native.width}×${native.height}`)
      .replaceAll('2000x1330', `${native.width}x${native.height}`)
      .trim()

    // 2. CANNY au format natif (règle : entrée = taille exacte de sortie du modèle),
    //    construit AVANT l'assemblage du prompt : la zone du couloir fournit l'ancre
    //    visuelle (« % de la largeur d'image ») de l'addendum couloir.
    //    Corridor asservi à la géométrie (demande Mathias 08/07) : sa largeur suit
    //    automatiquement la plus grande ouverture du référentiel des tailles actives.
    //    Largeur : appel explicite > réglage moteur (Admin → Réglages par moteur :
    //    'manuel' = largeur imposée en cm, 'auto' = plus grande taille active).
    // Réglages Canny DU JEU (22/07/2026) : le jeu XL a son propre corridor
    // (section « Canny XL » de la fiche TERMINUS) — auto = plus grande taille
    // active du jeu (600 en XL), manuel = largeur imposée dans l'admin.
    const moteur = getMoteurReglages(jeu)
    const corridorWidthCm =
      opts.corridorWidthCm === null
        ? null
        : (opts.corridorWidthCm ??
          (moteur.corridor === 'manuel' ? moteur.corridorWidthCm : widestActiveSize(db, jeu)))
    const { image: cannyNative, corridor } = await buildCanny({
      width: native.width,
      height: native.height,
      basePath: cannyPath,
      corridorWidthCm,
      // Géométrie du corridor calculée dans la scène DU JEU : la scène élargie
      // XL (~722 cm) contient une allée de 6 m, la scène standard non.
      params: GABARIT_SET_DEFAULTS[jeu],
    })

    // 3. Assemblage final : addendum couloir (prompt versionné « decor-couloir ») +
    //    vraisemblance architecturale (« decor-architecture »), insérés AVANT le bloc
    //    LAYOUT pour que le verrou CANNY reste la dernière chose que lit le modèle.
    const couloir = buildCorridorAddendum(corridorWidthCm, corridor, native.width, db)
    const corridorWarning = couloir.degraded
      ? 'Décor généré SANS contrainte de largeur de couloir (couloir désactivé)'
      : null
    const archiRow = getActivePrompt('decor-architecture')
    // R1 (28/07/2026) : photo de maison de référence — bloc « decor-maison »
    // ajouté au prompt ET photo jointe en 2e image de la génération. Fichier
    // « <moodboard> - Maison.jpg » s'il existe, sinon extraction automatique
    // depuis la page (vision → découpe, mise en cache sous ce même nom).
    // Échec ou prompt absent : photo ignorée, comportement historique.
    const housePhotoPath =
      opts.housePhotoPath ?? (await extraireMaisonRef(opts.moodboardPath, jobId, opts.textModel, db))
    let maisonRow: ReturnType<typeof getActivePrompt> | null = null
    if (housePhotoPath) {
      try {
        maisonRow = getActivePrompt('decor-maison', db)
      } catch {
        console.warn('[decor] prompt decor-maison absent — photo de maison ignorée')
      }
    }
    // Ordre des addenda (28/07/2026) : architecture puis maison, et le COULOIR
    // EN DERNIER — la photo de maison tirait l'allée vers sa largeur « réelle »
    // (essais VEYMONT 38 % / ANTELAO 52 % de végétation couloir) ; la contrainte
    // d'ouverture doit rester la dernière consigne avant le verrou CANNY.
    const addenda =
      (archiRow.content.trim() ? `\n\n${archiRow.content.trim()}` : '') +
      (maisonRow ? `\n\n${maisonRow.content.trim()}` : '') +
      couloir.text
    promptText = insertAddenda(promptText, addenda)

    // Essais Lab : artefacts sous lab/ — HORS du dossier decor/ scanné par la
    // réconciliation disque → bibliothèque (le fichier ne doit jamais y entrer).
    const relDir = opts.lab ? path.join('lab', 'decor', slug) : path.join('decor', slug)
    const artifactDir = path.join(config.artifactsDir, relDir)
    fs.mkdirSync(artifactDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const promptPath = path.join(artifactDir, `prompt-${stamp}.txt`)
    fs.writeFileSync(promptPath, promptText, 'utf8')
    const cannySentPath = path.join(artifactDir, `canny-${native.width}x${native.height}.png`)
    fs.writeFileSync(cannySentPath, cannyNative)

    // 4. Génération du décor — avec juge architecture (R3, 28/07/2026) : après
    //    chaque tirage, un appel vision vérifie la constructibilité de la
    //    maison ; verdict négatif → UN re-tirage automatique, puis on garde le
    //    dernier tirage quoi qu'il arrive (le verdict reste visible sur le job).
    const refImages = [
      { source: cannyNative, mimeType: 'image/png' } as const,
      ...(maisonRow && housePhotoPath ? [{ source: housePhotoPath }] : []),
    ]
    let img: GeneratedImage | null = null
    const architectureVerdicts: ArchitectureVerdict[] = []
    let jugePromptVersion: number | null = null
    for (let tirage = 1; tirage <= 2; tirage++) {
      img = await generateImage({
        prompt: promptText,
        images: refImages,
        aspectRatio: '3:2',
        imageSize,
        model: opts.imageModel,
        jobId,
        artifactName: `decor-${imageSize}`,
        artifactDir: relDir,
      })
      const juge = await judgeArchitecture(img.buffer, jobId, opts.textModel, db)
      if (!juge) break // juge inactif ou réponse illisible : non bloquant
      jugePromptVersion = juge.promptVersion
      architectureVerdicts.push(juge.verdict)
      if (juge.verdict.pass) break
    }
    if (!img) throw new Error('Génération du décor : aucun tirage produit')

    // 5. Contrôle qualité dimensionnel : position du trottoir vs CANNY.
    //    Le gabarit de bandes vient du CANNY original (fichier de référence).
    //    Fenêtre XL ±15 % (24/07/2026) : les décors XL dérivent bien au-delà des
    //    ±5 % standards (jobs #153/#155 : +10,5 % / +4,4 %) — à ±5 % la mesure se
    //    calait sur les joints de l'allée et affichait un faux « +16 px ». Le
    //    chiffre est informatif (jugement des essais), il ne place rien.
    const bands = (await whiteLineBands(cannyPath)).filter((b) => b.yNorm > 0.5)
    let offsetPxDelivery: number | null = null
    if (bands.length > 0) {
      const profile = await horizontalEdgeProfile(img.buffer)
      const match = bandPatternShift(
        profile,
        bands.map((b) => b.yNorm),
        jeu === 'coulissant-xl' ? 0.15 : undefined
      )
      if (match) {
        offsetPxDelivery = Math.round(match.shiftNorm * config.delivery.height)
      }
    }

    // 6. Contrôle qualité du couloir : de l'herbe entre les futurs piliers = décor à
    //    régénérer (détection automatique, dominante verte dans la zone du couloir).
    //    (La détection de « piquets » a été retirée le 11/07/2026 — décision Mathias :
    //    elle datait des traits de guidage du CANNY, supprimés le 09/07.)
    let corridorGreenFraction: number | null = null
    if (corridor) {
      corridorGreenFraction = await corridorVegetationFraction(img.buffer, corridor)
    }

    const nativeSizeRespected = img.width === native.width && img.height === native.height
    const result: DecorStepResult = {
      jobId,
      promptText,
      promptPath,
      cannySentPath,
      imagePath: img.artifactPath,
      width: img.width,
      height: img.height,
      sidewalkOffsetPxDelivery: offsetPxDelivery,
      corridorGreenFraction,
      nativeSizeRespected,
      housePhotoPath: maisonRow && housePhotoPath ? housePhotoPath : null,
      architectureVerdicts: architectureVerdicts.length ? architectureVerdicts : null,
    }

    // 7. Bibliothèque de décors : le décor naît « À valider » (circuit de statuts).
    //    Référencé AVANT la clôture du job pour que l'atelier de création puisse
    //    l'afficher dès la fin (decorId dans le result). Non bloquant.
    //    JAMAIS pour un essai Lab (règle Mathias 11/07/2026).
    let decorId: number | null = null
    if (!opts.lab) try {
      const mbName = path
        .basename(opts.moodboardPath)
        .replace(/\.(jpg|jpeg|png)$/i, '')
      const now = new Date()
      const stamp = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      decorId = registerDecor(
        {
          filePath: img.artifactPath,
          name: (opts.name?.trim() || `${mbName} · ${stamp}`) + (opts.nameSuffix ?? ''),
          slug,
          gamme: opts.gamme ?? null,
          // Le décor porte le TYPE DU JEU : un décor XL n'est jamais proposé aux
          // tailles standards, et inversement (décision Mathias 22/07/2026).
          type: jeu,
          status: 'a_valider',
          imageSize,
          width: img.width,
          height: img.height,
          moodboardPath: opts.moodboardPath,
          jobId,
        },
        db
      )
    } catch (err) {
      console.warn('[decor] référencement bibliothèque :', err)
    }

    db.prepare(
      `UPDATE jobs SET status = 'done', result = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      JSON.stringify({
        kind: 'decor',
        lab: opts.lab || undefined,
        decorId,
        imagePath: path.relative(config.rootDir, img.artifactPath),
        cannySentPath: path.relative(config.rootDir, cannySentPath),
        promptPath: path.relative(config.rootDir, promptPath),
        promptVersion: promptRow.version,
        architecturePromptVersion: archiRow.version,
        corridorPromptVersion: couloir.version,
        maisonReference:
          maisonRow && housePhotoPath ? path.relative(config.rootDir, housePhotoPath) : undefined,
        maisonPromptVersion: maisonRow?.version,
        architectureJudge: architectureVerdicts.length
          ? {
              promptVersion: jugePromptVersion,
              verdicts: architectureVerdicts,
              retirage: architectureVerdicts.length > 1,
              pass: architectureVerdicts[architectureVerdicts.length - 1].pass,
            }
          : undefined,
        corridorWarning: corridorWarning ?? undefined,
        corridorWidthCm,
        corridor,
        imageSize,
        width: img.width,
        height: img.height,
        sidewalkOffsetPxDelivery: offsetPxDelivery,
        corridorGreenFraction:
          corridorGreenFraction === null ? null : Number(corridorGreenFraction.toFixed(4)),
        nativeSizeRespected,
      }),
      jobId
    )

    // 8. Tags automatiques par LLM (croisés avec le vocabulaire existant) —
    //    après la clôture du job : un échec ici ne condamne rien.
    if (decorId !== null) {
      try {
        await autoTagDecor(decorId, img.buffer, img.mimeType, jobId, db)
      } catch (err) {
        console.warn('[decor] tags automatiques :', err)
      }
    }

    return result
  } catch (err) {
    db.prepare(
      `UPDATE jobs SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(err instanceof Error ? err.message : String(err), jobId)
    throw err
  }
}
