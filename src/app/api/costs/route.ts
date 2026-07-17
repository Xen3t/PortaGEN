import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getDb } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const db = getDb()
  const byModel = db
    .prepare(
      `SELECT model, kind, COUNT(*) AS calls, SUM(ok) AS ok,
              COALESCE(SUM(input_tokens), 0) AS inputTokens,
              COALESCE(SUM(output_tokens), 0) AS outputTokens
       FROM api_calls GROUP BY model, kind ORDER BY calls DESC`
    )
    .all()
  const byDay = db
    .prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS calls,
              COALESCE(SUM(output_tokens), 0) AS outputTokens
       FROM api_calls GROUP BY day ORDER BY day DESC LIMIT 30`
    )
    .all()
  const recent = db
    .prepare(
      `SELECT id, job_id AS jobId, model, kind, duration_ms AS durationMs,
              input_tokens AS inputTokens, output_tokens AS outputTokens, ok, created_at AS createdAt
       FROM api_calls ORDER BY id DESC LIMIT 25`
    )
    .all()
  return NextResponse.json({ byModel, byDay, recent })
}
