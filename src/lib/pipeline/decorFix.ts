import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/lib/config'
import { getDb } from '@/lib/db'
import { getActivePrompt } from '@/lib/db/prompts'
import { generateImage, type ImageSize } from '@/lib/genai/client'
import { addDecorVersion, getDecor } from '@/lib/db/decors'
import { NATIVE_DIMS } from '@/lib/pipeline/nativeFormats'

export interface DecorFixOptions {
  decorId: number
  /** Consigne de correction en français, écrite par l'opérateur */
  instruction: string
  jobId?: number
}

export interface DecorFixResult {
  jobId: number
  decorId: number
  version: number
  imagePath: string
  width: number
  height: number
  nativeSizeRespected: boolean
}

/**
 * Prompt correctif sur un décor existant : l'image courante du décor est
 * envoyée à Nano Banana avec la consigne de l'opérateur, encadrée par le
 * prompt système versionné « decor-correctif » (ne changer QUE ce qui est
 * demandé, trottoir et perspective intouchables, conformité GMC).
 * Le résultat devient une NOUVELLE VERSION courante du décor (l'historique
 * est conservé, retour arrière possible), repassée « À valider ».
 */
export async function runDecorFixStep(opts: DecorFixOptions): Promise<DecorFixResult> {
  const db = getDb()
  const decor = getDecor(opts.decorId, db)
  if (!decor) throw new Error(`Décor introuvable : #${opts.decorId}`)
  const instruction = opts.instruction.trim()
  if (!instruction) throw new Error('Consigne de correction vide')

  let jobId = opts.jobId
  if (jobId === undefined) {
    const job = db
      .prepare(`INSERT INTO jobs (type, status, payload) VALUES ('decor-fix', 'running', ?)`)
      .run(JSON.stringify({ decorId: opts.decorId, instruction }))
    jobId = Number(job.lastInsertRowid)
  }

  try {
    const sourcePath = path.resolve(config.rootDir, decor.file_path)
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Image du décor introuvable sur le disque : ${decor.file_path}`)
    }

    const promptRow = getActivePrompt('decor-correctif', db)
    const promptText = `${promptRow.content.trimEnd()}\n${instruction}`

    const imageSize = (['1K', '2K', '4K'].includes(decor.image_size ?? '')
      ? decor.image_size
      : '2K') as ImageSize
    const native = NATIVE_DIMS[imageSize]

    const img = await generateImage({
      prompt: promptText,
      images: [{ source: sourcePath }],
      aspectRatio: '3:2',
      imageSize,
      jobId,
      artifactName: `retouche-${imageSize}`,
      artifactDir: path.join('decor', decor.slug),
    })

    const version = addDecorVersion(
      decor.id,
      {
        filePath: img.artifactPath,
        kind: 'correction',
        instruction,
        jobId,
        width: img.width,
        height: img.height,
      },
      db
    )

    const nativeSizeRespected = img.width === native.width && img.height === native.height
    const result: DecorFixResult = {
      jobId,
      decorId: decor.id,
      version: version.version,
      imagePath: img.artifactPath,
      width: img.width,
      height: img.height,
      nativeSizeRespected,
    }

    db.prepare(
      `UPDATE jobs SET status = 'done', result = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      JSON.stringify({
        kind: 'decor-fix',
        decorId: decor.id,
        decorName: decor.name,
        version: version.version,
        instruction,
        promptVersion: promptRow.version,
        imagePath: path.relative(config.rootDir, img.artifactPath),
        width: img.width,
        height: img.height,
        nativeSizeRespected,
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
