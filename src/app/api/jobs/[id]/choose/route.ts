import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getJob, listJobsByBatch, setChosenJob } from '@/lib/db'
import { isMesRoot, siblingVariants, type MesVariantJob } from '@/lib/mesVariants'

/**
 * Générations multiples (29/07/2026) : désigne CETTE MES comme la génération
 * retenue de sa taille. Ses sœurs (mêmes taille + coloris du même lot) repassent
 * à non retenues. Seule la retenue peut ensuite passer en Marketplace.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const job = getJob(Number(id))
  if (!job) return NextResponse.json({ error: 'Job introuvable' }, { status: 404 })
  if (!isMesRoot(job.type)) {
    return NextResponse.json({ error: 'Seule une MES peut être choisie' }, { status: 400 })
  }
  if (job.status !== 'done') {
    return NextResponse.json({ error: 'La génération n’est pas terminée' }, { status: 400 })
  }
  if (!job.batch_id) {
    return NextResponse.json({ error: 'MES sans lot — choix impossible' }, { status: 400 })
  }

  const toVariant = (j: { id: number; type: string; payload: string | null; chosen: number }): MesVariantJob => ({
    id: j.id,
    type: j.type,
    chosen: j.chosen === 1,
    payload: j.payload ? JSON.parse(j.payload) : null,
  })
  const jobs = listJobsByBatch(job.batch_id).map(toVariant)
  const siblings = siblingVariants(jobs, toVariant(job)).map((j) => j.id)
  setChosenJob(job.id, siblings)
  return NextResponse.json({ ok: true, chosenId: job.id })
}
