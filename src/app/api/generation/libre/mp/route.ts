import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getJob } from '@/lib/db'
import { enqueueNewJob } from '@/lib/server/runner'

/**
 * Passage Marketplace des MES Libres (28/07/2026) : pour chaque job « libre »
 * terminé, un job « libre-mp » (carré 2000×2000, extension générique) dans le
 * MÊME batch — l'écran et la session suivent tout d'un bloc.
 */
export async function POST(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  const ids: number[] = Array.isArray(body?.jobIds)
    ? body.jobIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
    : []
  if (ids.length === 0) {
    return NextResponse.json({ error: 'Aucune MES à décliner.' }, { status: 400 })
  }

  const mpJobIds: number[] = []
  for (const id of ids) {
    const job = getJob(id)
    // Une MES d'origine (« libre ») ou une version retouchée (« libre-fix »).
    if (!job || (job.type !== 'libre' && job.type !== 'libre-fix') || job.status !== 'done' || !job.result)
      continue
    let result: { imagePath?: string; variante?: number } = {}
    let payload: { slug?: string } = {}
    try {
      result = JSON.parse(job.result)
      payload = job.payload ? JSON.parse(job.payload) : {}
    } catch {
      continue
    }
    if (typeof result.imagePath !== 'string') continue
    mpJobIds.push(
      enqueueNewJob(
        'libre-mp',
        {
          sourcePath: result.imagePath,
          rootJobId: id,
          variante: result.variante,
          slug: payload.slug,
        },
        job.batch_id ?? undefined,
        auth.username
      )
    )
  }

  if (mpJobIds.length === 0) {
    return NextResponse.json({ error: 'Aucune MES Libre terminée dans la sélection.' }, { status: 400 })
  }
  return NextResponse.json({ jobIds: mpJobIds })
}
