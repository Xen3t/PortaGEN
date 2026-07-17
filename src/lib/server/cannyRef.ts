import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { config } from '@/lib/config'
import type { MoteurKey } from '@/lib/moteurs'

/**
 * Image CANNY de référence PAR MOTEUR (demande Mathias 13/07/2026 : pouvoir la
 * remplacer depuis Admin → Réglages par moteur). Règle : si l'admin a déposé sa
 * propre image (data/moteurs/<moteur>/canny-ref.png), le pipeline l'utilise ;
 * sinon on retombe sur le trottoir historique 2000×1330 (Assets/). « Revenir à
 * l'image d'origine » = suppression du fichier déposé, rien d'autre.
 */

export const DEFAULT_CANNY_PATH = path.join(
  config.assetsDir,
  'Trottoir Canny',
  'Trottoir 2000x1330.png'
)

const customPath = (moteur: MoteurKey) =>
  path.join(config.dataDir, 'moteurs', moteur, 'canny-ref.png')

/** Chemin de l'image CANNY active du moteur (personnalisée sinon d'origine). */
export function cannyRefPath(moteur: MoteurKey): string {
  const p = customPath(moteur)
  return fs.existsSync(p) ? p : DEFAULT_CANNY_PATH
}

export interface CannyRefInfo {
  custom: boolean
  /** Chemin relatif projet, servi par /api/artifacts?p=… */
  relPath: string
  width: number | null
  height: number | null
  /** mtime du fichier — version anti-cache pour l'aperçu de l'admin. */
  version: number
}

export async function cannyRefInfo(moteur: MoteurKey): Promise<CannyRefInfo> {
  const full = cannyRefPath(moteur)
  const meta = await sharp(full).metadata().catch(() => null)
  const st = fs.statSync(full)
  return {
    custom: full !== DEFAULT_CANNY_PATH,
    relPath: path.relative(config.rootDir, full).split(path.sep).join('/'),
    width: meta?.width ?? null,
    height: meta?.height ?? null,
    version: Math.round(st.mtimeMs),
  }
}

/** Dépose la nouvelle image de référence (convertie en PNG, telle quelle sinon). */
export async function saveCannyRef(
  moteur: MoteurKey,
  buffer: Buffer
): Promise<{ ok: true } | { ok: false; error: string }> {
  let png: Buffer
  try {
    png = await sharp(buffer).png().toBuffer()
  } catch {
    return { ok: false, error: 'Fichier illisible — envoyer une image (PNG, JPG ou WebP)' }
  }
  const p = customPath(moteur)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, png)
  return { ok: true }
}

/** Supprime l'image personnalisée : le moteur repart sur l'image d'origine. */
export function resetCannyRef(moteur: MoteurKey): void {
  const p = customPath(moteur)
  if (fs.existsSync(p)) fs.unlinkSync(p)
}
