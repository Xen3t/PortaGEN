import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { config } from '@/lib/config'
import {
  addDecorTags,
  decorUsedByValidatedJob,
  deleteDecorRow,
  getDecor,
  listDecorVersions,
  sanitizeTags,
  updateDecor,
} from '@/lib/db/decors'

/**
 * Actions groupées sur une sélection de décors :
 *   archive          — sortie de circulation (ouvert à tous)
 *   tag              — ajoute des tags (ouvert à tous)
 *   gamme            — change la gamme de rangement (ouvert à tous)
 *   delete           — suppression définitive (ADMIN ; les décors ayant servi à
 *                      une génération validée sont ignorés et signalés)
 */
export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  const ids: number[] = Array.isArray(body?.ids)
    ? body.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
    : []
  const action = body?.action
  if (ids.length === 0 || !['archive', 'tag', 'gamme', 'delete'].includes(action)) {
    return NextResponse.json({ error: 'Requête invalide (ids + action requis)' }, { status: 400 })
  }
  if (action === 'delete' && auth.role !== 'admin') {
    return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })
  }
  const tags = action === 'tag' ? sanitizeTags(body?.tags) : []
  if (action === 'tag' && tags.length === 0) {
    return NextResponse.json({ error: 'Aucun tag fourni' }, { status: 400 })
  }
  const gamme =
    action === 'gamme' && typeof body?.gamme === 'string' && body.gamme.trim()
      ? body.gamme.trim().slice(0, 80)
      : null
  if (action === 'gamme' && !gamme) {
    return NextResponse.json({ error: 'Aucune gamme fournie' }, { status: 400 })
  }

  let done = 0
  const skipped: string[] = []
  for (const id of ids) {
    const decor = getDecor(id)
    if (!decor) continue
    if (action === 'archive') {
      updateDecor(id, { status: 'archive' })
      done++
    } else if (action === 'tag') {
      addDecorTags(id, tags)
      done++
    } else if (action === 'gamme') {
      updateDecor(id, { gamme })
      done++
    } else if (action === 'delete') {
      if (decorUsedByValidatedJob(decor.file_path)) {
        skipped.push(decor.name)
        continue
      }
      const paths = new Set([
        decor.file_path,
        ...listDecorVersions(decor.id).map((v) => v.file_path),
      ])
      for (const rel of paths) {
        const abs = path.resolve(config.rootDir, rel)
        if (abs.startsWith(path.resolve(config.artifactsDir) + path.sep) && fs.existsSync(abs)) {
          fs.rmSync(abs)
        }
      }
      deleteDecorRow(id)
      done++
    }
  }
  return NextResponse.json({ ok: true, done, skipped })
}
