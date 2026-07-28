import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { exportRenames, listRenameProposals } from '@/lib/detection/renommage'

/**
 * Aide au renommage nomenclature HOORTRADE.
 * GET  : propositions de noms conformes (aperçu).
 * POST : export des COPIES renommées dans data/exports/ + recap.csv.
 * Le serveur de fichiers O:\ n'est JAMAIS modifié (règle absolue).
 */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 60))
  const productId = Number(req.nextUrl.searchParams.get('productId')) || undefined
  return NextResponse.json({ proposals: listRenameProposals(undefined, { limit, productId }) })
}

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => ({}))
  const productId = Number(body?.productId) || undefined
  try {
    const result = exportRenames(undefined, { productId })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Export impossible' },
      { status: 500 }
    )
  }
}
