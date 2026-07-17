import type Database from 'better-sqlite3'
import path from 'node:path'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'

/**
 * Stockage des détourages (chantier 2). Les PNG vivent EN LOCAL (`data/detourage/`)
 * tant que l'écriture serveur n'est pas autorisée. Un détourage « valide » ou
 * « importe » rend la référence générable.
 */

export type DetourageStatus = 'a_valider' | 'valide' | 'importe' | 'ignore'

export interface DetourageRow {
  id: number
  product_id: number
  coloris: string
  size_label: string
  source_rel: string | null
  /** chemin relatif au projet (data/detourage/…). */
  png_path: string
  status: DetourageStatus
  created_at: string
  updated_at: string | null
}

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'x'

/** Chemin LOCAL (relatif au projet) où stocker le PNG détouré d'une référence. */
export function detouragePngRel(productId: number, coloris: string, sizeLabel: string): string {
  return path.join('data', 'detourage', String(productId), `${slug(coloris)}_${slug(sizeLabel)}.png`)
}

export function detourageDir(productId: number): string {
  return path.join(config.dataDir, 'detourage', String(productId))
}

/** Un détourage utilisable (rend la référence générable). */
export function isGenerable(row: DetourageRow | undefined): boolean {
  return !!row && (row.status === 'valide' || row.status === 'importe')
}

export function listDetourages(productId: number, db: Database.Database = getDb()): DetourageRow[] {
  return db
    .prepare('SELECT * FROM detourages WHERE product_id = ? ORDER BY coloris, size_label')
    .all(productId) as DetourageRow[]
}

export function getDetourage(
  productId: number,
  coloris: string,
  sizeLabel: string,
  db: Database.Database = getDb()
): DetourageRow | undefined {
  return db
    .prepare('SELECT * FROM detourages WHERE product_id = ? AND coloris = ? AND size_label = ?')
    .get(productId, coloris, sizeLabel) as DetourageRow | undefined
}

export function upsertDetourage(
  input: {
    productId: number
    coloris: string
    sizeLabel: string
    sourceRel: string | null
    pngPath: string
    status: DetourageStatus
  },
  db: Database.Database = getDb()
): DetourageRow {
  db.prepare(
    `INSERT INTO detourages (product_id, coloris, size_label, source_rel, png_path, status, updated_at)
     VALUES (@productId, @coloris, @sizeLabel, @sourceRel, @pngPath, @status, datetime('now'))
     ON CONFLICT(product_id, coloris, size_label) DO UPDATE SET
       source_rel = excluded.source_rel,
       png_path = excluded.png_path,
       status = excluded.status,
       updated_at = datetime('now')`
  ).run(input)
  return getDetourage(input.productId, input.coloris, input.sizeLabel, db)!
}

export function setDetourageStatus(
  productId: number,
  coloris: string,
  sizeLabel: string,
  status: DetourageStatus,
  db: Database.Database = getDb()
): DetourageRow | undefined {
  db.prepare(
    `UPDATE detourages SET status = ?, updated_at = datetime('now')
     WHERE product_id = ? AND coloris = ? AND size_label = ?`
  ).run(status, productId, coloris, sizeLabel)
  return getDetourage(productId, coloris, sizeLabel, db)
}
