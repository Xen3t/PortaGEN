import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getDecorByPath } from '@/lib/db/decors'

/** Retrouve un décor par le chemin de son image (jobs antérieurs sans decorId). */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const p = req.nextUrl.searchParams.get('p')
  if (!p) return NextResponse.json({ error: 'Paramètre p manquant' }, { status: 400 })
  const decor = getDecorByPath(p)
  if (!decor) return NextResponse.json({ error: 'Décor introuvable' }, { status: 404 })
  return NextResponse.json({ decor })
}
