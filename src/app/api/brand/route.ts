import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { BRANDS, getUserBrand, isBrandKey, setUserBrand } from '@/lib/brands'

/** Marque active de l'utilisateur courant (profil de l'app, navigation v2). */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({ brand: getUserBrand(auth.id), brands: BRANDS })
}

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  if (!isBrandKey(body?.brand)) {
    return NextResponse.json({ error: 'Marque inconnue' }, { status: 400 })
  }
  setUserBrand(auth.id, body.brand)
  return NextResponse.json({ ok: true, brand: body.brand })
}
