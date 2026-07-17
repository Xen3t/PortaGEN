import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getJob } from '@/lib/db'
import { enqueueNewJob } from '@/lib/server/runner'
import { config } from '@/lib/config'
import { parseSizeFromProductName } from '@/lib/images/product'

/** Lance l'intégration produit à partir d'un job Piliers terminé. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  const pillarsJob = getJob(Number(id))
  if (!pillarsJob || pillarsJob.type !== 'pillars') {
    return NextResponse.json({ error: 'Job Piliers introuvable' }, { status: 404 })
  }
  if (pillarsJob.status !== 'done') {
    return NextResponse.json({ error: 'Le job Piliers n’est pas terminé' }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  const productRel = typeof body?.productPath === 'string' ? body.productPath : ''
  const productPath = path.resolve(config.rootDir, productRel)
  if (!productPath.startsWith(path.resolve(config.dataDir)) || !fs.existsSync(productPath)) {
    return NextResponse.json({ error: 'Image produit introuvable' }, { status: 400 })
  }

  const payload = pillarsJob.payload ? JSON.parse(pillarsJob.payload) : {}

  // Refus immédiat si la nomenclature produit contredit la taille du job (déformation interdite).
  const jobSize = payload.size as { w: number; h: number } | undefined
  const nameSize = parseSizeFromProductName(path.basename(productPath))
  if (jobSize && nameSize && (nameSize.w !== jobSize.w || nameSize.h !== jobSize.h)) {
    return NextResponse.json(
      {
        error: `Produit incompatible : « ${path.basename(productPath)} » est un ${nameSize.w}×${nameSize.h} cm, ce job Piliers est un ${jobSize.w}×${jobSize.h}. Choisissez le PNG ${jobSize.w}×${jobSize.h} du produit, ou lancez une gamme ${nameSize.w}×${nameSize.h}.`,
      },
      { status: 400 }
    )
  }

  // Méthode d'intégration (Lab moteur) : défaut du moteur = « simple ».
  const method = ['simple', 'rectangle', 'pose-directe'].includes(body?.method)
    ? (body.method as 'simple' | 'rectangle' | 'pose-directe')
    : undefined
  // Essai Lab moteur (masqué de Production) — hérité aussi d'un job Piliers d'essai.
  const lab = body?.lab === true || payload.lab === true

  const jobId = enqueueNewJob(
    'integration',
    {
      pillarsJobId: pillarsJob.id,
      productPath,
      method,
      lab: lab || undefined,
      // Copies informatives pour l'affichage en liste :
      size: payload.size,
      slug: payload.slug,
    },
    // Un essai Lab réutilise un job Piliers d'une session : il ne doit PAS
    // hériter de son lot, sinon il s'affiche dans les résultats de la session.
    lab ? undefined : (pillarsJob.batch_id ?? undefined),
    auth.username
  )
  return NextResponse.json({ jobId })
}
