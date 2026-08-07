import fs from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { resoudreSousLot } from '@/lib/banc'
import { getProduitDescription, saveProduitDescription } from '@/lib/db/produitDescriptions'
import { decrireProduit } from '@/lib/genai/descriptionProduit'
import { moteurDaDef } from '@/lib/moteursDa'
import { parseProduitFromFileName } from '@/lib/productName'

/**
 * BANC « génération & resizing » — étape DESCRIPTION (rodage 07/08, décision
 * Mathias) : le brief matière/structure du produit, injecté au prompt via
 * {PRODUIT}. Bibliothèque d'abord — clé (produit, coloris, moteur) — sinon UN
 * appel vision imposant, enregistré pour toutes les prochaines fois.
 */
export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth

  let body: {
    lot?: string
    productPath?: string
    name?: string
    coloris?: string
    moteur?: string
    /** true = IGNORER la bibliothèque : nouvel appel vision + écrasement de
     *  l'entrée (bouton « forcer la vision », 07/08). */
    force?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  }

  const moteur = moteurDaDef(String(body.moteur ?? 'janus'))
  if (!moteur) {
    return NextResponse.json({ error: 'Ce moteur n’est pas encore disponible.' }, { status: 400 })
  }
  const name = String(body.name ?? '')
  const coloris = typeof body.coloris === 'string' ? body.coloris : ''
  // Nom produit depuis le nom de fichier (même parseur que partout) — sans nom
  // reconnu, pas de clé de bibliothèque fiable : on décrit quand même mais sous
  // le nom de fichier nettoyé, faute de mieux.
  const produit =
    parseProduitFromFileName(name) || name.replace(/\.[a-z0-9]+$/i, '').slice(0, 60) || 'PRODUIT'

  try {
    const existante = body.force === true ? undefined : getProduitDescription(produit, coloris, moteur.key)
    if (existante) {
      return NextResponse.json({
        produit,
        description: existante.description,
        source: 'bibliotheque',
      })
    }

    const full = resoudreSousLot(String(body.lot ?? ''), String(body.productPath ?? ''))
    const { description, model } = await decrireProduit(fs.readFileSync(full))
    saveProduitDescription(produit, coloris, moteur.key, description, model)
    return NextResponse.json({ produit, description, source: 'vision' })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    )
  }
}
