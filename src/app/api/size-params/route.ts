import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import {
  getGabaritGlobals,
  listSizeParamsOverrides,
  saveGabaritGlobals,
  saveSizeParamsOverride,
  sanitizeSizeParams,
} from '@/lib/db/sizeParams'
import { moteurDef, type MoteurKey } from '@/lib/moteurs'

/**
 * Réglages de gabarit (globaux + par taille) : lecture pour tous, écriture admin.
 * PAR MOTEUR (règle 13/07/2026 : jamais partagés) — `?moteur=` en GET, champ
 * `moteur` dans le corps en écriture. Absent = battant (clés historiques).
 */
function parseMoteur(value: unknown): MoteurKey | null {
  if (value === undefined || value === null || value === '') return 'battant'
  return typeof value === 'string' && moteurDef(value) ? (value as MoteurKey) : null
}

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const moteur = parseMoteur(req.nextUrl.searchParams.get('moteur') ?? undefined)
  if (!moteur) return NextResponse.json({ error: 'Moteur inconnu' }, { status: 400 })
  return NextResponse.json({
    overrides: listSizeParamsOverrides(moteur),
    globals: getGabaritGlobals(moteur),
  })
}

/** Dérogation d'une taille (params: null pour revenir aux réglages globaux). */
export async function PUT(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  const moteur = parseMoteur(body?.moteur)
  if (!moteur) return NextResponse.json({ error: 'Moteur inconnu' }, { status: 400 })
  const label = typeof body?.label === 'string' ? body.label : ''
  if (!/^\d{3}x\d{2,3}$/.test(label)) {
    return NextResponse.json({ error: 'Taille invalide' }, { status: 400 })
  }
  if (body?.params === null) {
    saveSizeParamsOverride(label, null, moteur)
    return NextResponse.json({ ok: true, removed: true })
  }
  const params = sanitizeSizeParams(body?.params)
  if (!params) {
    return NextResponse.json({ error: 'Aucun réglage valide fourni' }, { status: 400 })
  }
  saveSizeParamsOverride(label, params, moteur)
  return NextResponse.json({ ok: true, params })
}

/** Réglages GLOBAUX (toutes les tailles du moteur, sauf dérogations). */
export async function PATCH(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  const moteur = parseMoteur(body?.moteur)
  if (!moteur) return NextResponse.json({ error: 'Moteur inconnu' }, { status: 400 })
  const globals = sanitizeSizeParams(body?.globals) ?? {}
  saveGabaritGlobals(globals, moteur)
  return NextResponse.json({ ok: true, globals })
}
