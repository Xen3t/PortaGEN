import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import {
  MOTEUR_REGLAGES_DEFAUTS,
  getMoteurReglages,
  moteurDef,
  patchMoteurReglages,
  sanitizeMoteurReglages,
  type MoteurReglages,
} from '@/lib/moteurs'
import { isGabaritSetKey, type GabaritSetKey } from '@/lib/gabaritSets'

/**
 * Réglages d'un moteur (Admin → Réglages par moteur) : lecture pour tous les
 * connectés, écriture ADMIN. PATCH partiel : seuls les champs fournis (et
 * valides) sont fusionnés dans les réglages existants. Depuis le 22/07/2026 la
 * clé accepte aussi le jeu « coulissant-xl » (réglages Canny de la section
 * « Canny XL » de la fiche TERMINUS).
 */
function parseJeu(value: string): GabaritSetKey | null {
  return isGabaritSetKey(value) ? value : null
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ moteur: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { moteur } = await ctx.params
  const jeu = parseJeu(moteur)
  const def = jeu ? moteurDef(jeu === 'coulissant-xl' ? 'coulissant' : jeu) : undefined
  if (!jeu || !def) return NextResponse.json({ error: 'Moteur inconnu' }, { status: 404 })
  return NextResponse.json({ moteur: def, reglages: getMoteurReglages(jeu) })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ moteur: string }> }) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { moteur } = await ctx.params
  const jeu = parseJeu(moteur)
  const def = jeu ? moteurDef(jeu === 'coulissant-xl' ? 'coulissant' : jeu) : undefined
  if (!jeu || !def) return NextResponse.json({ error: 'Moteur inconnu' }, { status: 404 })
  if (def.status !== 'actif') {
    return NextResponse.json({ error: `Moteur ${def.label} en préparation` }, { status: 400 })
  }
  const body = await req.json().catch(() => null)
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  }
  // Un champ CONNU fourni mais rejeté par la validation → 400 explicite (pas de
  // faux succès : sanitize écarte en silence, on nomme ici le champ fautif).
  const patch = sanitizeMoteurReglages(body)
  const provided = body as Record<string, unknown>
  const rejected = (Object.keys(MOTEUR_REGLAGES_DEFAUTS) as (keyof MoteurReglages)[]).filter(
    (k) => provided[k] !== undefined && patch[k] === undefined
  )
  if (rejected.length > 0) {
    return NextResponse.json(
      { error: `Valeur invalide pour : ${rejected.join(', ')}` },
      { status: 400 }
    )
  }
  return NextResponse.json({ ok: true, reglages: patchMoteurReglages(jeu, patch) })
}
