import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { moteurDef } from '@/lib/moteurs'
import { cannyRefInfo, resetCannyRef, saveCannyRef } from '@/lib/server/cannyRef'

/**
 * Image CANNY de référence d'un moteur (Admin → Réglages par moteur, 13/07/2026).
 * GET    : infos de l'image active (personnalisée ou d'origine)
 * POST   : remplacement (multipart, champ « file ») — ADMIN
 * DELETE : retour à l'image d'origine — ADMIN
 */

/** ~30 Mo : au-delà ce n'est pas une image de référence raisonnable. */
const MAX_BYTES = 30 * 1024 * 1024

export async function GET(req: NextRequest, ctx: { params: Promise<{ moteur: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { moteur } = await ctx.params
  const def = moteurDef(moteur)
  if (!def) return NextResponse.json({ error: 'Moteur inconnu' }, { status: 404 })
  return NextResponse.json({ canny: await cannyRefInfo(def.key) })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ moteur: string }> }) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { moteur } = await ctx.params
  const def = moteurDef(moteur)
  if (!def) return NextResponse.json({ error: 'Moteur inconnu' }, { status: 404 })
  if (def.status !== 'actif') {
    return NextResponse.json({ error: `Moteur ${def.label} en préparation` }, { status: 400 })
  }
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: 'Aucun fichier reçu' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Image trop lourde (30 Mo maximum)' }, { status: 400 })
  }
  const res = await saveCannyRef(def.key, Buffer.from(await file.arrayBuffer()))
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true, canny: await cannyRefInfo(def.key) })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ moteur: string }> }) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { moteur } = await ctx.params
  const def = moteurDef(moteur)
  if (!def) return NextResponse.json({ error: 'Moteur inconnu' }, { status: 404 })
  resetCannyRef(def.key)
  return NextResponse.json({ ok: true, canny: await cannyRefInfo(def.key) })
}
