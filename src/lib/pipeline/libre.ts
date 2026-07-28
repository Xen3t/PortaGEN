import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { config } from '@/lib/config'
import { getDb, updateJob } from '@/lib/db'
import { getActivePrompt } from '@/lib/db/prompts'
import { generateImage, generateText, type AspectRatio, type ImageSize } from '@/lib/genai/client'
import { marquerImageIa } from '@/lib/images/marquage'

/**
 * MES Libres (chantier 28/07/2026, maquette mes-libre-v11 validée) : « quasi que
 * du prompt » — pas de CANNY, pas d'aplats, pas de gabarit. Le produit part en
 * images de référence, la scène est décrite par le formulaire de l'écran, et le
 * gabarit de prompt versionné « libre-mes » (Admin → Prompts) assemble le tout,
 * HARD LOCK PRODUCT en dernière ligne.
 *
 * Un job = UNE variante. Le lot de N variantes partage un batch_id (suivi via
 * /api/gamme/<batch>, comme les autres générations).
 */

export interface LibreStepOptions {
  /** Images produit (PNG détourés idéalement), chemins absolus sous data/ */
  productPaths: string[]
  /** Type / catégorie en texte libre — « Portail acier avec chapeau de gendarme » */
  productLabel: string
  /** Description photographique de la scène (la matière du prompt) */
  sceneText: string
  /** Saison + météo + lumière, en clair */
  conditionsText: string
  /** Angle, cadrage, hauteur, composition, netteté, en clair */
  cameraText: string
  /** Petits plus activés (vide = ligne DETAILS retirée du gabarit) */
  detailsText?: string
  aspectRatio: AspectRatio
  imageSize: ImageSize
  /** Modèle imposé (Nano Banana rapide) — absent = réglage Admin (Nano Banana Pro) */
  model?: string
  /** Sous-dossier d'artefacts sous libre/ */
  slug?: string
  /** Numéro de la variante dans le lot (1..N) */
  variante?: number
  jobId?: number
}

export interface LibreStepResult {
  jobId: number
  imagePath: string
  promptPath: string
  width: number
  height: number
}

