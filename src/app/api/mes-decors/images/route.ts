import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { addMesDecorImage, removeMesDecorImage } from '@/lib/db/mesDecors'

/**
 * IMAGES DE RÉFÉRENCE d'un décor de MES Contrainte (08/08/2026) : jointes à
 * l'appel Nano comme inspiration d'ambiance. Ajout/retrait ouverts à tous les
 * utilisateurs connectés (l'édition des décors est collective — seule la
 * suppression du décor et le choix du défaut sont admin, voir ../route.ts).
 */

const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const MAX_OCTETS = 15 * 1024 * 1024

/** Ajout : multipart { id, file }. */
export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  const id = Number(form.get('id'))
  const file = form.get('file')
  if (!Number.isInteger(id) || !(file instanceof File)) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  }
  if (!EXTENSIONS.has(path.extname(file.name).toLowerCase())) {
    return NextResponse.json({ error: 'Formats acceptés : PNG, JPG, WebP.' }, { status: 400 })
  }
  if (file.size > MAX_OCTETS) {
    return NextResponse.json({ error: 'Image trop lourde (15 Mo maximum).' }, { status: 400 })
  }
  const decor = addMesDecorImage(id, file.name, Buffer.from(await file.arrayBuffer()))
  if (!decor) return NextResponse.json({ error: 'Décor introuvable' }, { status: 404 })
  return NextResponse.json({ decor })
}

/** Retrait : ?id=<décor>&p=<chemin relatif de l'image>. */
export async function DELETE(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const id = Number(req.nextUrl.searchParams.get('id'))
  const p = req.nextUrl.searchParams.get('p') ?? ''
  if (!Number.isInteger(id) || !p) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  }
  const decor = removeMesDecorImage(id, p)
  if (!decor) return NextResponse.json({ error: 'Décor introuvable' }, { status: 404 })
  return NextResponse.json({ decor })
}
