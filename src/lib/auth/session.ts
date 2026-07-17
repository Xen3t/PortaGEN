import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getUserBySession, SESSION_COOKIE, type UserRow } from '@/lib/auth/store'

/** Utilisateur courant côté composants serveur (pages, layouts). */
export async function getSessionUser(): Promise<UserRow | null> {
  const jar = await cookies()
  return getUserBySession(jar.get(SESSION_COOKIE)?.value)
}

/**
 * Garde d'API : retourne l'utilisateur, ou une réponse 401/403 prête à renvoyer.
 * Usage : const auth = requireApiUser(req, 'admin'); if (auth instanceof NextResponse) return auth
 */
export function requireApiUser(
  req: NextRequest,
  role?: 'admin'
): UserRow | NextResponse {
  const user = getUserBySession(req.cookies.get(SESSION_COOKIE)?.value)
  if (!user) {
    return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })
  }
  if (role === 'admin' && user.role !== 'admin') {
    return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })
  }
  return user
}
