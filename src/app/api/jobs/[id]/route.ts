import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { deleteJob, getJob, listApiCallsForJob } from '@/lib/db'
import { serializeJob } from '@/lib/server/serialize'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const job = getJob(Number(id))
  if (!job) return NextResponse.json({ error: 'Job introuvable' }, { status: 404 })
  // Appels API du job (modèle, durée, tokens) : affichés dans le Lab moteur.
  const calls = listApiCallsForJob(job.id).map((c) => ({
    id: c.id,
    provider: c.provider,
    model: c.model,
    kind: c.kind,
    durationMs: c.duration_ms,
    inputTokens: c.input_tokens,
    outputTokens: c.output_tokens,
    totalTokens: c.total_tokens,
    ok: c.ok === 1,
    error: c.error,
    createdAt: c.created_at,
  }))
  return NextResponse.json({ job: serializeJob(job), calls, role: auth.role })
}

/**
 * Suppression d'une demande (ADMIN) : retire le job du journal. Refusée quand
 * le job est en cours d'exécution (l'appel en vol ne peut pas être interrompu —
 * l'annuler d'abord n'est possible que s'il est encore en file). Les artefacts
 * disque et les décors déjà produits sont conservés.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  if (auth.role !== 'admin') {
    return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })
  }
  const { id } = await ctx.params
  const job = getJob(Number(id))
  if (!job) return NextResponse.json({ error: 'Job introuvable' }, { status: 404 })
  if (job.status === 'running') {
    return NextResponse.json(
      { error: 'Job en cours d’exécution — attendez la fin (ou son erreur) pour le supprimer' },
      { status: 409 }
    )
  }
  deleteJob(job.id)
  return NextResponse.json({ ok: true })
}
