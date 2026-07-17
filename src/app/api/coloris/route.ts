import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { addColoris, listAllColoris, removeColoris } from '@/lib/catalogue/colorisStore'

/**
 * Palette de coloris (fiche moteur → Reconnaissance du coloris, 13/07/2026).
 * GET    : palette complète (origine + ajoutés) — tous les connectés
 * POST   : ajout d'un coloris ({ label, ral?, swatch }) — ADMIN
 * DELETE : suppression d'un coloris ajouté ({ key }) — ADMIN
 */

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({ coloris: listAllColoris() })
}

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  if (typeof body?.label !== 'string' || typeof body?.swatch !== 'string') {
    return NextResponse.json({ error: 'Requête invalide (label et swatch requis)' }, { status: 400 })
  }
  const res = addColoris({ label: body.label, ral: body.ral ?? null, swatch: body.swatch })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true, coloris: listAllColoris() })
}

export async function DELETE(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  if (typeof body?.key !== 'string') {
    return NextResponse.json({ error: 'Clé de coloris manquante' }, { status: 400 })
  }
  const res = removeColoris(body.key)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true, coloris: listAllColoris() })
}
