import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getCatalogProduct } from '@/lib/catalogue/scan'
import { listColorisOverrides, saveColorisOverride } from '@/lib/catalogue/colorisOverride'

/**
 * Correction manuelle du coloris d'une carte de la fiche produit (clic sur le
 * nom de la couleur → menu déroulant). Ouvert à toute l'équipe, comme les autres
 * réglages de la fiche.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const product = getCatalogProduct(Number(id))
  if (!product) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })
  return NextResponse.json({ overrides: listColorisOverrides(product.id) })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const product = getCatalogProduct(Number(id))
  if (!product) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })
  const body = await req.json().catch(() => null)
  const colorisKey = typeof body?.colorisKey === 'string' ? body.colorisKey.trim() : ''
  const coloris = typeof body?.coloris === 'string' ? body.coloris.trim() : ''
  if (!colorisKey || colorisKey.length > 60) {
    return NextResponse.json({ error: 'Coloris d’origine manquant' }, { status: 400 })
  }
  try {
    const label = saveColorisOverride(product.id, colorisKey, coloris)
    return NextResponse.json({ ok: true, colorisKey, coloris: label })
  } catch {
    return NextResponse.json({ error: 'Coloris inconnu' }, { status: 400 })
  }
}
