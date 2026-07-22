import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { archiveLabEssais, listLabEssais } from '@/lib/db/labEssais'

/**
 * Essais du LAB (refonte lab-v1, 22/07/2026) : liste reconstruite depuis les
 * jobs `lab` en base (fini le localStorage). GET ?archives=1 pour la vue
 * Archives. POST { ids } ou { all: true } pour archiver — page Admin → LAB,
 * écriture réservée aux admins ; rien n'est supprimé.
 */

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const archived = req.nextUrl.searchParams.get('archives') === '1'
  return NextResponse.json(listLabEssais({ archived }))
}

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const body = (await req.json().catch(() => null)) as { ids?: unknown; all?: unknown } | null
  if (body?.all === true) {
    return NextResponse.json({ ok: true, archived: archiveLabEssais('all') })
  }
  const ids = Array.isArray(body?.ids) ? body.ids.filter((v): v is number => Number.isInteger(v)) : []
  if (ids.length === 0) {
    return NextResponse.json({ error: 'Aucun essai à archiver' }, { status: 400 })
  }
  return NextResponse.json({ ok: true, archived: archiveLabEssais(ids) })
}
