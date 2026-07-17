import path from 'node:path'
import fs from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { enqueueNewJob } from '@/lib/server/runner'
import { config } from '@/lib/config'
import { moteurDef, type MoteurKey } from '@/lib/moteurs'

/** Lance la génération d'un décor depuis un moodboard. */
export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  const moodboardRel = typeof body?.moodboardPath === 'string' ? body.moodboardPath : ''
  // Décors en 4K PAR DÉFAUT (décision Mathias 13/07/2026) : les MES héritent de la
  // résolution du décor, donc un décor 4K → des MES 4K, sans réglage à la génération.
  const imageSize = ['1K', '2K', '4K'].includes(body?.imageSize) ? body.imageSize : '4K'

  const moodboardPath = path.resolve(config.rootDir, moodboardRel)
  if (!moodboardPath.startsWith(path.resolve(config.assetsDir)) || !fs.existsSync(moodboardPath)) {
    return NextResponse.json({ error: 'Moodboard introuvable' }, { status: 400 })
  }
  const slug = path
    .basename(moodboardPath)
    .replace(/\.(jpg|jpeg|png)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60)

  const gamme = typeof body?.gamme === 'string' && body.gamme.trim() ? body.gamme.trim().slice(0, 80) : null
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : undefined
  // Essai Lab moteur : jamais dans la bibliothèque, artefacts isolés sous lab/.
  const lab = body?.lab === true
  // Moteur à utiliser (sélecteur du LAB, 13/07/2026) : corridor et référentiel
  // de tailles DU moteur. Absent ou inconnu = battant (comportement historique).
  const moteur: MoteurKey | undefined =
    typeof body?.moteur === 'string' && moteurDef(body.moteur) && body.moteur !== 'battant'
      ? (body.moteur as MoteurKey)
      : undefined
  // Tirages multiples : N décors générés d'un coup, à trier ensuite dans la
  // bibliothèque (garder / archiver / supprimer). Borné à 4 (coût API).
  const count = Math.min(4, Math.max(1, Number.isFinite(Number(body?.count)) ? Number(body.count) : 1))

  const jobIds = Array.from({ length: count }, (_, i) =>
    enqueueNewJob(
      'decor',
      {
        moodboardPath,
        imageSize,
        slug,
        gamme,
        name,
        nameSuffix: count > 1 ? ` · tirage ${i + 1}` : undefined,
        lab: lab || undefined,
        moteur,
      },
      undefined,
      auth.username
    )
  )
  return NextResponse.json({ jobId: jobIds[0], jobIds })
}
