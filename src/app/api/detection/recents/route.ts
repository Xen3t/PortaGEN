import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { recentAtelierExamples } from '@/lib/detection/store'

/**
 * Bande « mes derniers classements » (27/07/2026) : les derniers clics de
 * l'atelier, cliquables pour reclasser une image mal étiquetée.
 */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 20))
  const items = recentAtelierExamples(limit).map((r) => ({
    imageId: r.imageId,
    productId: r.productId,
    productName: r.productName,
    family: r.family,
    relPath: r.relPath,
    fichier: path.basename(r.relPath),
    url: `/api/catalogue/${r.productId}/fichier?p=${encodeURIComponent(r.relPath)}`,
    vue: r.vue,
    coloris: r.coloris,
  }))
  return NextResponse.json({ items })
}
