import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getDb } from '@/lib/db'
import { MOTEURS, moteurForFamily } from '@/lib/moteurs'

/**
 * Liste des moteurs (Admin → Réglages par moteur). Le nombre de produits
 * rattachés vient du catalogue, par famille — le rattachement produit → moteur
 * est AUTOMATIQUE (cadrage 13/07/2026).
 */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const db = getDb()
  const rows = db
    .prepare('SELECT family, COUNT(*) AS n FROM catalog_products GROUP BY family')
    .all() as { family: string; n: number }[]
  const counts = new Map<string, number>()
  for (const r of rows) {
    const key = moteurForFamily(r.family)
    if (key) counts.set(key, (counts.get(key) ?? 0) + r.n)
  }
  return NextResponse.json({
    moteurs: MOTEURS.map((m) => ({
      ...m,
      productCount: counts.get(m.key) ?? 0,
    })),
  })
}
