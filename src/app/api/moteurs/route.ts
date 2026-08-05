import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getDb } from '@/lib/db'
import { MOTEURS, moteurForFamily, type MoteurKey } from '@/lib/moteurs'
import { MOTEURS_DA } from '@/lib/moteursDa'

/**
 * Liste des moteurs (Admin → Réglages par moteur). Le nombre de produits
 * rattachés vient du catalogue, par famille — le rattachement produit → moteur
 * est AUTOMATIQUE (cadrage 13/07/2026).
 *
 * Bascule « décor autour » (05/08/2026, séparation totale) : la réponse sert les
 * DEUX générations — `methode: 'legacy'` (battant/coulissant/portillon) et
 * `methode: 'decor-autour'` (janus/terminus/forculus). Un moteur décor autour
 * dessert les mêmes produits catalogue que son homologue legacy (même famille).
 */
const DA_FAMILLE_SOURCE: Record<string, MoteurKey> = {
  janus: 'battant',
  terminus: 'coulissant',
  forculus: 'portillon',
}

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
    moteurs: [
      ...MOTEURS.map((m) => ({
        ...m,
        methode: 'legacy' as const,
        productCount: counts.get(m.key) ?? 0,
      })),
      ...MOTEURS_DA.map((m) => ({
        ...m,
        methode: 'decor-autour' as const,
        productCount: counts.get(DA_FAMILLE_SOURCE[m.key]) ?? 0,
      })),
    ],
  })
}
