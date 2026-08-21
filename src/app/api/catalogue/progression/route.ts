import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getScanProgress } from '@/lib/catalogue/scanProgress'

/** Progression du scan serveur en cours — polling de la barre du bouton Actualiser. */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(getScanProgress())
}
