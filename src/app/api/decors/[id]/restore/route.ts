import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getDecor, restoreDecorVersion } from '@/lib/db/decors'

/** Retour arrière : une ancienne version du décor redevient la version courante. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const decor = getDecor(Number(id))
  if (!decor) return NextResponse.json({ error: 'Décor introuvable' }, { status: 404 })
  const body = await req.json().catch(() => null)
  const versionId = Number(body?.versionId)
  if (!Number.isInteger(versionId) || versionId <= 0) {
    return NextResponse.json({ error: 'versionId requis' }, { status: 400 })
  }
  const restored = restoreDecorVersion(decor.id, versionId)
  if (!restored) return NextResponse.json({ error: 'Version introuvable' }, { status: 404 })
  return NextResponse.json({ ok: true, version: restored })
}
