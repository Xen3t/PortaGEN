import fs from 'node:fs'
import type Database from 'better-sqlite3'
import sharp from 'sharp'
import { getDb } from '@/lib/db'
import { getActivePrompt } from '@/lib/db/prompts'
import { generateText } from '@/lib/genai/client'

/**
 * Photo de maison de référence d'un moodboard (chantier « maisons plausibles »,
 * 28/07/2026). Règle de priorité :
 * 1. fichier « <moodboard> - Maison.jpg/.jpeg/.png » posé à côté du moodboard
 *    (découpe manuelle — elle gagne toujours) ;
 * 2. sinon EXTRACTION AUTOMATIQUE : un appel vision localise la photo
 *    « Arrière plan » sur la page (bounding box en fractions), sharp la
 *    découpe, et le résultat est SAUVÉ sous le même nom → l'extraction ne
 *    tourne qu'une fois par moodboard, et sa découpe reste corrigeable en
 *    remplaçant simplement le fichier.
 * Échec (prompt absent, réponse illisible, boîte aberrante, portail détecté
 * dans la découpe) : null — le décor se génère comme avant, sans photo.
 */

/** Fichier « - Maison » existant à côté du moodboard, sinon null. */
export function findMaisonRef(moodboardPath: string): string | null {
  const base = moodboardPath.replace(/\.(jpg|jpeg|png)$/i, '')
  for (const ext of ['.jpg', '.jpeg', '.png']) {
    const candidate = `${base} - Maison${ext}`
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

export async function extraireMaisonRef(
  moodboardPath: string,
  jobId?: number,
  model?: string,
  db: Database.Database = getDb()
): Promise<string | null> {
  const existing = findMaisonRef(moodboardPath)
  if (existing) return existing

  let promptRow
  try {
    promptRow = getActivePrompt('decor-maison-extraction', db)
  } catch {
    return null // prompt pas encore seedé (serveur pas redémarré) : extraction inactive
  }

  try {
    // Boîte demandée en FRACTIONS de la page : indépendante de la résolution —
    // les moodboards ont des métadonnées de taille incohérentes entre fichiers.
    const meta = await sharp(moodboardPath).metadata()
    if (!meta.width || !meta.height) return null
    const small = await sharp(moodboardPath)
      .resize({ width: 1536, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
    const res = await generateText({
      system: promptRow.content,
      prompt: 'Locate the house photograph on the attached page and answer with the JSON only.',
      images: [{ source: small, mimeType: 'image/jpeg' }],
      model,
      jobId,
    })
    const match = res.text.match(/\{[\s\S]*\}/)
    if (!match) return null
    const b = JSON.parse(match[0]) as Record<string, unknown>
    const x = Number(b.x)
    const y = Number(b.y)
    const w = Number(b.w)
    const h = Number(b.h)
    // Boîte plausible : ni minuscule (pastille, vignette), ni la page entière.
    if (!(w >= 0.12 && h >= 0.12 && w <= 0.9 && h <= 0.9)) return null
    if (!(x >= 0 && y >= 0 && x + w <= 1.005 && y + h <= 1.005)) return null

    const left = Math.max(0, Math.round(meta.width * x))
    const top = Math.max(0, Math.round(meta.height * y))
    const width = Math.min(Math.round(meta.width * w), meta.width - left)
    const height = Math.min(Math.round(meta.height * h), meta.height - top)
    const out = moodboardPath.replace(/\.(jpg|jpeg|png)$/i, '') + ' - Maison.jpg'
    await sharp(moodboardPath)
      .extract({ left, top, width, height })
      .jpeg({ quality: 92 })
      .toFile(out)

    // Contrôle : une découpe qui montre un portail/clôture empoisonnerait le
    // décor (le décor ne doit JAMAIS contenir de portail) — on la jette.
    const check = await generateText({
      system: 'Answer with exactly one word: yes or no.',
      prompt:
        'Does this image prominently show a gate, fence panels or masonry entrance pillars in the foreground?',
      images: [{ source: out }],
      model,
      jobId,
    })
    if (/yes/i.test(check.text)) {
      fs.unlinkSync(out)
      return null
    }
    return out
  } catch (err) {
    console.warn('[decor] extraction photo maison :', err)
    return null
  }
}
