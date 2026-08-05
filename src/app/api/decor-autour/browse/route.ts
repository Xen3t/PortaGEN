import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { listerDossier } from '@/lib/decorAutour'

/** Explorateur de dossier (data/products) pour la mini-app « décor autour ». */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const dir = req.nextUrl.searchParams.get('dir') || undefined
  try {
    return NextResponse.json(listerDossier(dir))
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    )
  }
}
