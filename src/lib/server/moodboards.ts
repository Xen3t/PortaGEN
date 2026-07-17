import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/lib/config'
import { getDb } from '@/lib/db'
import { normalizeDecorPath } from '@/lib/db/decors'

/**
 * Gestion des moodboards depuis l'interface (exigence « aucun réglage
 * uniquement par fichier ») : ajout, renommage, suppression dans le dossier
 * `Assets/Moodboards PDF`, réservés à l'admin (gestion des référentiels).
 * Seules les images JPG/PNG sont gérées — les PDF du dossier sont ignorés.
 */

export const MOODBOARD_EXTENSIONS = ['.jpg', '.jpeg', '.png'] as const
export const MOODBOARD_MAX_BYTES = 25 * 1024 * 1024

export function moodboardsDir(): string {
  return path.join(config.assetsDir, 'Moodboards PDF')
}

/**
 * Nettoie un nom de fichier proposé par l'utilisateur : pas de chemin, pas de
 * caractères interdits Windows, longueur bornée. Retourne le nom SANS extension.
 */
export function sanitizeMoodboardName(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, '') // extension retirée (gérée à part)
    .replace(/[\\/:*?"<>|]/g, ' ') // interdits Windows + séparateurs de chemin
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

/** Résout un chemin relatif d'UI vers un fichier image DU dossier moodboards, sinon null. */
export function resolveMoodboardFile(relPath: string): string | null {
  const full = path.resolve(config.rootDir, relPath)
  const root = path.resolve(moodboardsDir())
  if (!full.startsWith(root + path.sep)) return null
  if (!(MOODBOARD_EXTENSIONS as readonly string[]).includes(path.extname(full).toLowerCase()))
    return null
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null
  return full
}

export interface SaveMoodboardResult {
  ok: true
  path: string
  name: string
}
export interface MoodboardError {
  ok: false
  error: string
}

/** Enregistre un moodboard téléversé. Refuse les doublons de nom (pas d'écrasement silencieux). */
export function saveMoodboard(
  buffer: Buffer,
  originalName: string,
  requestedName?: string
): SaveMoodboardResult | MoodboardError {
  const ext = path.extname(originalName).toLowerCase()
  if (!(MOODBOARD_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, error: 'Format non géré : envoyez une image JPG ou PNG.' }
  }
  if (buffer.length === 0) return { ok: false, error: 'Fichier vide.' }
  if (buffer.length > MOODBOARD_MAX_BYTES) {
    return { ok: false, error: 'Fichier trop lourd (25 Mo maximum).' }
  }
  const name = sanitizeMoodboardName(requestedName || originalName)
  if (!name) return { ok: false, error: 'Nom de moodboard invalide.' }
  const dir = moodboardsDir()
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, name + ext)
  if (fs.existsSync(target)) {
    return { ok: false, error: `Un moodboard « ${name} » existe déjà — choisissez un autre nom.` }
  }
  fs.writeFileSync(target, buffer)
  return { ok: true, path: path.relative(config.rootDir, target), name }
}

/** Renomme un moodboard et suit la référence dans la bibliothèque de décors. */
export function renameMoodboard(relPath: string, newName: string): SaveMoodboardResult | MoodboardError {
  const full = resolveMoodboardFile(relPath)
  if (!full) return { ok: false, error: 'Moodboard introuvable.' }
  const name = sanitizeMoodboardName(newName)
  if (!name) return { ok: false, error: 'Nom invalide.' }
  const ext = path.extname(full).toLowerCase()
  const target = path.join(moodboardsDir(), name + ext)
  if (path.resolve(target) === path.resolve(full)) {
    return { ok: true, path: path.relative(config.rootDir, full), name }
  }
  if (fs.existsSync(target)) {
    return { ok: false, error: `Un moodboard « ${name} » existe déjà.` }
  }
  fs.renameSync(full, target)
  // Les décors générés depuis ce moodboard suivent le nouveau nom.
  getDb()
    .prepare('UPDATE decors SET moodboard_path = ? WHERE moodboard_path = ?')
    .run(normalizeDecorPath(target), normalizeDecorPath(full))
  return { ok: true, path: path.relative(config.rootDir, target), name }
}

/** Supprime un moodboard (le PDF homonyme éventuel est laissé en place). */
export function deleteMoodboard(relPath: string): { ok: true } | MoodboardError {
  const full = resolveMoodboardFile(relPath)
  if (!full) return { ok: false, error: 'Moodboard introuvable.' }
  fs.rmSync(full)
  return { ok: true }
}
