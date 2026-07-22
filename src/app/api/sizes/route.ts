import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { listSizes } from '@/lib/db'
import { isGabaritSetKey } from '@/lib/gabaritSets'

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  // ?moteur=portillon — chaque moteur a SON référentiel de tailles (13/07/2026).
  // « coulissant-xl » = jeu Gabarits XL du coulissant (22/07/2026).
  const moteurParam = req.nextUrl.searchParams.get('moteur')
  const moteur = moteurParam && isGabaritSetKey(moteurParam) ? moteurParam : 'battant'
  return NextResponse.json({
    sizes: listSizes(undefined, moteur).map((s) => ({ w: s.width_cm, h: s.height_cm, label: s.label })),
  })
}
