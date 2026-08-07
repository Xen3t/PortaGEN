import path from 'node:path'
import fs from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { config } from '@/lib/config'
import { getJob } from '@/lib/db'
import { getMoteurReglages, moteurDef } from '@/lib/moteurs'
import { getMoteurDaReglages, isMoteurDaKey, moteurDaLegacyKey } from '@/lib/moteursDa'
import { enqueueNewJob } from '@/lib/server/runner'

/**
 * Passage Marketplace (MP) depuis la page « Génération » (lot 3 — 13/07/2026).
 *
 * À partir des MES Site déjà générées (jobs d'intégration « done »), on enqueue un
 * job « marketplace » par MES : recadrage 1:1 de la MES Site + génération des bords
 * (outpainting) — voir src/lib/pipeline/marketplace.ts. Aucun nouveau gabarit.
 *
 * Les jobs MP reprennent le batch d'origine → l'UI suit via /api/gamme/<batchId>.
 * Corps : { jobIds: number[] } (ids des jobs d'intégration à convertir).
 */
export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const ids: number[] = Array.isArray(body?.jobIds)
    ? body.jobIds.map(Number).filter(Number.isInteger)
    : []
  if (ids.length === 0) {
    return NextResponse.json({ error: 'Aucune MES à convertir.' }, { status: 400 })
  }

  const newJobIds: number[] = []
  const errors: string[] = []

  for (const id of ids) {
    const job = getJob(id)
    // On accepte la MES d'origine (intégration / pose-fusion / decor-autour —
    // nouveau mode 05/08/2026) ET une version retouchée (mes-fix).
    const isMesRoot =
      job?.type === 'integration' || job?.type === 'pose-fusion' || job?.type === 'decor-autour'
    if (!job || (!isMesRoot && job.type !== 'mes-fix') || job.status !== 'done' || !job.result) {
      errors.push(`Job ${id} : MES Site indisponible`)
      continue
    }
    let result: { deliveryPath?: string; zoneFrac?: { x: number; y: number; w: number; h: number } }
    let payload: {
      size?: { w: number; h: number }
      coloris?: string
      rootJobId?: number
      moteur?: string
    }
    try {
      result = JSON.parse(job.result)
      payload = job.payload ? JSON.parse(job.payload) : {}
    } catch {
      errors.push(`Job ${id} : données illisibles`)
      continue
    }
    // Moteur produit : porté par le job d'intégration ; un mes-fix ne l'a pas →
    // on le relit sur sa racine (le recadrage et le prompt MP sont PAR moteur).
    let moteur = payload.moteur
    if (!moteur && job.type === 'mes-fix' && payload.rootJobId) {
      const root = getJob(payload.rootJobId)
      try {
        moteur = root?.payload ? (JSON.parse(root.payload) as { moteur?: string }).moteur : undefined
      } catch {
        // racine illisible : on reste sur battant (défaut)
      }
    }
    // Réglage du moteur : 'jamais' = déclinaison MP interdite (Admin → Réglages
    // par moteur). Un moteur DÉCOR AUTOUR (janus/terminus/forculus) a SES
    // réglages — jamais ceux du battant legacy (repli historique).
    const daKey = moteur && isMoteurDaKey(moteur) ? moteur : null
    const moteurKey = moteurDef(moteur ?? 'battant')?.key ?? 'battant'
    const reglages = daKey ? getMoteurDaReglages(daKey) : getMoteurReglages(moteurKey)
    if (reglages.marketplace === 'jamais') {
      errors.push(`Job ${id} : la déclinaison MP est désactivée pour ce moteur`)
      continue
    }
    const rel = result.deliveryPath
    if (!rel) {
      errors.push(`Job ${id} : livraison Site absente`)
      continue
    }
    const abs = path.resolve(config.rootDir, rel)
    if (!abs.startsWith(path.resolve(config.dataDir)) || !fs.existsSync(abs)) {
      errors.push(`Job ${id} : fichier Site introuvable`)
      continue
    }
    const sizeW = payload.size?.w
    const newId = enqueueNewJob(
      'marketplace',
      {
        sourcePath: abs,
        slug: `gen-mp-${sizeW ?? ''}`,
        gateFrac: result.zoneFrac,
        sizeW,
        // repris uniquement pour l'affichage côté UI (ignoré par runMarketplaceStep)
        size: payload.size,
        coloris: payload.coloris,
        format: '2000x2000',
        // MES d'origine (intégration / pose-fusion) → l'UI sait quelle MES est déjà passée en MP
        rootJobId: isMesRoot ? job.id : payload.rootJobId,
        // runMarketplaceStep est indexé par clé LEGACY (cadrage + prompt
        // « marketplace-extension ») : une clé DA passée telle quelle retombait
        // sur le cadrage battant et le prompt générique codé en dur.
        moteur: daKey ? moteurDaLegacyKey(daKey) : moteur,
      },
      job.batch_id ?? undefined,
      auth.username
    )
    newJobIds.push(newId)
  }

  if (newJobIds.length === 0) {
    return NextResponse.json({ error: 'Aucune MES convertible.', errors }, { status: 400 })
  }
  return NextResponse.json({ jobIds: newJobIds, errors })
}
