import path from 'node:path'
import { config } from '@/lib/config'
import { getJob, updateJob } from '@/lib/db'
import { jugerMes } from '@/lib/genai/jugeMes'

/**
 * BOUCLE DU JUGE VISION (17/08/2026, demande Mathias : « déléguer la boucle de
 * regénération ») — page MES Contrainte uniquement. Après chaque génération
 * « decor-autour » dont le payload porte `juge: true` (posé au lancement quand
 * le réglage moteur `jugeMes` est activé) :
 *
 *  1. le juge compare le rendu au PNG produit (src/lib/genai/jugeMes.ts) ;
 *  2. verdict écrit dans le result JSON du job (`juge: {...}`) — affiché dans
 *     la vue en grand et sur les vignettes de versions ;
 *  3. refus → relance automatique d'une NOUVELLE VERSION (même payload, même
 *     lot : la case la suit comme une regénération manuelle), 2 relances
 *     maximum — 3 générations au plus par image (`jugeEssai` 1 → 2 → 3) ;
 *  4. erreur du juge (API, JSON illisible) = PAS de verdict : ni relance ni
 *     validation, l'utilisateur garde la main (comportement sans juge).
 *
 * Rien n'est supprimé ni choisi à sa place : les versions refusées restent
 * visibles avec leur motif, et si tout est refusé c'est lui qui tranche.
 */

/** 3 générations au plus par image : l'essai 3 refusé ne relance plus. */
export const JUGE_MES_MAX_ESSAIS = 3

export interface JugeMesResultat {
  /** false UNIQUEMENT sur refus explicite (une erreur du juge laisse passer). */
  acceptee: boolean
  relanceJobId?: number
}

/**
 * Applique le juge au job `decor-autour` TERMINÉ `jobId`. Retourne le verdict
 * pour que le runner conditionne la déclinaison MP automatique — jamais de
 * throw : le juge ne doit pas transformer une génération réussie en échec.
 */
export async function appliquerJugeMes(jobId: number): Promise<JugeMesResultat> {
  const job = getJob(jobId)
  if (!job || job.status !== 'done' || !job.result) return { acceptee: true }
  let payload: Record<string, unknown>
  let result: Record<string, unknown>
  try {
    payload = JSON.parse(job.payload ?? '{}') as Record<string, unknown>
    result = JSON.parse(job.result) as Record<string, unknown>
  } catch {
    return { acceptee: true }
  }
  const productPath = typeof payload.productPath === 'string' ? payload.productPath : null
  const deliveryPath = typeof result.deliveryPath === 'string' ? result.deliveryPath : null
  // Plan gris = 3ᵉ image du juge (17/08) : la géométrie exigée (piliers compris).
  const planPath = typeof result.planPath === 'string' ? result.planPath : null
  if (!productPath || !deliveryPath) return { acceptee: true }
  if (!planPath) {
    // Sans plan, pas de verdict fiable : on le note et on rend la main.
    updateJob(jobId, {
      result: JSON.stringify({ ...result, juge: { erreur: 'plan gris introuvable', essai: 1 } }),
    })
    return { acceptee: true }
  }
  const essai =
    typeof payload.jugeEssai === 'number' && payload.jugeEssai >= 1
      ? Math.round(payload.jugeEssai)
      : 1

  let verdict
  try {
    verdict = await jugerMes(
      path.resolve(config.rootDir, productPath),
      path.resolve(config.rootDir, planPath),
      path.resolve(config.rootDir, deliveryPath),
      jobId
    )
  } catch (err) {
    // Pas de verdict : on le note pour l'écran et on rend la main (ni relance
    // ni validation) — exactement le comportement d'avant le juge.
    updateJob(jobId, {
      result: JSON.stringify({
        ...result,
        juge: { erreur: err instanceof Error ? err.message : String(err), essai },
      }),
    })
    return { acceptee: true }
  }

  updateJob(jobId, {
    result: JSON.stringify({
      ...result,
      juge: {
        acceptee: verdict.acceptee,
        motif: verdict.motif,
        essai,
        model: verdict.model,
        promptVersion: verdict.promptVersion,
      },
    }),
  })
  if (verdict.acceptee) return { acceptee: true }
  if (essai >= JUGE_MES_MAX_ESSAIS) return { acceptee: false }

  // Relance : nouvelle version dans le même lot — même payload (la case la
  // raccroche par productPath), essai incrémenté. Import paresseux : le runner
  // importe ce module, jamais l'inverse au chargement.
  const { enqueueNewJob } = await import('@/lib/server/runner')
  const relanceJobId = enqueueNewJob(
    'decor-autour',
    { ...payload, jugeEssai: essai + 1 },
    job.batch_id ?? undefined,
    job.created_by ?? undefined
  )
  return { acceptee: false, relanceJobId }
}
