import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getDb } from '@/lib/db'
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
    // Pieds de soutien : null = pas encore jugé (le juge vision tranchera au
    // premier rendu), true/false = verdict enregistré ou choix manuel.
    pieds: product.pieds === null ? null : product.pieds === 1,
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

/**
 * Drapeau « pieds de soutien » de la fiche (29/07/2026) : true/false = choix
 * manuel (corrige le juge vision), null = remettre « à juger » (le juge
 * retranchera au prochain rendu).
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const product = getCatalogProduct(Number(id))
  if (!product) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })
  const body = await req.json().catch(() => null)
  if (!body || !('pieds' in body) || (body.pieds !== null && typeof body.pieds !== 'boolean')) {
    return NextResponse.json({ error: 'pieds doit valoir true, false ou null' }, { status: 400 })
  }
  getDb()
    .prepare('UPDATE catalog_products SET pieds = ? WHERE id = ?')
    .run(body.pieds === null ? null : body.pieds ? 1 : 0, product.id)
  return NextResponse.json({ ok: true, pieds: body.pieds })
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
