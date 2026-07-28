import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getDb } from '@/lib/db'

/**
 * Décors Libres (28/07/2026) : descriptions photographiques nommées, PARTAGÉES
 * entre utilisateurs, rechargeables d'un clic sur l'écran MES Libre. Filtrées
 * par profil de réglages (portail, clim, pergola…).
 */

export interface LibreDecorRow {
  id: number
  name: string
  profil: string
  description: string
  created_by: string | null
  created_at: string
}

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const profil = req.nextUrl.searchParams.get('profil')
  const db = getDb()
  const rows = (
    profil
      ? db.prepare('SELECT * FROM libre_decors WHERE profil = ? ORDER BY id DESC').all(profil)
      : db.prepare('SELECT * FROM libre_decors ORDER BY id DESC').all()
  ) as LibreDecorRow[]
  return NextResponse.json({ decors: rows })
}

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : ''
  const profil = typeof body?.profil === 'string' ? body.profil.trim().slice(0, 40) : ''
  const description =
    typeof body?.description === 'string' ? body.description.trim().slice(0, 4000) : ''
  if (!name || !profil || !description) {
    return NextResponse.json({ error: 'Nom, profil et description sont requis.' }, { status: 400 })
  }
  const db = getDb()
  const r = db
    .prepare('INSERT INTO libre_decors (name, profil, description, created_by) VALUES (?, ?, ?, ?)')
    .run(name, profil, description, auth.username)
  const row = db
    .prepare('SELECT * FROM libre_decors WHERE id = ?')
    .get(Number(r.lastInsertRowid)) as LibreDecorRow
  return NextResponse.json({ decor: row })
}
