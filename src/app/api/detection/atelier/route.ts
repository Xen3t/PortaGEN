import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getDb } from '@/lib/db'
import { applyAtelierClassement } from '@/lib/detection/labeling'
import { deleteAtelierExamples, getImage, labelQueue } from '@/lib/detection/store'

/**
 * Atelier d'entraînement (maquette atelier-detection-v4, validée 24/07/2026).
 * GET    : file des images à classer — les moins sûres d'abord.
 * POST   : un classement = { imageId, vue, coloris? } → exemples enregistrés
 *          (source « atelier », prioritaire sur toute récolte automatique).
 * DELETE : annule les classements à la main d'une image (?imageId=) — elle
 *          revient dans la file (bouton « Annuler » / reclassement, 27/07).
 */

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 12))
  const items = labelQueue(limit).map((row) => ({
    imageId: row.id,
    productId: row.product_id,
    productName: row.productName,
    family: row.family,
    relPath: row.rel_path,
    fichier: path.basename(row.rel_path),
    url: `/api/catalogue/${row.product_id}/fichier?p=${encodeURIComponent(row.rel_path)}`,
    pred: row.pred_vue,
    predConf: row.pred_vue_conf,
    predWhy: row.pred_vue_why,
  }))
  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  const imageId = Number(body?.imageId)
  if (!imageId) return NextResponse.json({ error: 'Classement incomplet' }, { status: 400 })
  const result = await applyAtelierClassement({
    imageId,
    vue: typeof body?.vue === 'string' ? body.vue : '',
    coloris: typeof body?.coloris === 'string' ? body.coloris : null,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, vue: result.vue, coloris: result.coloris })
}

export async function DELETE(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const imageId = Number(req.nextUrl.searchParams.get('imageId'))
  if (!imageId) return NextResponse.json({ error: 'Image manquante' }, { status: 400 })
  const db = getDb()
  const image = getImage(imageId, db)
  if (!image) return NextResponse.json({ error: 'Image inconnue' }, { status: 404 })
  const removed = deleteAtelierExamples(image.product_id, image.rel_path, db)
  return NextResponse.json({ ok: true, removed })
}
