import type Database from 'better-sqlite3'
import { getDb, type JobRow } from '@/lib/db'
import { getDecorByPath } from '@/lib/db/decors'

/**
 * Historique « Derniers lancements » d'une page produit (bloc 3.4, 13/07/2026).
 *
 * Un LANCEMENT = un `batch_id` : la case unique « ＋ Générer » comme le lot
 * « Générer les manquantes » partagent désormais un même batch (le client passe
 * un batchId commun à toutes les cases d'un lot). On regroupe donc les jobs
 * catalogue par batch, on reconstitue les cases (coloris × taille × format) avec
 * leur état le plus avancé, et on retrouve le décor employé via le payload des
 * piliers. Sert à réafficher les lancements et à les Reprendre / Dupliquer.
 */

export interface LaunchCell {
  coloris: string
  /** `300x140` */
  size: string
  /** `2000x1330` (site) ou `2000x2000` (marketplace) */
  format: string
  stage: 'pillars' | 'integration' | 'marketplace'
  status: string
  deliveryPath: string | null
}

export interface ProductLaunch {
  batchId: string
  createdAt: string
  updatedAt: string
  /** Utilisateur qui a lancé la génération (jobs.created_by), null pour les anciens jobs. */
  createdBy: string | null
  /** Coloris distincts touchés par le lancement (souvent un seul). */
  colorisList: string[]
  /** Formats distincts : `2000x1330` et/ou `2000x2000`. */
  formats: string[]
  decorId: number | null
  decorName: string | null
  cells: LaunchCell[]
  total: number
  done: number
  running: number
  error: number
}

interface JobPayload {
  catalogProductId?: number
  coloris?: unknown
  format?: unknown
  size?: { w?: unknown; h?: unknown }
  decorPath?: unknown
}

function parseCell(row: JobRow): { key: string; cell: LaunchCell; decorPath: string | null } | null {
  let payload: JobPayload
  try {
    payload = row.payload ? (JSON.parse(row.payload) as JobPayload) : {}
  } catch {
    return null
  }
  const coloris = typeof payload.coloris === 'string' ? payload.coloris : null
  const format = typeof payload.format === 'string' ? payload.format : null
  const w = Number(payload.size?.w)
  const h = Number(payload.size?.h)
  if (!coloris || !format || !Number.isFinite(w) || !Number.isFinite(h)) return null
  const size = `${w}x${h}`

  let result: { deliveryPath?: unknown } | null = null
  try {
    result = row.result ? JSON.parse(row.result) : null
  } catch {
    result = null
  }
  // « pose-fusion » (chantier 17/07/2026) produit la MES finale en un seul job :
  // même rôle que l'intégration pour l'historique.
  const isFinal =
    row.type === 'integration' || row.type === 'pose-fusion' || row.type === 'marketplace'
  const deliveryPath =
    isFinal && row.status === 'done' && typeof result?.deliveryPath === 'string'
      ? result.deliveryPath
      : null

  return {
    key: `${coloris}|${size}|${format}`,
    cell: {
      coloris,
      size,
      format,
      stage:
        row.type === 'integration' || row.type === 'pose-fusion'
          ? 'integration'
          : row.type === 'marketplace'
            ? 'marketplace'
            : 'pillars',
      status: row.status,
      deliveryPath,
    },
    decorPath: typeof payload.decorPath === 'string' ? payload.decorPath : null,
  }
}

export function listProductLaunches(
  productId: number,
  db: Database.Database = getDb(),
  limit = 12
): ProductLaunch[] {
  const rows = db
    .prepare(`SELECT * FROM jobs WHERE json_extract(payload, '$.catalogProductId') = ? ORDER BY id`)
    .all(productId) as JobRow[]

  // Regroupement par batch. Les jobs sont triés par id croissant : pour une même
  // case, l'intégration (créée après les piliers) écrase l'entrée « piliers ».
  const byBatch = new Map<
    string,
    {
      cells: Map<string, LaunchCell>
      decorPath: string | null
      createdBy: string | null
      created: string
      updated: string
    }
  >()
  for (const row of rows) {
    const batchId = row.batch_id
    if (!batchId) continue
    const parsed = parseCell(row)
    if (!parsed) continue
    let group = byBatch.get(batchId)
    if (!group) {
      group = {
        cells: new Map(),
        decorPath: null,
        createdBy: null,
        created: row.created_at,
        updated: row.created_at,
      }
      byBatch.set(batchId, group)
    }
    group.cells.set(parsed.key, parsed.cell)
    if (!group.decorPath && parsed.decorPath) group.decorPath = parsed.decorPath
    if (!group.createdBy && row.created_by && row.created_by !== '__system__')
      group.createdBy = row.created_by
    if (row.created_at < group.created) group.created = row.created_at
    const stamp = row.updated_at ?? row.created_at
    if (stamp > group.updated) group.updated = stamp
  }

  const launches: ProductLaunch[] = []
  for (const [batchId, group] of byBatch) {
    const cells = Array.from(group.cells.values())
    if (cells.length === 0) continue
    const decor = group.decorPath ? getDecorByPath(group.decorPath, db) : undefined
    let done = 0
    let error = 0
    let running = 0
    for (const c of cells) {
      if (c.deliveryPath) done += 1
      else if (c.status === 'error') error += 1
      else running += 1
    }
    launches.push({
      batchId,
      createdAt: group.created,
      updatedAt: group.updated,
      createdBy: group.createdBy,
      colorisList: Array.from(new Set(cells.map((c) => c.coloris))),
      formats: Array.from(new Set(cells.map((c) => c.format))).sort(),
      decorId: decor?.id ?? null,
      decorName: decor?.name ?? null,
      cells,
      total: cells.length,
      done,
      running,
      error,
    })
  }

  // Plus récents d'abord (par date de création du lancement).
  launches.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  return launches.slice(0, limit)
}
