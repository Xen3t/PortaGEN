import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getJob, updateJob } from '@/lib/db'
import { activateDecorByJob } from '@/lib/db/decors'

/** Validation humaine : approuver ou rejeter une génération terminée. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const job = getJob(Number(id))
  if (!job) return NextResponse.json({ error: 'Job introuvable' }, { status: 404 })
  if (job.status !== 'done') {
    return NextResponse.json({ error: 'Le job n’est pas terminé' }, { status: 400 })
  }
  const body = await req.json().catch(() => null)
  const action = body?.action
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'Action invalide (approve|reject)' }, { status: 400 })
  }
  updateJob(job.id, {
    review_status: action === 'approve' ? 'approved' : 'rejected',
    reviewed_at: new Date().toISOString(),
  })
  // Pont vers la bibliothèque : un job décor approuvé par un ADMIN rend le décor
  // « Actif » (même geste de validation, pas de double saisie).
  if (job.type === 'decor' && action === 'approve' && auth.role === 'admin') {
    activateDecorByJob(job.id)
  }
  return NextResponse.json({ ok: true })
}
