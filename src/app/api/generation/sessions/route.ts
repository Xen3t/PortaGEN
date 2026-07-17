import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { listAllSessions } from '@/lib/db/generationSessions'

/**
 * Mes sessions (maquette sessions-v2, validée le 13/07/2026) : générations
 * directes ET lancements de gamme, mélangés — les cartes de l'accueil et de la
 * page « Toutes les sessions ». Chaque résumé est recalculé depuis les jobs du
 * batch — la liste reflète donc l'avancement réel sans état à maintenir.
 */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth

  const limitRaw = Number(req.nextUrl.searchParams.get('limit'))
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50

  const sessions = listAllSessions(auth.username, limit)
  return NextResponse.json({ sessions })
}
