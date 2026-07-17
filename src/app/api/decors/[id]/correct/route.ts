import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getDecor } from '@/lib/db/decors'
import { enqueueNewJob } from '@/lib/server/runner'

/**
 * Prompt correctif sur un décor : la consigne de l'opérateur part en job
 * « decor-fix » ; le résultat devient une nouvelle version courante du décor
 * (historique conservé, retour arrière possible), repassée « À valider ».
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const decor = getDecor(Number(id))
  if (!decor) return NextResponse.json({ error: 'Décor introuvable' }, { status: 404 })
  const body = await req.json().catch(() => null)
  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : ''
  if (!instruction) {
    return NextResponse.json({ error: 'Écrivez la correction à appliquer' }, { status: 400 })
  }
  if (instruction.length > 2000) {
    return NextResponse.json({ error: 'Consigne trop longue (2000 caractères max)' }, { status: 400 })
  }
  const jobId = enqueueNewJob(
    'decor-fix',
    { decorId: decor.id, instruction },
    undefined,
    auth.username
  )
  return NextResponse.json({ jobId })
}
