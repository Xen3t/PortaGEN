import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import {
  FEEDBACK_CATEGORIES,
  addFeedback,
  deleteAllFeedback,
  deleteFeedback,
  listFeedback,
} from '@/lib/db/feedback'

/** Retours utilisateurs — envoi pour tous les connectés, consultation/suppression ADMIN. */
export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)

  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  if (message.length < 3) {
    return NextResponse.json({ error: 'Message requis (3 caractères minimum)' }, { status: 400 })
  }
  const category = (FEEDBACK_CATEGORIES as readonly string[]).includes(body?.category)
    ? (body.category as string)
    : 'general'
  const pageUrl = typeof body?.pageUrl === 'string' ? body.pageUrl.slice(0, 500) : null

  addFeedback({
    userId: auth.id,
    username: auth.username,
    category,
    message: message.slice(0, 5000),
    pageUrl,
  })
  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({ feedback: listFeedback() })
}

export async function DELETE(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  if (url.searchParams.get('all') === '1') {
    return NextResponse.json({ ok: true, deleted: deleteAllFeedback() })
  }
  const id = Number(url.searchParams.get('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Paramètre id requis' }, { status: 400 })
  }
  if (!deleteFeedback(id)) {
    return NextResponse.json({ error: 'Retour introuvable' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
