import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { config } from '@/lib/config'
import { getDb } from '@/lib/db'
import { getActivePrompt } from '@/lib/db/prompts'
import { generateText, generateImage, type ImageSize } from '@/lib/genai/client'
import {
  whiteLineBands,
  horizontalEdgeProfile,
  bandPatternShift,
  corridorVegetationFraction,
} from '@/lib/images/analyze'
import { buildCanny, type CorridorInfo } from '@/lib/images/canny'
import { getMoteurReglages, type MoteurKey } from '@/lib/moteurs'
import { NATIVE_DIMS } from '@/lib/pipeline/nativeFormats'
import { cannyRefPath } from '@/lib/server/cannyRef'
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

export interface DecorStepOptions {
  /** Moodboard JPG/PNG (une page : ambiances + pastilles + descriptif) */
  moodboardPath: string
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
   */
  moteur?: MoteurKey
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
}

/** Plus grande taille active DU MOTEUR (cm) — pilote la largeur du corridor. */
function widestActiveSize(db: ReturnType<typeof getDb>, moteur: MoteurKey): number {
  const row = db
    .prepare('SELECT MAX(width_cm) AS w FROM sizes WHERE active = 1 AND moteur = ?')
    .get(moteur) as { w: number | null }
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
  const moteurKey: MoteurKey = opts.moteur ?? 'battant'
  // CANNY du MOTEUR : image personnalisée déposée dans l'admin, sinon trottoir d'origine.
  const cannyPath = opts.cannyPath ?? cannyRefPath(moteurKey)
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
    const promptRow = getActivePrompt('moodboard-llm')
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
    const moteur = getMoteurReglages(moteurKey)
    const corridorWidthCm =
      opts.corridorWidthCm === null
        ? null
        : (opts.corridorWidthCm ??
          (moteur.corridor === 'manuel' ? moteur.corridorWidthCm : widestActiveSize(db, moteurKey)))
    const { image: cannyNative, corridor } = await buildCanny({
      width: native.width,
      height: native.height,
      basePath: cannyPath,
      corridorWidthCm,
    })

    // 3. Assemblage final : addendum couloir (prompt versionné « decor-couloir ») +
    //    vraisemblance architecturale (« decor-architecture »), insérés AVANT le bloc
    //    LAYOUT pour que le verrou CANNY reste la dernière chose que lit le modèle.
    const couloir = buildCorridorAddendum(corridorWidthCm, corridor, native.width, db)
    const corridorWarning = couloir.degraded
      ? 'Décor généré SANS contrainte de largeur de couloir (couloir désactivé)'
      : null
    const archiRow = getActivePrompt('decor-architecture')
    const addenda =
      couloir.text + (archiRow.content.trim() ? `\n\n${archiRow.content.trim()}` : '')
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

    // 4. Génération du décor.
    const img = await generateImage({
      prompt: promptText,
      images: [{ source: cannyNative, mimeType: 'image/png' }],
      aspectRatio: '3:2',
      imageSize,
      model: opts.imageModel,
      jobId,
      artifactName: `decor-${imageSize}`,
      artifactDir: relDir,
    })

    // 5. Contrôle qualité dimensionnel : position du trottoir vs CANNY.
    //    Le gabarit de bandes vient du CANNY original (fichier de référence).
    const bands = (await whiteLineBands(cannyPath)).filter((b) => b.yNorm > 0.5)
    let offsetPxDelivery: number | null = null
    if (bands.length > 0) {
      const profile = await horizontalEdgeProfile(img.buffer)
      const match = bandPatternShift(
        profile,
        bands.map((b) => b.yNorm)
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
          type: moteurKey,
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
