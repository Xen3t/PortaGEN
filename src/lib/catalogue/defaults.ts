import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'

/**
 * Réglages par défaut PAR COLORIS d'une gamme (maquette v6 validée le
 * 12/07/2026) : le décor, l'alignement des piliers au sol et les formats que
 * tous les boutons « Générer » du coloris utiliseront. Ouverts à toute l'équipe.
 *
 * Alignement (refonte 13/07/2026, décision Mathias — « le moteur pilote tout ») :
 * 'moteur' (DÉFAUT) = suivre le réglage du moteur (Admin → Réglages par moteur) ;
 * 'off'/'manual' = dérogation explicite de CE coloris. L'ancienne valeur 'auto'
 * (posée machinalement par l'UI d'avant le moteur) est relue comme 'moteur' —
 * comportement inchangé tant que le moteur reste sur Auto (son défaut).
 */

export interface ColorisSettings {
  decorId: number | null
  /**
   * Décor par défaut des tailles XL (coulissants ≥ 450 cm, 22/07/2026) — décor
   * de type « coulissant-xl » uniquement. Les gammes sans largeur XL l'ignorent.
   */
  decorXlId: number | null
  align: 'moteur' | 'off' | 'manual'
  alignPx: number
  formats: { site: boolean; marketplace: boolean }
}

export const DEFAULT_COLORIS_SETTINGS: ColorisSettings = {
  decorId: null,
  decorXlId: null,
  align: 'moteur',
  alignPx: 0,
  formats: { site: true, marketplace: true },
}

/** Ne garde que des valeurs saines — tout le reste retombe sur les défauts. */
export function sanitizeColorisSettings(input: unknown): ColorisSettings {
  const d = DEFAULT_COLORIS_SETTINGS
  if (typeof input !== 'object' || input === null) return { ...d, formats: { ...d.formats } }
  const raw = input as Record<string, unknown>
  const decorId =
    typeof raw.decorId === 'number' && Number.isInteger(raw.decorId) && raw.decorId > 0
      ? raw.decorId
      : null
  const decorXlId =
    typeof raw.decorXlId === 'number' && Number.isInteger(raw.decorXlId) && raw.decorXlId > 0
      ? raw.decorXlId
      : null
  // Tout sauf 'off'/'manual' (dont l'ancien 'auto') → 'moteur' : le moteur décide.
  const align = raw.align === 'off' || raw.align === 'manual' ? raw.align : 'moteur'
  const alignPxRaw = Number(raw.alignPx)
  const alignPx =
    align === 'manual' && Number.isFinite(alignPxRaw)
      ? Math.max(-500, Math.min(500, Math.round(alignPxRaw)))
      : 0
  const formats = (raw.formats ?? {}) as Record<string, unknown>
  return {
    decorId,
    decorXlId,
    align,
    alignPx,
    formats: { site: formats.site !== false, marketplace: formats.marketplace !== false },
  }
}

export function getColorisSettings(
  productId: number,
  coloris: string,
  db: Database.Database = getDb()
): ColorisSettings {
  const row = db
    .prepare('SELECT settings FROM catalog_coloris_settings WHERE product_id = ? AND coloris = ?')
    .get(productId, coloris) as { settings: string } | undefined
  if (!row) return sanitizeColorisSettings(null)
  try {
    return sanitizeColorisSettings(JSON.parse(row.settings))
  } catch {
    return sanitizeColorisSettings(null)
  }
}

export function listColorisSettings(
  productId: number,
  db: Database.Database = getDb()
): Record<string, ColorisSettings> {
  const rows = db
    .prepare('SELECT coloris, settings FROM catalog_coloris_settings WHERE product_id = ?')
    .all(productId) as { coloris: string; settings: string }[]
  const out: Record<string, ColorisSettings> = {}
  for (const row of rows) {
    try {
      out[row.coloris] = sanitizeColorisSettings(JSON.parse(row.settings))
    } catch {
      out[row.coloris] = sanitizeColorisSettings(null)
    }
  }
  return out
}

export function saveColorisSettings(
  productId: number,
  coloris: string,
  input: unknown,
  db: Database.Database = getDb()
): ColorisSettings {
  const settings = sanitizeColorisSettings(input)
  db.prepare(
    `INSERT INTO catalog_coloris_settings (product_id, coloris, settings, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(product_id, coloris) DO UPDATE SET settings = excluded.settings, updated_at = datetime('now')`
  ).run(productId, coloris, JSON.stringify(settings))
  return settings
}
