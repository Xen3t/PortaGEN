import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'
import { colorisDefAll } from '@/lib/catalogue/colorisStore'

/**
 * Corrections de coloris posées à la main sur la fiche produit (12/07/2026).
 * Le coloris affiché sur une carte vient, dans l'ordre : de la correction
 * manuelle, sinon du nom des dossiers, sinon de la détection par l'image. Ce
 * module ne gère QUE la couche « correction manuelle ».
 *
 * Clé = coloris d'origine tel que scanné (« non précisé », « GRIS »…), pour que
 * la correction suive la carte même après un rescan.
 */

/** Corrections d'un produit : { colorisOrigine → colorisCorrigé }. */
export function listColorisOverrides(
  productId: number,
  db: Database.Database = getDb()
): Record<string, string> {
  const rows = db
    .prepare('SELECT coloris_key, coloris FROM catalog_coloris_override WHERE product_id = ?')
    .all(productId) as { coloris_key: string; coloris: string }[]
  const out: Record<string, string> = {}
  for (const row of rows) out[row.coloris_key] = row.coloris
  return out
}

/**
 * Enregistre une correction. `coloris` doit être un coloris connu de la palette
 * (origine gris/blanc/noir/teck OU ajouté depuis l'admin) — sinon on refuse.
 * Retourne le libellé retenu.
 */
export function saveColorisOverride(
  productId: number,
  colorisKey: string,
  coloris: string,
  db: Database.Database = getDb()
): string {
  const def = colorisDefAll(coloris, db)
  if (!def) throw new Error(`Coloris inconnu : ${coloris}`)
  db.prepare(
    `INSERT INTO catalog_coloris_override (product_id, coloris_key, coloris, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(product_id, coloris_key) DO UPDATE SET coloris = excluded.coloris, updated_at = datetime('now')`
  ).run(productId, colorisKey, def.label)
  return def.label
}
