import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getJob } from '@/lib/db'
import { requeueJob } from '@/lib/server/runner'

/** Seuil du brief : au-delà, bascule en traitement manuel infographie. */
const MAX_REGEN = 10

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const job = getJob(Number(id))
  if (!job) return NextResponse.json({ error: 'Job introuvable' }, { status: 404 })
  if (job.status === 'queued' || job.status === 'running') {
    return NextResponse.json({ error: 'Le job est déjà en cours' }, { status: 400 })
  }
  if (job.regen_count >= MAX_REGEN) {
    return NextResponse.json(
      { error: `Seuil de ${MAX_REGEN} régénérations atteint — bascule en traitement manuel (brief).` },
      { status: 400 }
    )
  }
  requeueJob(job.id)
  return NextResponse.json({ ok: true, regenCount: job.regen_count + 1 })
}
