import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { config } from '@/lib/config'
import type { GabaritSetKey } from '@/lib/gabaritSets'

/**
 * Image CANNY de référence PAR MOTEUR (demande Mathias 13/07/2026 : pouvoir la
 * remplacer depuis Admin → Réglages par moteur). Règle : si l'admin a déposé sa
 * propre image (data/moteurs/<moteur>/canny-ref.png), le pipeline l'utilise ;
 * sinon on retombe sur le trottoir historique 2000×1330 (Assets/). « Revenir à
 * l'image d'origine » = suppression du fichier déposé, rien d'autre.
 *
 * Depuis le 22/07/2026 la clé est un JEU DE GABARITS : « coulissant-xl » (CANNY
 * XL, section dédiée de la fiche TERMINUS) a sa propre image d'origine — le
 * trottoir « caméra reculée » (bande plus fine, remontée vers l'horizon,
 * dérivé par scripts/derive-canny-xl.ts) qui pousse les décors XL à l'échelle.
 * Le CANNY du coulissant standard ne bouge pas : le XL vient EN COMPLÉMENT.
 */

export const DEFAULT_CANNY_PATH = path.join(
  config.assetsDir,
  'Trottoir Canny',
  'Trottoir 2000x1330.png'
)

export const DEFAULT_CANNY_XL_PATH = path.join(
  config.assetsDir,
  'Trottoir Canny',
  'Trottoir XL 2000x1330.png'
)

const defaultPath = (jeu: GabaritSetKey) =>
  jeu === 'coulissant-xl' ? DEFAULT_CANNY_XL_PATH : DEFAULT_CANNY_PATH

const customPath = (jeu: GabaritSetKey) =>
  path.join(config.dataDir, 'moteurs', jeu, 'canny-ref.png')

/** Chemin de l'image CANNY active du jeu (personnalisée sinon d'origine). */
export function cannyRefPath(jeu: GabaritSetKey): string {
  const p = customPath(jeu)
  return fs.existsSync(p) ? p : defaultPath(jeu)
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

export async function cannyRefInfo(jeu: GabaritSetKey): Promise<CannyRefInfo> {
  const full = cannyRefPath(jeu)
  const meta = await sharp(full).metadata().catch(() => null)
  const st = fs.statSync(full)
  return {
    custom: full !== defaultPath(jeu),
    relPath: path.relative(config.rootDir, full).split(path.sep).join('/'),
    width: meta?.width ?? null,
    height: meta?.height ?? null,
    version: Math.round(st.mtimeMs),
  }
}

/** Dépose la nouvelle image de référence (convertie en PNG, telle quelle sinon). */
export async function saveCannyRef(
  jeu: GabaritSetKey,
  buffer: Buffer
): Promise<{ ok: true } | { ok: false; error: string }> {
  let png: Buffer
  try {
    png = await sharp(buffer).png().toBuffer()
  } catch {
    return { ok: false, error: 'Fichier illisible — envoyer une image (PNG, JPG ou WebP)' }
  }
  const p = customPath(jeu)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, png)
  return { ok: true }
}

/** Supprime l'image personnalisée : le jeu repart sur son image d'origine. */
export function resetCannyRef(jeu: GabaritSetKey): void {
  const p = customPath(jeu)
  if (fs.existsSync(p)) fs.unlinkSync(p)
}
