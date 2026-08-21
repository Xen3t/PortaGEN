import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { authenticate, createSession, resetPassword, SESSION_COOKIE } from '@/lib/auth/store'

/**
 * Changement de mot de passe PAR L'UTILISATEUR LUI-MÊME (21/08/2026, demande
 * Mathias) — tous les rôles : mot de passe actuel exigé, les AUTRES sessions
 * sont déconnectées (resetPassword ferme tout), et la session courante est
 * recréée dans la foulée pour ne pas éjecter l'utilisateur.
 */
export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  const actuel = typeof body?.actuel === 'string' ? body.actuel : ''
  const nouveau = typeof body?.nouveau === 'string' ? body.nouveau : ''
  if (!authenticate(auth.username, actuel)) {
    return NextResponse.json({ error: 'Mot de passe actuel incorrect.' }, { status: 400 })
  }
  try {
    resetPassword(auth.id, nouveau)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Changement impossible' },
      { status: 400 }
    )
  }
  const { token, maxAge } = createSession(auth.id)
  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
  })
  return res
}
