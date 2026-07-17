import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { listPromptVersions, savePromptVersion } from '@/lib/db/prompts'

export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { name } = await ctx.params
  const versions = listPromptVersions(name)
  if (versions.length === 0) {
    return NextResponse.json({ error: 'Prompt inconnu' }, { status: 404 })
  }
  return NextResponse.json({ versions })
}

/** Enregistre une nouvelle version du prompt (l'historique est immuable). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { name } = await ctx.params
  const body = await req.json().catch(() => null)
  const content = typeof body?.content === 'string' ? body.content : ''
  const comment = typeof body?.comment === 'string' ? body.comment.slice(0, 500) : undefined
  if (content.trim().length < 20) {
    return NextResponse.json({ error: 'Contenu trop court pour un prompt système' }, { status: 400 })
  }
  const saved = savePromptVersion(name, content, auth.username, comment)
  return NextResponse.json({ prompt: saved })
}