export async function runLibreStep(opts: LibreStepOptions): Promise<LibreStepResult> {
  const db = getDb()
  let jobId = opts.jobId
  if (jobId === undefined) {
    const job = db
      .prepare(`INSERT INTO jobs (type, status, payload) VALUES ('libre', 'running', ?)`)
      .run(JSON.stringify({ productLabel: opts.productLabel, slug: opts.slug }))
    jobId = Number(job.lastInsertRowid)
  }

  try {
    // Chemins produit relatifs au projet depuis le 28/07 (reprise de session,
    // affichage via /api/artifacts) — les anciens payloads absolus passent aussi.
    const productAbs = opts.productPaths.map((p) =>
      path.isAbsolute(p) ? p : path.resolve(config.rootDir, p)
    )
    for (const p of productAbs) {
      if (!fs.existsSync(p)) throw new Error(`Image produit introuvable : ${path.basename(p)}`)
    }

    // Les éléments du brief (français, tels que saisis à l'écran).
    const elements =
      `PRODUIT — ${opts.productLabel.trim() || 'produit'}\n` +
      `SCÈNE — ${opts.sceneText.trim()}\n` +
      `CONDITIONS — ${opts.conditionsText.trim()}\n` +
      `CAMÉRA — ${opts.cameraText.trim()}` +
      (opts.detailsText?.trim() ? `\nDÉTAILS — ${opts.detailsText.trim()}` : '')

    // PROMPT SPECIALIST (28/07/2026, calqué sur le workflow Freepik de Mathias) :
    // le LLM écrit le brief photo FINAL en anglais depuis ces éléments — jamais
    // d'assemblage d'étiquettes. Garde-fou : le bloc HARD LOCK doit terminer le
    // prompt (retry, sinon il est rajouté verbatim). En cas d'échec du LLM, le
    // gabarit simple « libre-mes » sert de filet — la génération part quand même.
    const HARD_LOCK =
      'HARD LOCK PRODUCT: no change to design / shape / proportions / size / color / material / texture / branding / text / logo / labels — reproduce the product from the reference image(s) exactly.'
    let promptText = ''
    let promptVersion: number | null = null
    let specialistVersion: number | null = null
    let promptFallback = false
    try {
      const spec = getActivePrompt('libre-prompt-specialist')
      specialistVersion = spec.version
      for (let attempt = 1; attempt <= 2 && !promptText; attempt++) {
        const { text } = await generateText({ system: spec.content, prompt: elements, jobId })
        const t = text.trim()
        if (t.includes('HARD LOCK PRODUCT')) promptText = t
        else if (attempt === 2) promptText = `${t}\n\n${HARD_LOCK}`
      }
    } catch (err) {
      console.warn('[libre] Prompt Specialist indisponible, gabarit de secours :', err)
      promptFallback = true
      const promptRow = getActivePrompt('libre-mes')
      promptVersion = promptRow.version
      promptText = promptRow.content
        .replaceAll('{PRODUCT}', opts.productLabel.trim() || 'product')
        .replaceAll('{SCENE}', opts.sceneText.trim())
        .replaceAll('{CONDITIONS}', opts.conditionsText.trim())
        .replaceAll('{CAMERA}', opts.cameraText.trim())
      promptText = opts.detailsText?.trim()
        ? promptText.replaceAll('{DETAILS}', `DETAILS — ${opts.detailsText.trim()}`)
        : promptText.replace(/^\{DETAILS\}\r?\n?/m, '').replaceAll('{DETAILS}', '')
      promptText = promptText.replace(/\n{3,}/g, '\n\n').trim()
    }

    const slug = opts.slug ?? 'libre'
    const relDir = path.join('libre', slug)
    const artifactDir = path.join(config.artifactsDir, relDir)
    fs.mkdirSync(artifactDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const promptPath = path.join(artifactDir, `prompt-${stamp}.txt`)
    fs.writeFileSync(promptPath, `${elements}\n\n---\n\n${promptText}`, 'utf8')

    const img = await generateImage({
      prompt: promptText,
      images: productAbs.map((p) => ({ source: p })),
      aspectRatio: opts.aspectRatio,
      imageSize: opts.imageSize,
      model: opts.model,
      jobId,
      artifactName: `libre-${opts.imageSize}${opts.variante ? `-v${opts.variante}` : ''}`,
      artifactDir: relDir,
    })

    db.prepare(
      `UPDATE jobs SET status = 'done', result = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      JSON.stringify({
        kind: 'libre',
        imagePath: path.relative(config.rootDir, img.artifactPath),
        promptPath: path.relative(config.rootDir, promptPath),
        specialistVersion,
        promptVersion,
        promptFallback: promptFallback || undefined,
        aspectRatio: opts.aspectRatio,
        imageSize: opts.imageSize,
        variante: opts.variante,
        width: img.width,
        height: img.height,
      }),
      jobId
    )

    return {
      jobId,
      imagePath: img.artifactPath,
      promptPath,
      width: img.width,
      height: img.height,
    }
  } catch (err) {
    db.prepare(
      `UPDATE jobs SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(err instanceof Error ? err.message : String(err), jobId)
    throw err
  }
}

// ————————————————————————————————————————— Retouche par consigne (studio)

export interface LibreFixOptions {
  /** Image à retoucher (version affichée), chemin relatif au projet ou absolu. */
  sourcePath: string
  /** Consigne de l'utilisateur, en français. */
  instruction: string
  /** Images produit du lot — le HARD LOCK s'appuie dessus. */
  productPaths: string[]
  aspectRatio: AspectRatio
  imageSize: ImageSize
  model?: string
  slug?: string
  /** Job « libre » racine — la retouche devient une VERSION de cette MES. */
  rootJobId: number
  variante?: number
  jobId?: number
}

/**
 * Retouche ciblée d'une MES Libre (studio, 28/07/2026) : l'image existante +
 * la consigne + les références produit partent à Nano — prompt versionné
 * « libre-fix » (Admin → Prompts), HARD LOCK en dernière ligne. Le résultat est
 * une nouvelle VERSION de la MES racine (payload.rootJobId), même lot.
 */
export async function runLibreFixStep(opts: LibreFixOptions): Promise<{ imagePath: string }> {
  const db = getDb()
  const jobId = opts.jobId
  if (jobId) updateJob(jobId, { status: 'running' })
  try {
    const sourceAbs = path.isAbsolute(opts.sourcePath)
      ? opts.sourcePath
      : path.resolve(config.rootDir, opts.sourcePath)
    if (!fs.existsSync(sourceAbs)) throw new Error('Image à retoucher introuvable')
    const productAbs = opts.productPaths
      .map((p) => (path.isAbsolute(p) ? p : path.resolve(config.rootDir, p)))
      .filter((p) => fs.existsSync(p))

    const promptRow = getActivePrompt('libre-fix')
    const promptText = promptRow.content.replaceAll('{INSTRUCTION}', opts.instruction.trim())

    const slug = opts.slug ?? 'libre'
    const relDir = path.join('libre', slug)
    const img = await generateImage({
      prompt: promptText,
      images: [{ source: sourceAbs }, ...productAbs.map((p) => ({ source: p }))],
      aspectRatio: opts.aspectRatio,
      imageSize: opts.imageSize,
      model: opts.model,
      jobId,
      artifactName: `libre-fix${opts.variante ? `-v${opts.variante}` : ''}`,
      artifactDir: relDir,
    })

    if (jobId) {
      db.prepare(
        `UPDATE jobs SET status = 'done', result = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(
        JSON.stringify({
          kind: 'libre-fix',
          imagePath: path.relative(config.rootDir, img.artifactPath),
          sourcePath: path.relative(config.rootDir, sourceAbs),
          instruction: opts.instruction.trim().slice(0, 400),
          promptVersion: promptRow.version,
          rootJobId: opts.rootJobId,
          variante: opts.variante,
          aspectRatio: opts.aspectRatio,
          imageSize: opts.imageSize,
          width: img.width,
          height: img.height,
        }),
        jobId
      )
    }
    return { imagePath: img.artifactPath }
  } catch (err) {
    if (jobId) {
      const cur = getDb().prepare('SELECT status FROM jobs WHERE id = ?').get(jobId) as
        | { status: string }
        | undefined
      if (cur?.status === 'running') {
        updateJob(jobId, { status: 'error', error: err instanceof Error ? err.message : String(err) })
      }
    }
    throw err
  }
}

// ————————————————————————————————————————— Marketplace 2000×2000

const SQUARE = 2000

/** Filet de sécurité si le prompt versionné manque (base pas encore resemée). */
const EXTEND_FALLBACK = [
  'This is a professional exterior photograph of a product in its setting.',
  'UNCROP / OUTPAINT it into a 1:1 SQUARE by generating MORE of the same scene around it.',
  'Do NOT crop, zoom, stretch or modify the existing content; only ADD new area to reach a square.',
  'Photorealistic, seamless continuation. No borders, no text, no watermark, no people.',
].join(' ')

export interface LibreMpOptions {
  /** Chemin (relatif au projet ou absolu) de la MES Libre source. */
  sourcePath: string
  /** Job « libre » d'origine — pour rattacher la déclinaison à sa variante. */
  rootJobId?: number
  variante?: number
  slug?: string
  jobId?: number
}

/**
 * Déclinaison Marketplace d'une MES Libre : carré 2000×2000. Contrairement au
 * MP des moteurs Contrainte (zone produit connue via zoneFrac), la MES Libre a
 * un cadrage arbitraire — on ne recadre RIEN : image déjà carrée → simple
 * redimensionnement ; sinon Nano ÉTEND la scène en 1:1 (outpainting, prompt
 * générique versionné « libre-marketplace-extension », jamais celui d'un moteur).
 */
export async function runLibreMpStep(opts: LibreMpOptions): Promise<{ deliveryPath: string }> {
  const jobId = opts.jobId
  if (jobId) updateJob(jobId, { status: 'running' })
  try {
    const abs = path.isAbsolute(opts.sourcePath)
      ? opts.sourcePath
      : path.resolve(config.rootDir, opts.sourcePath)
    if (!fs.existsSync(abs)) throw new Error('MES Libre source introuvable')

    const meta = await sharp(abs).metadata()
    const w = meta.width ?? 0
    const h = meta.height ?? 0
    let square: Buffer
    let usedOutpaint = false
    if (w > 0 && h > 0 && Math.abs(w - h) <= 4) {
      // Déjà (quasi) carrée — aucun appel IA.
      square = await sharp(abs).resize(SQUARE, SQUARE, { fit: 'fill' }).jpeg(config.deliveryJpeg).toBuffer()
    } else {
      let prompt: string
      try {
        prompt = getActivePrompt('libre-marketplace-extension').content
      } catch {
        prompt = EXTEND_FALLBACK
      }
      const generated = await generateImage({
        prompt,
        images: [{ source: abs }],
        aspectRatio: '1:1',
        imageSize: '2K',
        jobId,
      })
      usedOutpaint = true
      square = await sharp(generated.buffer)
        .resize(SQUARE, SQUARE, { fit: 'fill' })
        .jpeg(config.deliveryJpeg)
        .toBuffer()
    }

    const slug = (opts.slug ?? 'libre').replace(/[^a-z0-9-]+/gi, '-').slice(0, 40).toLowerCase()
    const dir = path.join(config.artifactsDir, 'libre', slug)
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const deliveryAbs = path.join(dir, `mp-2000x2000${opts.variante ? `-v${opts.variante}` : ''}-${stamp}.jpg`)
    fs.writeFileSync(deliveryAbs, square)
    // Le réencodage sharp repart de zéro côté métadonnées → on re-marque le livrable.
    await marquerImageIa(deliveryAbs)
    const deliveryPath = path.relative(config.rootDir, deliveryAbs)

    if (jobId) {
      updateJob(jobId, {
        status: 'done',
        result: JSON.stringify({
          kind: 'libre-mp',
          sourcePath: path.relative(config.rootDir, abs),
          deliveryPath,
          rootJobId: opts.rootJobId,
          variante: opts.variante,
          usedOutpaint,
        }),
      })
    }
    return { deliveryPath }
  } catch (err) {
    if (jobId) {
      const cur = getDb().prepare('SELECT status FROM jobs WHERE id = ?').get(jobId) as
        | { status: string }
        | undefined
      if (cur?.status === 'running') {
        updateJob(jobId, { status: 'error', error: err instanceof Error ? err.message : String(err) })
      }
    }
    throw err
  }
}
