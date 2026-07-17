import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'
import { getActivePrompt } from '@/lib/db/prompts'
import { generateText } from '@/lib/genai/client'
import { listAllTags, sanitizeTags, setDecorTags } from '@/lib/db/decors'

/**
 * Tags automatiques d'un décor (décision Mathias 09/07/2026) : à la création,
 * un LLM décrit l'image en 3–6 tags courts, en RÉUTILISANT le vocabulaire déjà
 * présent dans la bibliothèque (croisement avec l'existant) pour éviter les
 * doublons de synonymes. Prompt système versionné : « decor-tags ».
 */

/** Extrait le premier tableau JSON de chaînes d'une réponse LLM (tolère le texte autour). */
export function parseTagsResponse(text: string): string[] {
  const start = text.indexOf('[')
  if (start === -1) return []
  const end = text.indexOf(']', start)
  if (end === -1) return []
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    return sanitizeTags(parsed)
  } catch {
    return []
  }
}

export async function autoTagDecor(
  decorId: number,
  image: Buffer,
  mimeType: string,
  jobId?: number,
  db: Database.Database = getDb()
): Promise<string[]> {
  const promptRow = getActivePrompt('decor-tags', db)
  const existing = listAllTags(db)
  const existingBlock =
    existing.length > 0
      ? `Tags existants dans la bibliothèque : ${JSON.stringify(existing)}`
      : 'La bibliothèque ne contient encore aucun tag.'
  const res = await generateText({
    system: promptRow.content,
    prompt: `${existingBlock}\n\nProduis les tags de l'image jointe.`,
    images: [{ source: image, mimeType }],
    jobId,
  })
  const tags = parseTagsResponse(res.text)
  if (tags.length > 0) setDecorTags(decorId, tags, db)
  return tags
}
