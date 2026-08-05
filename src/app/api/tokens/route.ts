import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getDb } from '@/lib/db'

/**
 * Chiffres de tokens affichés en tête du Journal des générations (demande
 * Mathias 05/08/2026, remplace la page Coûts API supprimée le même jour) :
 * appels Gemini et tokens de sortie — l'essentiel de la facture — par période.
 */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const db = getDb()
  const sum = (where: string) =>
    db
      .prepare(
        `SELECT COUNT(*) AS calls, COALESCE(SUM(output_tokens), 0) AS outputTokens
         FROM api_calls ${where}`
      )
      .get() as { calls: number; outputTokens: number }
  return NextResponse.json({
    // created_at est en UTC (datetime('now')) : localtime pour un « aujourd'hui » français.
    jour: sum(`WHERE date(created_at, 'localtime') = date('now', 'localtime')`),
    j7: sum(`WHERE created_at >= datetime('now', '-7 days')`),
    j30: sum(`WHERE created_at >= datetime('now', '-30 days')`),
    total: sum(''),
  })
}
