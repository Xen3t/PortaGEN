import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { genererApercuDecor } from '@/lib/genai/decorApercu'

/**
 * APERÇU d'un décor (bibliothèque 17/08, maquette bibliotheque-decors-v1) :
 * POST { id } → une image Nano 1K du décor seul, enregistrée sous
 * data/mes-decors/<id>/ et pointée par la colonne apercu. Accessible à tous
 * les utilisateurs connectés, comme la création/édition des décors.
 */
export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  const id = Number(body?.id)
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  try {
    const decor = await genererApercuDecor(id)
    return NextResponse.json({ decor })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Génération de l’aperçu impossible' },
      { status: 502 }
    )
  }
}
