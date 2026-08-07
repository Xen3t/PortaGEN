import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import {
  deleteProduitDescription,
  listProduitDescriptions,
  saveProduitDescription,
  updateProduitDescription,
} from '@/lib/db/produitDescriptions'
import { moteurDaDef } from '@/lib/moteursDa'

/**
 * Admin → Descriptions produit (maquette descriptions-produit-v3 validée le
 * 07/08/2026) : la bibliothèque des briefs vision — consulter, ajouter
 * (manuel), modifier (origine passée à « manuel »), supprimer. Admin seulement.
 */

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({ items: listProduitDescriptions() })
}

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  let body: { produit?: string; coloris?: string; moteur?: string; description?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  }
  const moteur = moteurDaDef(String(body.moteur ?? ''))
  if (!moteur) return NextResponse.json({ error: 'Catégorie inconnue.' }, { status: 400 })
  const produit = String(body.produit ?? '').trim()
  const description = String(body.description ?? '').trim()
  if (!produit) return NextResponse.json({ error: 'Nom de produit requis.' }, { status: 400 })
  if (!description) return NextResponse.json({ error: 'Description requise.' }, { status: 400 })
  saveProduitDescription(
    produit,
    String(body.coloris ?? ''),
    moteur.key,
    description,
    'manuel'
  )
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  let body: { id?: number; description?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  }
  const description = String(body.description ?? '').trim()
  if (!description) return NextResponse.json({ error: 'Description requise.' }, { status: 400 })
  if (!updateProduitDescription(Number(body.id), description)) {
    return NextResponse.json({ error: 'Entrée introuvable.' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const id = Number(req.nextUrl.searchParams.get('id'))
  if (!deleteProduitDescription(id)) {
    return NextResponse.json({ error: 'Entrée introuvable.' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
