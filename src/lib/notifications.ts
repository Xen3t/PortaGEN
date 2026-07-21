import type Database from 'better-sqlite3'
import { getDb, type JobRow } from '@/lib/db'

/**
 * Notifications de la cloche du bandeau (bloc 3.4, 13/07/2026).
 *
 * Une notification = un LANCEMENT catalogue TERMINÉ de l'utilisateur (batch dont
 * plus aucun job n'est en file/en cours). On regroupe par batch pour ne pas
 * cracher six lignes quand un lot de six MES se termine. L'état « lu » est géré
 * côté client (repère du dernier id vu en localStorage) : pas de colonne en base,
 * la cloche reste un simple miroir des jobs récents.
 *
 * Extension 20/07/2026 (demande Mathias) : les DÉCORS générés (Bibliothèque et
 * page produit) remontent aussi — une notification par décor terminé ou en échec.
 */

export interface UserNotification {
  /** Repère monotone (id de job max du batch) — sert de filigrane « lu / non lu ». */
  id: number
  batchId: string
  productId: number
  productName: string
  colorisList: string[]
  siteDone: number
  marketplaceDone: number
  errorCount: number
  kind: 'ok' | 'partial' | 'error'
  message: string
  at: string
  /** 'catalogue' → clic = page produit ; 'decor' → clic = Bibliothèque. */
  source: 'catalogue' | 'decor'
}

interface Payload {
  catalogProductId?: number
  coloris?: unknown
  format?: unknown
  size?: { w?: unknown; h?: unknown }
}

interface Cell {
  format: string
  status: string
  delivered: boolean
}

const SITE = '2000x1330'

export function listUserNotifications(
  username: string,
  db: Database.Database = getDb(),
  limit = 30
): UserNotification[] {
  const rows = db
    .prepare(
      `SELECT * FROM jobs
       WHERE created_by = ? AND batch_id IS NOT NULL
         AND json_extract(payload, '$.catalogProductId') IS NOT NULL
       ORDER BY id`
    )
    .all(username) as JobRow[]

  const byBatch = new Map<
    string,
    {
      productId: number
      coloris: Set<string>
      cells: Map<string, Cell>
      maxId: number
      at: string
      pending: boolean
    }
  >()

  for (const row of rows) {
    const batchId = row.batch_id
    if (!batchId) continue
    let payload: Payload
    try {
      payload = row.payload ? (JSON.parse(row.payload) as Payload) : {}
    } catch {
      continue
    }
    const productId = Number(payload.catalogProductId)
    const coloris = typeof payload.coloris === 'string' ? payload.coloris : null
    const format = typeof payload.format === 'string' ? payload.format : null
    const w = Number(payload.size?.w)
    const h = Number(payload.size?.h)
    if (!Number.isFinite(productId) || !coloris || !format || !Number.isFinite(w)) continue

    let group = byBatch.get(batchId)
    if (!group) {
      group = {
        productId,
        coloris: new Set(),
        cells: new Map(),
        maxId: row.id,
        at: row.updated_at ?? row.created_at,
        pending: false,
      }
      byBatch.set(batchId, group)
    }
    group.coloris.add(coloris)
    if (row.id > group.maxId) group.maxId = row.id
    const stamp = row.updated_at ?? row.created_at
    if (stamp > group.at) group.at = stamp
    // Un batch encore en file/en cours n'est pas « terminé » → pas de notification
    // (la page produit le montre déjà en direct).
    if (row.status === 'queued' || row.status === 'running') group.pending = true

    const isFinal =
      row.type === 'integration' || row.type === 'pose-fusion' || row.type === 'marketplace'
    group.cells.set(`${coloris}|${w}x${h}|${format}`, {
      format,
      status: row.status,
      delivered: isFinal && row.status === 'done',
    })
  }

  // Noms de produits en une requête.
  const ids = Array.from(new Set(Array.from(byBatch.values()).map((g) => g.productId)))
  const names = new Map<number, string>()
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',')
    const prod = db
      .prepare(`SELECT id, name FROM catalog_products WHERE id IN (${placeholders})`)
      .all(...ids) as { id: number; name: string }[]
    for (const p of prod) names.set(p.id, p.name)
  }

  const out: UserNotification[] = []
  for (const [batchId, group] of byBatch) {
    if (group.pending) continue
    const cells = Array.from(group.cells.values())
    let siteDone = 0
    let marketplaceDone = 0
    let errorCount = 0
    for (const c of cells) {
      if (c.delivered) {
        if (c.format === SITE) siteDone++
        else marketplaceDone++
      } else if (c.status === 'error') {
        errorCount++
      }
    }
    if (siteDone + marketplaceDone + errorCount === 0) continue

    const doneParts: string[] = []
    if (siteDone > 0) doneParts.push(`${siteDone} MES Site`)
    if (marketplaceDone > 0) doneParts.push(`${marketplaceDone} Marketplace`)
    let message: string
    if (doneParts.length > 0) {
      message = `${doneParts.join(' + ')} terminée${siteDone + marketplaceDone > 1 ? 's' : ''}`
      if (errorCount > 0) message += ` · ${errorCount} échec${errorCount > 1 ? 's' : ''}`
    } else {
      message = `échec de génération (${errorCount})`
    }
    const kind: UserNotification['kind'] =
      errorCount > 0 ? (siteDone + marketplaceDone > 0 ? 'partial' : 'error') : 'ok'

    out.push({
      id: group.maxId,
      batchId,
      productId: group.productId,
      productName: names.get(group.productId) ?? `Produit ${group.productId}`,
      colorisList: Array.from(group.coloris),
      siteDone,
      marketplaceDone,
      errorCount,
      kind,
      message,
      at: group.at,
      source: 'catalogue',
    })
  }

  // Décors générés (Bibliothèque et page produit) — un job = une notification.
  // Les essais du Lab moteur n'apparaissent jamais ; un lot de N tirages donne
  // N lignes (borné à 4 par lancement, acceptable en v1).
  const decorRows = db
    .prepare(
      `SELECT * FROM jobs
       WHERE created_by = ? AND type = 'decor' AND status IN ('done', 'error')
         AND json_extract(payload, '$.lab') IS NULL
       ORDER BY id DESC LIMIT ?`
    )
    .all(username, limit) as JobRow[]
  for (const row of decorRows) {
    let payload: { name?: unknown; slug?: unknown; nameSuffix?: unknown } = {}
    try {
      payload = row.payload ? JSON.parse(row.payload) : {}
    } catch {
      continue
    }
    const base =
      (typeof payload.name === 'string' && payload.name.trim()) ||
      (typeof payload.slug === 'string' && payload.slug) ||
      'Décor'
    const name = base + (typeof payload.nameSuffix === 'string' ? payload.nameSuffix : '')
    const ok = row.status === 'done'
    out.push({
      id: row.id,
      batchId: `decor-${row.id}`,
      productId: 0,
      productName: name,
      colorisList: [],
      siteDone: 0,
      marketplaceDone: 0,
      errorCount: ok ? 0 : 1,
      kind: ok ? 'ok' : 'error',
      message: ok ? 'décor prêt — à valider dans la Bibliothèque' : 'échec de génération du décor',
      at: row.updated_at ?? row.created_at,
      source: 'decor',
    })
  }

  out.sort((a, b) => b.id - a.id)
  return out.slice(0, limit)
}
