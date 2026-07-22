import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'
import type { GabaritParams } from '@/lib/geometry'

/**
 * Réglages de gabarit PAR TAILLE (piliers/murets), édités depuis la page « Gabarits ».
 * Un override par taille écrase les réglages globaux au lancement d'une gamme :
 * le spécifique gagne sur le général.
 */

/**
 * Clés autorisées (jamais groundY : l'alignement au sol est mesuré automatiquement).
 * Globaux : hauteurs pilier/muret réglées aux deux extrémités de la gamme
 * (pillarHMin/Max, muretHMin/Max), interpolées pour les tailles intermédiaires.
 * Dérogation par taille : hauteurs imposées directement (pillarH, muretH).
 */
type AllowedKey =
  | 'pillarWidth'
  | 'pillarHMin'
  | 'pillarHMax'
  | 'muretHMin'
  | 'muretHMax'
  | 'pillarH'
  | 'muretH'
  | 'muretEnabled'
  | 'capStyle'
  | 'offsetX'
  | 'sceneH'
export type SizeParamsOverride = Partial<Pick<GabaritParams, AllowedKey>>

/** Ne garde que les clés autorisées, avec des valeurs plausibles. */
export function sanitizeSizeParams(input: unknown): SizeParamsOverride | null {
  if (typeof input !== 'object' || input === null) return null
  const src = input as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const num = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined
  if (num(src.pillarWidth, 10, 80) !== undefined) out.pillarWidth = src.pillarWidth
  if (num(src.pillarHMin, 20, 320) !== undefined) out.pillarHMin = src.pillarHMin
  if (num(src.pillarHMax, 20, 320) !== undefined) out.pillarHMax = src.pillarHMax
  if (num(src.muretHMin, 0, 320) !== undefined) out.muretHMin = src.muretHMin
  if (num(src.muretHMax, 0, 320) !== undefined) out.muretHMax = src.muretHMax
  if (num(src.pillarH, 20, 320) !== undefined) out.pillarH = src.pillarH
  if (num(src.muretH, 0, 320) !== undefined) out.muretH = src.muretH
  if (num(src.offsetX, -100, 100) !== undefined) out.offsetX = src.offsetX
  // Recul de la scène (jeu Gabarits XL, 22/07/2026) : hauteur de scène en cm —
  // la largeur suit le ratio MES. 480 par défaut côté XL (gabaritSets.ts).
  if (num(src.sceneH, 250, 800) !== undefined) out.sceneH = src.sceneH
  if (typeof src.muretEnabled === 'boolean') out.muretEnabled = src.muretEnabled
  if (src.capStyle === 'none' || src.capStyle === 'flat' || src.capStyle === 'gendarme') {
    out.capStyle = src.capStyle
  }
  return Object.keys(out).length > 0 ? (out as SizeParamsOverride) : null
}

/**
 * Réglages PAR MOTEUR (règle cadrage 13/07/2026 : les réglages ne sont JAMAIS
 * partagés entre moteurs). Le battant (JANUS) garde ses clés historiques telles
 * quelles — aucune migration, aucun risque ; les autres moteurs préfixent leurs
 * clés (« portillon:100x140 », « gabarit_globals.portillon »).
 */
function moteurLabel(label: string, moteur: string): string {
  return moteur === 'battant' ? label : `${moteur}:${label}`
}

export function getSizeParamsOverride(
  label: string,
  moteur = 'battant',
  db: Database.Database = getDb()
): SizeParamsOverride | null {
  const row = db
    .prepare('SELECT params FROM size_params WHERE label = ?')
    .get(moteurLabel(label, moteur)) as { params: string } | undefined
  if (!row) return null
  try {
    return sanitizeSizeParams(JSON.parse(row.params))
  } catch {
    return null
  }
}

/**
 * Dérogations d'UN moteur, indexées par label de taille nu (« 100x140 ») —
 * le préfixe moteur est un détail de stockage, jamais exposé aux appelants.
 */
export function listSizeParamsOverrides(
  moteur = 'battant',
  db: Database.Database = getDb()
): Record<string, SizeParamsOverride> {
  const rows = db.prepare('SELECT label, params FROM size_params').all() as {
    label: string
    params: string
  }[]
  const out: Record<string, SizeParamsOverride> = {}
  for (const r of rows) {
    const isPrefixed = r.label.includes(':')
    const [prefix, bare] = isPrefixed ? r.label.split(':', 2) : ['battant', r.label]
    if (prefix !== moteur) continue
    try {
      const p = sanitizeSizeParams(JSON.parse(r.params))
      if (p) out[bare] = p
    } catch {
      // ligne corrompue : ignorée
    }
  }
  return out
}

/**
 * Réglages GLOBAUX de gabarit (mêmes clés que les dérogations), édités depuis la
 * page Gabarits — persistés en base (app_settings), appliqués à toutes les
 * tailles au lancement d'une gamme, sauf dérogation. Ordre : défauts du code
 * < globaux < dérogation par taille. Un jeu de globaux PAR moteur.
 */
const GABARIT_GLOBALS_KEY = 'gabarit_globals'

function globalsKey(moteur: string): string {
  return moteur === 'battant' ? GABARIT_GLOBALS_KEY : `${GABARIT_GLOBALS_KEY}.${moteur}`
}

export function getGabaritGlobals(
  moteur = 'battant',
  db: Database.Database = getDb()
): SizeParamsOverride {
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(globalsKey(moteur)) as { value: string } | undefined
  if (!row) return {}
  try {
    return sanitizeSizeParams(JSON.parse(row.value)) ?? {}
  } catch {
    return {}
  }
}

export function saveGabaritGlobals(
  params: SizeParamsOverride | null,
  moteur = 'battant',
  db: Database.Database = getDb()
): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(globalsKey(moteur), JSON.stringify(params ?? {}))
}

/** Enregistre (ou supprime avec null) l'override d'une taille d'un moteur. */
export function saveSizeParamsOverride(
  label: string,
  params: SizeParamsOverride | null,
  moteur = 'battant',
  db: Database.Database = getDb()
): void {
  const key = moteurLabel(label, moteur)
  if (params === null) {
    db.prepare('DELETE FROM size_params WHERE label = ?').run(key)
    return
  }
  db.prepare(
    `INSERT INTO size_params (label, params, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(label) DO UPDATE SET params = excluded.params, updated_at = datetime('now')`
  ).run(key, JSON.stringify(params))
}
