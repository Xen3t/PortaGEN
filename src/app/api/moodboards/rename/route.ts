import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { renameMoodboard } from '@/lib/server/moodboards'

/** Renommage d'un moodboard — ADMIN. Corps : { path, newName }. */
export async function POST(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  if (typeof body?.path !== 'string' || typeof body?.newName !== 'string') {
    return NextResponse.json({ error: 'path et newName requis' }, { status: 400 })
  }
  const res = renameMoodboard(body.path, body.newName)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json(res)
}
