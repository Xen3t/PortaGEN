import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import {
  getCatalogProduct,
  rescanCatalogProduct,
  type CatalogProductRow,
} from '@/lib/catalogue/scan'
import { warmProductThumbs } from '@/lib/catalogue/thumbs'
import { listColorisOverrides } from '@/lib/catalogue/colorisOverride'

function parseNewRefs(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as string[]) : []
  } catch {
    return []
  }
}

function serialize(product: CatalogProductRow) {
  return {
    id: product.id,
    brand: product.brand,
    family: product.family,
    name: product.name,
    serverPath: product.server_path,
    status: product.status,
    lastScanAt: product.last_scan_at,
    summary: JSON.parse(product.summary),
    colorisOverrides: listColorisOverrides(product.id),
    newRefs: parseNewRefs(product.new_refs),
  }
}

/**
 * Détail d'une page produit. La consultation déclenche la génération des
 * miniatures DU produit en tâche de fond (modèle « à la consultation »,
 * décision Mathias 12/07/2026).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const product = getCatalogProduct(Number(id))
  if (!product) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })
  void warmProductThumbs(product).catch(() => undefined)
  return NextResponse.json(serialize(product))
}

/** Rescan de CE produit uniquement (bouton ↻ de la page produit). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const product = await rescanCatalogProduct(Number(id))
  if (!product) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })
  void warmProductThumbs(product).catch(() => undefined)
  return NextResponse.json(serialize(product))
}
