import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getCatalogProduct } from '@/lib/catalogue/scan'
import { listColorisSettings, saveColorisSettings } from '@/lib/catalogue/defaults'

/**
 * Réglages par défaut par coloris d'une gamme (maquette v6). Lecture et
 * écriture ouvertes à toute l'équipe — « je ne suis pas la police ».
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const product = getCatalogProduct(Number(id))
  if (!product) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })
  return NextResponse.json({ settings: listColorisSettings(product.id) })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const product = getCatalogProduct(Number(id))
  if (!product) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })
  const body = await req.json().catch(() => null)
  const coloris = typeof body?.coloris === 'string' ? body.coloris.trim() : ''
  if (!coloris || coloris.length > 60) {
    return NextResponse.json({ error: 'Coloris manquant ou invalide' }, { status: 400 })
  }
  const saved = saveColorisSettings(product.id, coloris, body?.settings)
  return NextResponse.json({ ok: true, coloris, settings: saved })
}
