import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getJob } from '@/lib/db'
import { enqueueNewJob } from '@/lib/server/runner'

/**
 * Retouche d'une MES Libre par consigne (studio, 28/07/2026) : la version
 * affichée (job « libre » ou « libre-fix ») + la consigne → un job « libre-fix »
 * dans le MÊME lot, rattaché à la MES racine (rootJobId). Les références
 * produit, le ratio et la qualité viennent du job « libre » racine.
 */
export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  const sourceJobId = Number(body?.jobId)
  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim().slice(0, 400) : ''
  if (!Number.isInteger(sourceJobId) || sourceJobId <= 0 || !instruction) {
    return NextResponse.json({ error: 'MES et consigne requises.' }, { status: 400 })
  }

  const source = getJob(sourceJobId)
  if (!source || (source.type !== 'libre' && source.type !== 'libre-fix') || source.status !== 'done') {
    return NextResponse.json({ error: 'MES introuvable ou pas encore terminée.' }, { status: 400 })
  }
  let sourceResult: { imagePath?: string; rootJobId?: number } = {}
  try {
    sourceResult = source.result ? JSON.parse(source.result) : {}
  } catch {
    // illisible → erreur ci-dessous
  }
  if (typeof sourceResult.imagePath !== 'string') {
    return NextResponse.json({ error: 'Image de la MES introuvable.' }, { status: 400 })
  }

  // MES racine : porte les références produit, le ratio, la qualité, le slug.
  const rootJobId = source.type === 'libre' ? source.id : Number(sourceResult.rootJobId)
  const root = getJob(rootJobId)
  if (!root || root.type !== 'libre' || !root.payload) {
    return NextResponse.json({ error: 'MES racine introuvable.' }, { status: 400 })
  }
  let rootPayload: {
    productPaths?: string[]
    aspectRatio?: string
    imageSize?: string
    model?: string
    slug?: string
    variante?: number
  } = {}
  try {
    rootPayload = JSON.parse(root.payload)
  } catch {
    return NextResponse.json({ error: 'MES racine illisible.' }, { status: 400 })
  }

  const jobId = enqueueNewJob(
    'libre-fix',
    {
      sourcePath: sourceResult.imagePath,
      instruction,
      productPaths: rootPayload.productPaths ?? [],
      aspectRatio: rootPayload.aspectRatio ?? '3:2',
      imageSize: rootPayload.imageSize ?? '2K',
      model: rootPayload.model,
      slug: rootPayload.slug,
      rootJobId,
      variante: rootPayload.variante,
    },
    root.batch_id ?? undefined,
    auth.username
  )
  return NextResponse.json({ jobId })
}
