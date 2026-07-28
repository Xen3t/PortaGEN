import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getDb } from '@/lib/db'

/** Suppression d'un décor Libre — par son auteur ou par un admin. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const decorId = Number(id)
  if (!Number.isInteger(decorId) || decorId <= 0) {
    return NextResponse.json({ error: 'Identifiant invalide' }, { status: 400 })
  }
  const db = getDb()
  const row = db.prepare('SELECT created_by FROM libre_decors WHERE id = ?').get(decorId) as
    | { created_by: string | null }
    | undefined
  if (!row) return NextResponse.json({ error: 'Décor introuvable' }, { status: 404 })
  if (auth.role !== 'admin' && row.created_by !== auth.username) {
    return NextResponse.json({ error: 'Seul son auteur (ou un admin) peut le supprimer.' }, { status: 403 })
  }
  db.prepare('DELETE FROM libre_decors WHERE id = ?').run(decorId)
  return NextResponse.json({ ok: true })
}
