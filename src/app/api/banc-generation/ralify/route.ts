import path from 'node:path'
import fs from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { config } from '@/lib/config'
import { resoudreSousLot } from '@/lib/banc'
import { appliquerRalify } from '@/lib/images/ralify'
import { resolveRalifyCible } from '@/lib/ralify'
import { getMoteurDaReglages, moteurDaDef } from '@/lib/moteursDa'

/**
 * BANC « génération & resizing » — étape 2/3 : RALIFY. Applique la correction
 * RAL du moteur au PNG détouré (mêmes règles que le pipeline : cible résolue
 * depuis le réglage + nom + coloris, null = ne pas toucher) et enregistre le
 * résultat dans le lot. Le client enchaîne ensuite /pose.
 */

function rel(full: string): string {
  return path.relative(config.rootDir, full)
}

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth

  let body: { lot?: string; moteur?: string; productPath?: string; name?: string; coloris?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  }

  const moteur = moteurDaDef(String(body.moteur ?? 'janus'))
  if (!moteur) {
    return NextResponse.json({ error: 'Ce moteur n’est pas encore disponible.' }, { status: 400 })
  }

  try {
    const full = resoudreSousLot(String(body.lot ?? ''), String(body.productPath ?? ''))
    const reglages = getMoteurDaReglages(moteur.key)
    const cible = resolveRalifyCible(
      reglages.ralify,
      String(body.name ?? path.basename(full)),
      typeof body.coloris === 'string' ? body.coloris : ''
    )
    // RALify inactif (réglage moteur ou coloris hors cible) : rien à faire.
    if (!cible) return NextResponse.json({ ralifyPath: null, cible: null })

    const ralify = await appliquerRalify(fs.readFileSync(full), cible, reglages.ralify.intensite)
    const ralifyFull = full.replace(/\.png$/i, '') + '-ralify.png'
    fs.writeFileSync(ralifyFull, ralify.image)
    return NextResponse.json({ ralifyPath: rel(ralifyFull), cible })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    )
  }
}
