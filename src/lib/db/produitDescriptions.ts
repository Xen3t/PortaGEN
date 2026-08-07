import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'

/**
 * Bibliothèque des DESCRIPTIONS PRODUIT vision (rodage décor autour, décision
 * Mathias 07/08/2026) : clé = (produit, coloris, moteur). Si la clé d'une image
 * correspond à une entrée, on RÉUTILISE la description (zéro appel, et surtout
 * ZÉRO variance : toutes les tailles/tirages du produit partagent le même
 * brief) ; sinon le banc fait UN appel vision imposant et enregistre ici.
 *
 * Le coloris fait partie de la clé (décision 07/08) : un ATHOS Teck (cadre alu
 * anthracite + remplissage teck) et un ATHOS gris n'ont pas les mêmes matières.
 * Née pour ces produits BI-MATIÈRE que le {COLORIS} unique décrivait faux — la
 * description injectée dans le prompt ({PRODUIT}) dit à Nano ce qu'il regarde.
 */

export interface ProduitDescriptionRow {
  id: number
  produit: string
  coloris: string
  moteur: string
  description: string
  model: string | null
  created_at: string
}

/** Clé normalisée (insensible casse/espaces). */
export function normaliserCle(v: string): string {
  return v.trim().toUpperCase().replace(/\s+/g, ' ')
}

export function getProduitDescription(
  produit: string,
  coloris: string,
  moteur: string,
  db: Database.Database = getDb()
): ProduitDescriptionRow | undefined {
  const key = normaliserCle(produit)
  if (!key) return undefined
  return db
    .prepare('SELECT * FROM produit_descriptions WHERE produit = ? AND coloris = ? AND moteur = ?')
    .get(key, normaliserCle(coloris), moteur) as ProduitDescriptionRow | undefined
}

/** Toutes les entrées (page Admin → Descriptions produit, maquette v3). */
export function listProduitDescriptions(
  db: Database.Database = getDb()
): ProduitDescriptionRow[] {
  return db
    .prepare('SELECT * FROM produit_descriptions ORDER BY id DESC')
    .all() as ProduitDescriptionRow[]
}

/** Édition manuelle (page admin) : nouveau texte, origine marquée « manuel ». */
export function updateProduitDescription(
  id: number,
  description: string,
  db: Database.Database = getDb()
): boolean {
  const res = db
    .prepare(
      `UPDATE produit_descriptions
       SET description = ?, model = 'manuel', created_at = datetime('now') WHERE id = ?`
    )
    .run(description, id)
  return res.changes > 0
}

export function deleteProduitDescription(id: number, db: Database.Database = getDb()): boolean {
  return db.prepare('DELETE FROM produit_descriptions WHERE id = ?').run(id).changes > 0
}

export function saveProduitDescription(
  produit: string,
  coloris: string,
  moteur: string,
  description: string,
  model: string,
  db: Database.Database = getDb()
): void {
  const key = normaliserCle(produit)
  if (!key) throw new Error('Nom de produit vide — description non enregistrable')
  db.prepare(
    `INSERT INTO produit_descriptions (produit, coloris, moteur, description, model)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(produit, coloris, moteur) DO UPDATE SET
       description = excluded.description,
       model = excluded.model,
       created_at = datetime('now')`
  ).run(key, normaliserCle(coloris), moteur, description, model)
}
