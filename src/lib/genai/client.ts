import { GoogleGenAI, type Part } from '@google/genai'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { config } from '@/lib/config'
import { logApiCall } from '@/lib/db'
import { getImageModel } from '@/lib/db/settings'
import { marquerImageIa } from '@/lib/images/marquage'

let ai: GoogleGenAI | null = null

function getAi(): GoogleGenAI {
  if (!ai) ai = new GoogleGenAI({ apiKey: config.geminiApiKey })
  return ai
}

export interface ImageInput {
  /** Chemin d'un fichier image OU buffer déjà chargé */
  source: string | Buffer
  mimeType?: string
}

export interface Usage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

function toPart(img: ImageInput): Part {
  const buffer = typeof img.source === 'string' ? fs.readFileSync(img.source) : img.source
  const mimeType =
    img.mimeType ??
    (typeof img.source === 'string' && img.source.toLowerCase().endsWith('.jpg')
      ? 'image/jpeg'
      : typeof img.source === 'string' && img.source.toLowerCase().endsWith('.jpeg')
        ? 'image/jpeg'
        : 'image/png')
  return { inlineData: { mimeType, data: buffer.toString('base64') } }
}

interface UsageMetadataLike {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
}

function extractUsage(meta: UsageMetadataLike | undefined): Usage {
  return {
    inputTokens: meta?.promptTokenCount,
    outputTokens: meta?.candidatesTokenCount,
    totalTokens: meta?.totalTokenCount,
  }
}

/**
 * Traduit l'erreur brute de l'API Gemini (anglais, souvent du JSON) en une
 * phrase claire pour l'écran. Le message d'origine reste intact dans le
 * journal des appels API (logApiCall) pour le diagnostic.
 */
function erreurGeminiLisible(err: unknown): string {
  const brut = err instanceof Error ? err.message : String(err)
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(brut)) {
    return 'Quota Gemini atteint — réessayez dans quelques minutes (429).'
  }
  if (/503|UNAVAILABLE|overloaded/i.test(brut)) {
    return 'Gemini est surchargé en ce moment — relancez dans quelques minutes (503).'
  }
  if (/500|502|504|INTERNAL/i.test(brut)) {
    return 'Erreur interne côté Gemini — relancez, ça passe en général au 2e essai (5xx).'
  }
  if (/401|403|API.?key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(brut)) {
    return 'Clé API Gemini invalide ou non autorisée — vérifiez la clé dans la configuration.'
  }
  if (/SAFETY|PROHIBITED_CONTENT|blocked/i.test(brut)) {
    return 'Génération bloquée par le filtre de contenu Gemini — relancez ou ajustez la demande.'
  }
  if (/fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network/i.test(brut)) {
    return 'Connexion à Gemini impossible — vérifiez l’accès internet, puis relancez.'
  }
  return brut
}

/** Retente sur erreurs transitoires (429/5xx), jamais sur les erreurs de requête. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      const transient =
        /429|500|502|503|504|RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network/i.test(
          msg
        )
      if (!transient || i === attempts - 1) throw err
      // Les pics de charge Nano Banana durent souvent plusieurs secondes : backoff long.
      await new Promise((r) => setTimeout(r, 5000 * (i + 1)))
    }
  }
  throw lastErr
}

export interface GenerateTextOptions {
  prompt: string
  system?: string
  images?: ImageInput[]
  model?: string
  jobId?: number
}

export async function generateText(opts: GenerateTextOptions): Promise<{
  text: string
  usage: Usage
}> {
  const model = opts.model ?? config.textModel
  const parts: Part[] = [...(opts.images ?? []).map(toPart), { text: opts.prompt }]
  const started = Date.now()
  try {
    const response = await withRetry(() =>
      getAi().models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: opts.system ? { systemInstruction: opts.system } : undefined,
      })
    )
    const usage = extractUsage(response.usageMetadata)
    const text = response.text ?? ''
    logApiCall({
      jobId: opts.jobId,
      provider: 'gemini',
      model,
      kind: 'text.generate',
      durationMs: Date.now() - started,
      ...usage,
      ok: true,
    })
    return { text, usage }
  } catch (err) {
    logApiCall({
      jobId: opts.jobId,
      provider: 'gemini',
      model,
      kind: 'text.generate',
      durationMs: Date.now() - started,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
    throw new Error(erreurGeminiLisible(err))
  }
}

export type AspectRatio = '1:1' | '3:2' | '2:3' | '4:3' | '4:5' | '16:9' | '21:9'
export type ImageSize = '1K' | '2K' | '4K'

export interface GenerateImageOptions {
  prompt: string
  /** Images de référence : CANNY, décor à éditer, produit… dans l'ordre d'envoi */
  images?: ImageInput[]
  aspectRatio?: AspectRatio
  imageSize?: ImageSize
  model?: string
  jobId?: number
  /** Nom de base de l'artefact sauvegardé (sans extension) */
  artifactName?: string
  /** Sous-dossier de data/artifacts */
  artifactDir?: string
}

export interface GeneratedImage {
  buffer: Buffer
  mimeType: string
  width: number
  height: number
  usage: Usage
  artifactPath: string
}

export async function generateImage(opts: GenerateImageOptions): Promise<GeneratedImage> {
  // Modèle image : réglage global Admin → Réglages (Nano Banana Pro / Nano Banana),
  // sauf si l'appelant impose un modèle précis (Lab).
  const model = opts.model ?? getImageModel()
  const parts: Part[] = [...(opts.images ?? []).map(toPart), { text: opts.prompt }]
  const started = Date.now()
  try {
    const response = await withRetry(() =>
      getAi().models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: opts.aspectRatio ?? '3:2',
            imageSize: opts.imageSize ?? '4K',
          },
        },
      })
    )

    const outParts = response.candidates?.[0]?.content?.parts ?? []
    const imagePart = outParts.find((p) => p.inlineData?.data)
    if (!imagePart?.inlineData?.data) {
      const textPart = outParts.find((p) => p.text)?.text
      throw new Error(
        `Aucune image dans la réponse du modèle${textPart ? ` — texte reçu : ${textPart.slice(0, 300)}` : ''}`
      )
    }

    const buffer = Buffer.from(imagePart.inlineData.data, 'base64')
    const mimeType = imagePart.inlineData.mimeType ?? 'image/png'
    const meta = await sharp(buffer).metadata()

    const dir = path.join(config.artifactsDir, opts.artifactDir ?? 'divers')
    fs.mkdirSync(dir, { recursive: true })
    const ext = mimeType.includes('jpeg') ? 'jpg' : 'png'
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const artifactPath = path.join(dir, `${opts.artifactName ?? 'image'}-${stamp}.${ext}`)
    fs.writeFileSync(artifactPath, buffer)
    // Marquage IA (IPTC DigitalSourceType) de chaque image sortie du modèle.
    await marquerImageIa(artifactPath)

    const usage = extractUsage(response.usageMetadata)
    logApiCall({
      jobId: opts.jobId,
      provider: 'gemini',
      model,
      kind: 'image.generate',
      durationMs: Date.now() - started,
      ...usage,
      ok: true,
      artifactPath: path.relative(config.rootDir, artifactPath),
    })

    return {
      buffer,
      mimeType,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      usage,
      artifactPath,
    }
  } catch (err) {
    logApiCall({
      jobId: opts.jobId,
      provider: 'gemini',
      model,
      kind: 'image.generate',
      durationMs: Date.now() - started,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
    throw new Error(erreurGeminiLisible(err))
  }
}
