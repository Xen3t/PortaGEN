import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getDb, type JobRow } from '@/lib/db'
import { getUserBrand } from '@/lib/brands'
import { serializeJob } from '@/lib/server/serialize'

/**
 * Accueil (navigation v2) : MES dernières générations + notifications
 * dérivées (batchs terminés à valider, échecs récents). Filtré sur la marque
 * active — aujourd'hui seul CASANOOV a un moteur, les jobs sont donc tous
 * CASANOOV ; les autres marques reçoivent un état « bientôt » côté client.
 */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM jobs WHERE created_by = ? ORDER BY id DESC LIMIT 12')
    .all(auth.username) as JobRow[]
  return NextResponse.json({
    brand: getUserBrand(auth.id),
    jobs: rows.map(serializeJob),
  })
}
