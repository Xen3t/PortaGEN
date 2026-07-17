import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getJob } from '@/lib/db'
import { cancelJob } from '@/lib/server/runner'

/** Annule un job encore en file (un job en cours d'exécution n'est pas interrompu). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const job = getJob(Number(id))
  if (!job) return NextResponse.json({ error: 'Job introuvable' }, { status: 404 })
  if (!cancelJob(job.id)) {
    return NextResponse.json(
      {
        error:
          job.status === 'running'
            ? 'Ce job est déjà en cours d’exécution — impossible d’interrompre l’appel en vol. Il se terminera, vous pourrez le rejeter.'
            : 'Seul un job en file peut être annulé.',
      },
      { status: 400 }
    )
  }
  return NextResponse.json({ ok: true })
}
