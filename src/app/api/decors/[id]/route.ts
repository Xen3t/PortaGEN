import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { config } from '@/lib/config'
import {
  DECOR_ANGLES,
  DECOR_STATUSES,
  DECOR_TYPES,
  decorUsedByValidatedJob,
  deleteDecorRow,
  getDecor,
  listDecorVersions,
  sanitizeTags,
  setDecorTags,
  updateDecor,
  type DecorRow,
} from '@/lib/db/decors'

/** Détail d'un décor avec son historique de versions. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const decor = getDecor(Number(id))
  if (!decor) return NextResponse.json({ error: 'Décor introuvable' }, { status: 404 })
  return NextResponse.json({ decor, versions: listDecorVersions(decor.id) })
}

/**
 * Édition d'un décor. Ouvert à toute l'équipe (nom, gamme, type, angle, tags,
 * archivage) ; le passage « À valider » ⇄ « Actif » est réservé à l'admin.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const decor = getDecor(Number(id))
  if (!decor) return NextResponse.json({ error: 'Décor introuvable' }, { status: 404 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 })
  }

  const fields: Partial<Pick<DecorRow, 'name' | 'gamme' | 'type' | 'angle' | 'status'>> = {}
  if (typeof body.name === 'string' && body.name.trim()) fields.name = body.name.trim().slice(0, 120)
  if (body.gamme !== undefined) {
    fields.gamme = typeof body.gamme === 'string' && body.gamme.trim() ? body.gamme.trim().slice(0, 80) : null
  }
  if (body.type !== undefined) {
    if (!DECOR_TYPES.includes(body.type)) {
      return NextResponse.json({ error: 'Type invalide' }, { status: 400 })
    }
    fields.type = body.type
  }
  if (body.angle !== undefined) {
    if (!DECOR_ANGLES.includes(body.angle)) {
      return NextResponse.json({ error: 'Angle invalide' }, { status: 400 })
    }
    fields.angle = body.angle
  }
  if (body.status !== undefined) {
    if (!DECOR_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Statut invalide' }, { status: 400 })
    }
    // Archiver / désarchiver (retour « À valider ») : ouvert à tous.
    // Rendre un décor ACTIF (validation) : admin uniquement.
    if (body.status === 'actif' && decor.status !== 'actif' && auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'La validation d’un décor est réservée aux administrateurs' },
        { status: 403 }
      )
    }
    fields.status = body.status
  }

  updateDecor(decor.id, fields)
  if (Array.isArray(body.tags)) setDecorTags(decor.id, sanitizeTags(body.tags))
  return NextResponse.json({ ok: true })
}

/**
 * Suppression DÉFINITIVE (fichier + base) : admin uniquement, refusée si le
 * décor a servi à une génération validée (traçabilité) → archiver à la place.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const decor = getDecor(Number(id))
  if (!decor) return NextResponse.json({ error: 'Décor introuvable' }, { status: 404 })
  if (decorUsedByValidatedJob(decor.file_path)) {
    return NextResponse.json(
      {
        error:
          'Ce décor a servi à une génération validée : il ne peut pas être supprimé (traçabilité). Archivez-le à la place.',
      },
      { status: 409 }
    )
  }
  // Toutes les versions partent avec le décor (fichiers du dossier artifacts uniquement).
  const paths = new Set([decor.file_path, ...listDecorVersions(decor.id).map((v) => v.file_path)])
  for (const rel of paths) {
    const abs = path.resolve(config.rootDir, rel)
    if (abs.startsWith(path.resolve(config.artifactsDir) + path.sep) && fs.existsSync(abs)) {
      fs.rmSync(abs)
    }
  }
  deleteDecorRow(decor.id)
  return NextResponse.json({ ok: true })
}
