import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { listJobs, listJobsByBatch } from '@/lib/db'
import { serializeJob } from '@/lib/server/serialize'
import { touchRunner } from '@/lib/server/runner'

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  touchRunner() // reprise éventuelle des jobs interrompus
  // ?batch= : les jobs d'un lot précis (28/07/2026 — rouvrir l'atelier d'une
  // session décor depuis sa carte). Sinon, la liste globale comme avant.
  const batch = req.nextUrl.searchParams.get('batch')
  if (batch) {
    return NextResponse.json({ jobs: listJobsByBatch(batch).map(serializeJob) })
  }
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 50), 200)
  return NextResponse.json({ jobs: listJobs(limit).map(serializeJob) })
}
