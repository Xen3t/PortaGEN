import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/lib/config'

/**
 * Inventaire des ressources visibles dans l'interface : moodboards disponibles
 * (Assets/Moodboards PDF) et résolution des fichiers servis via /api/artifacts.
 * Les décors, eux, vivent en base (bibliothèque : src/lib/db/decors.ts).
 */

export interface MoodboardEntry {
  path: string
  name: string
}

export function listMoodboards(): MoodboardEntry[] {
  const dir = path.join(config.assetsDir, 'Moodboards PDF')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
    // Exclut les photos de maison de référence mises en cache par la feature
    // « maisons plausibles » (fichiers « <moodboard> - Maison.jpg ») : ce sont
    // des découpes techniques, pas de vrais moodboards à proposer.
    .filter((f) => !/ - Maison\.(jpg|jpeg|png)$/i.test(f))
    .map((f) => ({
      path: path.relative(config.rootDir, path.join(dir, f)),
      name: f.replace(/\.(jpg|jpeg|png)$/i, ''),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

/**
 * Résout un chemin relatif demandé par l'UI vers un fichier autorisé.
 * Seuls data/ et Assets/ sont servis — toute évasion de chemin est rejetée.
 */
export function resolveServedFile(relPath: string): string | null {
  const full = path.resolve(config.rootDir, relPath)
  const allowedRoots = [path.resolve(config.dataDir), path.resolve(config.assetsDir)]
  if (!allowedRoots.some((root) => full.startsWith(root + path.sep))) return null
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null
  return full
}
