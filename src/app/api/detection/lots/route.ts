import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { applyAtelierClassement } from '@/lib/detection/labeling'
import { bulkQueue, listBulkVues, rejectFromBulk } from '@/lib/detection/store'

/**
 * Validation PAR LOTS (maquette atelier-detection-v5-lots, validée 27/07/2026).
 * GET  : vues proposées (comptes) + le lot courant d'une vue — images que l'app
 *        croit de cette vue, LES PLUS SÛRES d'abord (?vue=&offset= pour passer).
 * POST : { vue, imageIds[], rejectedIds[] } → les cochées classées d'un coup
 *        (source « atelier ») ; les DÉCOCHÉES mémorisées « pas un {vue} » —
 *        elles ne reviennent plus dans ces lots et passent en tête de la file
 *        un par un (retour Mathias 27/07 : elles revenaient au lot suivant).
 */

const LOT_SIZE = 40

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const vues = listBulkVues()
  const vue = req.nextUrl.searchParams.get('vue') ?? vues[0]?.vue ?? null
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get('offset')) || 0)
  const items = vue
    ? bulkQueue(vue, LOT_SIZE, offset).map((row) => ({
        imageId: row.id,
        productId: row.product_id,
        productName: row.productName,
        family: row.family,
        relPath: row.rel_path,
        fichier: path.basename(row.rel_path),
        url: `/api/catalogue/${row.product_id}/fichier?p=${encodeURIComponent(row.rel_path)}`,
        conf: row.pred_vue_conf,
      }))
    : []
  return NextResponse.json({ vues, vue, offset, items })
}

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  const vue = typeof body?.vue === 'string' ? body.vue.trim() : ''
  const toIds = (v: unknown) =>
    Array.isArray(v) ? (v as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0) : []
  const imageIds = toIds(body?.imageIds)
  const rejectedIds = toIds(body?.rejectedIds)
  if (!vue || (imageIds.length === 0 && rejectedIds.length === 0)) {
    return NextResponse.json({ error: 'Lot incomplet' }, { status: 400 })
  }
  if (imageIds.length > 200 || rejectedIds.length > 200) {
    return NextResponse.json({ error: 'Lot trop grand (200 maximum)' }, { status: 400 })
  }
  if (rejectedIds.length > 0) rejectFromBulk(rejectedIds, vue.toUpperCase())
  let done = 0
  for (const imageId of imageIds) {
    const result = await applyAtelierClassement({ imageId, vue })
    if (result.ok) done++
    else if (result.status === 400) {
      // Vue invalide : inutile de boucler, même erreur pour tout le lot.
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    // Image disparue entre-temps : ignorée, le reste du lot passe.
  }
  return NextResponse.json({ ok: true, done, rejected: rejectedIds.length })
}
