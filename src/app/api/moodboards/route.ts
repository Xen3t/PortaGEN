import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { deleteMoodboard, saveMoodboard } from '@/lib/server/moodboards'

/**
 * Gestion des moodboards — ADMIN (gestion des référentiels, cadrage §11).
 * POST   : ajout (multipart, champ « file », champ « name » facultatif)
 * DELETE : suppression ({ path })
 */
export async function POST(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: 'Aucun fichier reçu' }, { status: 400 })
  }
  const requestedName = typeof form.get('name') === 'string' ? String(form.get('name')) : undefined
  const buffer = Buffer.from(await file.arrayBuffer())
  const res = saveMoodboard(buffer, file.name, requestedName)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json(res)
}

export async function DELETE(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  if (typeof body?.path !== 'string') {
    return NextResponse.json({ error: 'Chemin manquant' }, { status: 400 })
  }
  const res = deleteMoodboard(body.path)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json(res)
}
