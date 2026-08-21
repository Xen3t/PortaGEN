import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { deleteUser } from '@/lib/auth/store'

/**
 * Suppression d'un compte (21/08/2026) — admin seulement. Deux garde-fous :
 * jamais son propre compte (ici, la route connaît l'appelant), jamais le
 * dernier admin (dans le store).
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  if (Number(id) === auth.id) {
    return NextResponse.json(
      { error: 'Impossible de supprimer son propre compte.' },
      { status: 400 }
    )
  }
  try {
    deleteUser(Number(id))
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Suppression impossible' },
      { status: 400 }
    )
  }
}
