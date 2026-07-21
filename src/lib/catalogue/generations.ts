import type Database from 'better-sqlite3'
import { getDb, type JobRow } from '@/lib/db'

/**
 * Générations LOCALES d'une page produit (bloc 3.1, 12/07/2026).
 *
 * La grille de la page produit lit d'abord les MES du SERVEUR (scan). Mais tant
 * que l'écriture serveur n'est pas autorisée, les MES qu'on génère vivent en
 * local (`data/artifacts/…`) : on les retrouve ici par le `catalogProductId`
 * porté dans le payload des jobs (piliers puis intégration). Chaque case
 * (coloris × taille × format) garde son ÉTAT le plus avancé : l'intégration
 * (id le plus grand) prime sur les piliers ; l'image finale n'apparaît qu'à la
 * fin de l'intégration.
 */

export interface ProductGeneration {
  /** `300x120` */
  size: string
  coloris: string
  /** `2000x1330` (site) ou `2000x2000` (marketplace) */
  format: string
  stage: 'pillars' | 'integration' | 'marketplace'
  status: string
  /** Chemin de livraison relatif au projet — seulement quand l'intégration est terminée. */
  deliveryPath: string | null
  jobId: number
  batchId: string | null
  updatedAt: string | null
}

interface JobPayload {
  catalogProductId?: number
  coloris?: unknown
  format?: unknown
  size?: { w?: unknown; h?: unknown }
}

export function listProductGenerations(
  productId: number,
  db: Database.Database = getDb()
): ProductGeneration[] {
  const rows = db
    .prepare(`SELECT * FROM jobs WHERE json_extract(payload, '$.catalogProductId') = ? ORDER BY id`)
    .all(productId) as JobRow[]

  // Tri par id croissant → l'intégration (créée après les piliers) écrase l'entrée
  // « piliers » de la même case ; une relance (id plus grand) écrase l'ancienne.
  const byCell = new Map<string, ProductGeneration>()
  for (const row of rows) {
    let payload: JobPayload
    try {
      payload = row.payload ? (JSON.parse(row.payload) as JobPayload) : {}
    } catch {
      continue
    }
    const coloris = typeof payload.coloris === 'string' ? payload.coloris : null
    const format = typeof payload.format === 'string' ? payload.format : null
    const w = Number(payload.size?.w)
    const h = Number(payload.size?.h)
    if (!coloris || !format || !Number.isFinite(w) || !Number.isFinite(h)) continue
    const size = `${w}x${h}`

    let result: { deliveryPath?: unknown } | null = null
    try {
      result = row.result ? JSON.parse(row.result) : null
    } catch {
      result = null
    }
    // « pose-fusion » (chantier 17/07/2026) produit la MES finale en un seul job :
    // même rôle que l'intégration pour la grille.
    const isFinal =
      row.type === 'integration' || row.type === 'pose-fusion' || row.type === 'marketplace'
    const deliveryPath =
      isFinal && row.status === 'done' && typeof result?.deliveryPath === 'string'
        ? result.deliveryPath
        : null

    byCell.set(`${coloris}|${size}|${format}`, {
      size,
      coloris,
      format,
      stage:
        row.type === 'integration' || row.type === 'pose-fusion'
          ? 'integration'
          : row.type === 'marketplace'
            ? 'marketplace'
            : 'pillars',
      status: row.status,
      deliveryPath,
      jobId: row.id,
      batchId: row.batch_id,
      updatedAt: row.updated_at,
    })
  }
  return Array.from(byCell.values())
}
