import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { isGabaritSetKey, type GabaritSetKey } from '@/lib/gabaritSets'
import { moteurDef } from '@/lib/moteurs'
import { cannyRefInfo, resetCannyRef, saveCannyRef } from '@/lib/server/cannyRef'

/**
 * Image CANNY de référence d'un moteur (Admin → Réglages par moteur, 13/07/2026).
 * Depuis le 22/07/2026 la clé est un JEU DE GABARITS : « coulissant-xl » désigne
 * le CANNY XL de la fiche TERMINUS (section dédiée, EN COMPLÉMENT du CANNY
 * coulissant qui ne bouge pas).
 * GET    : infos de l'image active (personnalisée ou d'origine)
 * POST   : remplacement (multipart, champ « file ») — ADMIN
 * DELETE : retour à l'image d'origine — ADMIN
 */

/** ~30 Mo : au-delà ce n'est pas une image de référence raisonnable. */
const MAX_BYTES = 30 * 1024 * 1024

function parseJeu(value: string): GabaritSetKey | null {
  return isGabaritSetKey(value) ? value : null
}

/** Le moteur qui porte le jeu (le jeu XL appartient au coulissant TERMINUS). */
function moteurOf(jeu: GabaritSetKey) {
  return moteurDef(jeu === 'coulissant-xl' ? 'coulissant' : jeu)
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ moteur: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { moteur } = await ctx.params
  const jeu = parseJeu(moteur)
  if (!jeu) return NextResponse.json({ error: 'Moteur inconnu' }, { status: 404 })
  return NextResponse.json({ canny: await cannyRefInfo(jeu) })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ moteur: string }> }) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { moteur } = await ctx.params
  const jeu = parseJeu(moteur)
  if (!jeu) return NextResponse.json({ error: 'Moteur inconnu' }, { status: 404 })
  const def = moteurOf(jeu)
  if (!def || def.status !== 'actif') {
    return NextResponse.json({ error: `Moteur ${def?.label ?? jeu} en préparation` }, { status: 400 })
  }
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: 'Aucun fichier reçu' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Image trop lourde (30 Mo maximum)' }, { status: 400 })
  }
  const res = await saveCannyRef(jeu, Buffer.from(await file.arrayBuffer()))
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true, canny: await cannyRefInfo(jeu) })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ moteur: string }> }) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { moteur } = await ctx.params
  const jeu = parseJeu(moteur)
  if (!jeu) return NextResponse.json({ error: 'Moteur inconnu' }, { status: 404 })
  resetCannyRef(jeu)
  return NextResponse.json({ ok: true, canny: await cannyRefInfo(jeu) })
}
