import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getUserBrand } from '@/lib/brands'
import { listCatalogProducts, runCatalogScan, type GammeSummary } from '@/lib/catalogue/scan'
import { getDb } from '@/lib/db'
import { getServerRoot } from '@/lib/db/settings'

/**
 * Catalogue vivant : liste des pages produit (GET) et rafraîchissement par
 * scan LECTURE SEULE du serveur (POST — ouvert à toute l'équipe, cadrage §6).
 * La liste est ALLÉGÉE (compteurs seulement, ~3 % du poids du résumé complet) :
 * elle part à chaque navigation — le détail complet vit sur /api/catalogue/[id].
 */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  // MES générées PAR PORTAGEN, par gamme (badge des cartes, demande Mathias
  // 13/07/2026) : les jobs lancés depuis une fiche portent payload.catalogProductId ;
  // une MES livrée = un job d'intégration terminé (le passage MP décline la même
  // MES — pas compté deux fois).
  const mesPortagenByProduct = new Map<number, number>()
  const rows = getDb()
    .prepare(
      `SELECT json_extract(payload, '$.catalogProductId') AS pid, COUNT(*) AS n
       FROM jobs
       WHERE type IN ('integration', 'pose-fusion') AND status = 'done'
         AND json_extract(payload, '$.catalogProductId') IS NOT NULL
       GROUP BY pid`
    )
    .all() as { pid: number; n: number }[]
  for (const row of rows) mesPortagenByProduct.set(Number(row.pid), row.n)

  const products = listCatalogProducts().map((p) => {
    const summary = JSON.parse(p.summary) as GammeSummary
    let aDetourer = 0
    const coloris = new Set<string>()
    // Vignette de la carte (demande Mathias 13/07/2026) : une PHOTO PRODUIT de
    // face — jamais une MES (summary.mes est ignoré). JPG face en premier choix,
    // sinon PNG détouré ; null si la gamme n'a aucun visuel de face.
    let coverJpg: string | null = null
    let coverPng: string | null = null
    for (const size of summary.sizes) {
      for (const c of size.coloris) {
        coloris.add(c.coloris)
        if (c.faceJpg && !c.facePng) aDetourer += 1
        if (!coverJpg && c.faceJpg) coverJpg = c.faceJpg
        if (!coverPng && c.facePng) coverPng = c.facePng
      }
    }
    return {
      id: p.id,
      brand: p.brand,
      family: p.family,
      name: p.name,
      status: p.status,
      lastScanAt: p.last_scan_at,
      cover: coverJpg ?? coverPng,
      mesPortagen: mesPortagenByProduct.get(p.id) ?? 0,
      counts: {
        sizes: summary.sizes.length,
        coloris: coloris.size,
        mes: summary.mes.length,
        aDetourer,
      },
    }
  })
  return NextResponse.json({ products, serverRoot: getServerRoot(), brand: getUserBrand(auth.id) })
}

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  try {
    const report = await runCatalogScan()
    return NextResponse.json({ ok: true, report })
  } catch (err) {
    return NextResponse.json(
      { error: `Scan impossible : ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
