import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { listerRendus } from '@/lib/decorAutour'

/** Rendus « décor autour » déjà produits (relus du disque, plus récent d'abord). */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(listerRendus())
}
