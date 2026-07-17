import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { listJobs } from '@/lib/db'
import { serializeJob } from '@/lib/server/serialize'
import { touchRunner } from '@/lib/server/runner'

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  touchRunner() // reprise éventuelle des jobs interrompus
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 50), 200)
  return NextResponse.json({ jobs: listJobs(limit).map(serializeJob) })
}
