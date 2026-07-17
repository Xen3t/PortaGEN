import { NextRequest, NextResponse } from 'next/server'
import { authenticate, createSession, SESSION_COOKIE } from '@/lib/auth/store'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!username || !password) {
    return NextResponse.json({ error: 'Identifiants requis' }, { status: 400 })
  }
  const user = authenticate(username, password)
  if (!user) {
    return NextResponse.json({ error: 'Identifiants incorrects' }, { status: 401 })
  }
  const { token, maxAge } = createSession(user.id)
  const res = NextResponse.json({ user: { username: user.username, role: user.role } })
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
