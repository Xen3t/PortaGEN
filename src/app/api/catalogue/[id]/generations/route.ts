import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { listProductGenerations } from '@/lib/catalogue/generations'

/**
 * État des générations LOCALES d'une page produit (bloc 3.1). Endpoint léger,
 * appelé en boucle (~3 s) par la grille tant qu'une génération est en cours —
 * ne relit pas le résumé du scan et ne réchauffe pas les miniatures.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  return NextResponse.json({ generations: listProductGenerations(Number(id)) })
}
