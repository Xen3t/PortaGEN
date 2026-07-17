import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { listProductLaunches } from '@/lib/catalogue/launches'

/**
 * Historique « Derniers lancements » d'une page produit (bloc 3.4). Regroupe les
 * jobs catalogue par batch — sert à réafficher, Reprendre et Dupliquer un
 * lancement. Léger, relu par la grille en même temps que les générations.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  return NextResponse.json({ launches: listProductLaunches(Number(id)) })
}
