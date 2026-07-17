import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getDecor, toggleFavorite } from '@/lib/db/decors'

/** Bascule le favori — propre à l'utilisateur connecté (décision Mathias 09/07/2026). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const decor = getDecor(Number(id))
  if (!decor) return NextResponse.json({ error: 'Décor introuvable' }, { status: 404 })
  const favorite = toggleFavorite(auth.id, decor.id)
  return NextResponse.json({ ok: true, favorite })
}
