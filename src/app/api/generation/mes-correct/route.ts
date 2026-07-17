import path from 'node:path'
import fs from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { config } from '@/lib/config'
import { getJob } from '@/lib/db'
import { enqueueNewJob } from '@/lib/server/runner'

/**
 * Studio MES — retour par prompt sur une MES (lot 4, page Génération, 13/07/2026).
 *
 * Le client envoie l'id du JOB de la version à retoucher (le job d'intégration
 * d'origine, ou un job « mes-fix » précédent) + une consigne. On enqueue un job
 * « mes-fix » (voir src/lib/pipeline/mesFix.ts) dans le MÊME batch, rattaché à la
 * MES d'origine par `rootJobId`. Les versions ne sont donc que des jobs du batch.
 *
 * Corps : { jobId: number, instruction: string }.
 */
export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const jobId = Number(body?.jobId)
  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : ''
  if (!Number.isInteger(jobId) || !instruction) {
    return NextResponse.json({ error: 'Requête incomplète (version ou consigne).' }, { status: 400 })
  }

  const job = getJob(jobId)
  if (!job || (job.type !== 'integration' && job.type !== 'mes-fix') || job.status !== 'done' || !job.result) {
    return NextResponse.json({ error: 'Version de MES indisponible.' }, { status: 400 })
  }

  let result: {
    deliveryPath?: string
    rawOutputPath?: string
    zoneFrac?: { x: number; y: number; w: number; h: number }
  }
  let payload: { size?: { w: number; h: number }; coloris?: string; rootJobId?: number }
  try {
    result = JSON.parse(job.result)
    payload = job.payload ? JSON.parse(job.payload) : {}
  } catch {
    return NextResponse.json({ error: 'Données de la MES illisibles.' }, { status: 400 })
  }

  // On retouche depuis le rendu NATIF (meilleure qualité) ; à défaut la livraison.
  const sourceRel = result.rawOutputPath ?? result.deliveryPath
  if (!sourceRel) {
    return NextResponse.json({ error: 'Image source de la MES absente.' }, { status: 400 })
  }
  const abs = path.resolve(config.rootDir, sourceRel)
  if (!abs.startsWith(path.resolve(config.dataDir)) || !fs.existsSync(abs)) {
    return NextResponse.json({ error: 'Fichier source de la MES introuvable.' }, { status: 400 })
  }

  // Racine = le job d'intégration ; un mes-fix reporte le rootJobId de sa MES.
  const rootJobId = job.type === 'integration' ? job.id : payload.rootJobId ?? job.id

  const newId = enqueueNewJob(
    'mes-fix',
    {
      sourcePath: abs,
      instruction,
      rootJobId,
      size: payload.size,
      coloris: payload.coloris,
      gateFrac: result.zoneFrac,
      slug: `mes-${rootJobId}`,
    },
    job.batch_id ?? undefined,
    auth.username
  )

  return NextResponse.json({ jobId: newId, rootJobId })
}
