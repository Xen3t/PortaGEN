import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getDb, listJobsByBatch, type JobRow } from '@/lib/db'
import { serializeJob } from '@/lib/server/serialize'

/** Tous les jobs d'un groupe de génération (piliers + intégrations chaînées). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ batchId: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { batchId } = await ctx.params
  const jobs = listJobsByBatch(batchId)
  if (jobs.length === 0) {
    return NextResponse.json({ error: 'Groupe introuvable' }, { status: 404 })
  }

  // Filet de sécurité : une intégration chaînée appartient au groupe de son job
  // Piliers même si son batch_id n'a pas été posé (jobs créés par une version
  // antérieure du runner, rechargement à chaud en dev…). On la rattache par
  // payload.pillarsJobId et on RÉPARE son étiquette en base au passage.
  const pillarIds = new Set(jobs.filter((j) => j.type === 'pillars').map((j) => j.id))
  if (pillarIds.size > 0) {
    const db = getDb()
    const orphans = db
      .prepare(`SELECT * FROM jobs WHERE type = 'integration' AND batch_id IS NULL`)
      .all() as JobRow[]
    let repaired = false
    for (const j of orphans) {
      try {
        const p = j.payload ? JSON.parse(j.payload) : {}
        // Un essai Lab sans lot, c'est VOULU (il réutilise un job Piliers de
        // session) : ne jamais le rattacher au lot de la session.
        if (p.lab === true) continue
        if (!pillarIds.has(Number(p.pillarsJobId))) continue
        db.prepare('UPDATE jobs SET batch_id = ? WHERE id = ?').run(batchId, j.id)
        jobs.push({ ...j, batch_id: batchId })
        repaired = true
      } catch {
        // payload illisible : on ignore
      }
    }
    if (repaired) jobs.sort((a, b) => a.id - b.id)
  }

  return NextResponse.json({ jobs: jobs.map(serializeJob), role: auth.role })
}
