import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { listUsers, createUser } from '@/lib/auth/store'

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({ users: listUsers() })
}

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  try {
    const user = createUser(
      String(body?.username ?? ''),
      String(body?.password ?? ''),
      body?.role === 'admin' ? 'admin' : 'user'
    )
    return NextResponse.json({ user })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Création impossible' },
      { status: 400 }
    )
  }
}
