import path from 'node:path'
import { getDb, getJob, updateJob, createJob } from '@/lib/db'
import { getConcurrencyPerUser } from '@/lib/db/settings'
import { config } from '@/lib/config'

/**
 * Runner de jobs en processus : générations CONCURRENTES avec une limite PAR
 * UTILISATEUR (Admin → Réglages, défaut 10 — décision Mathias 09/07/2026).
 * Jobs persistés en base (l'UI ne fait que du polling), reprise au démarrage
 * des jobs restés « queued »/« running » après un redémarrage du serveur.
 *
 * Les jobs lancés hors session (scripts CLI, pipelines internes) partagent un
 * même quota « système ». La limite est relue en base à chaque ordonnancement :
 * un changement dans l'écran admin prend effet immédiatement.
 *
 * Singleton accroché à globalThis pour survivre au rechargement à chaud de Next en dev.
 */

type RunnerState = {
  queue: number[]
  running: Set<number>
  initialized: boolean
}

const SYSTEM_USER = '__system__'

const g = globalThis as typeof globalThis & { __portagenRunner?: RunnerState }

function state(): RunnerState {
  if (!g.__portagenRunner) {
    g.__portagenRunner = { queue: [], running: new Set(), initialized: false }
  }
  // Migration de l'ancien état (file séquentielle) après rechargement à chaud.
  if (!(g.__portagenRunner.running instanceof Set)) {
    g.__portagenRunner.running = new Set()
  }
  return g.__portagenRunner
}

/** À l'initialisation : remet en file les jobs interrompus par un arrêt du serveur. */
function initOnce(): void {
  const s = state()
  if (s.initialized) return
  s.initialized = true
  const db = getDb()
  const stale = db
    .prepare(`SELECT id FROM jobs WHERE status IN ('queued', 'running') ORDER BY id`)
    .all() as { id: number }[]
  for (const row of stale) {
    updateJob(row.id, { status: 'queued' })
    if (!s.queue.includes(row.id)) s.queue.push(row.id)
  }
  schedule()
}

export function enqueueNewJob(
  type: 'decor' | 'decor-fix' | 'pillars' | 'integration' | 'marketplace' | 'mes-fix',
  payload: unknown,
  batchId?: string,
  createdBy?: string
): number {
  initOnce()
  const id = createJob(type, payload, undefined, batchId, createdBy)
  state().queue.push(id)
  schedule()
  return id
}

/**
 * Annule un job encore EN FILE : retiré de la queue, statut « cancelled ».
 * Un job déjà en cours n'est pas interrompu (l'appel API est parti) → false.
 */
export function cancelJob(id: number): boolean {
  initOnce()
  const job = getJob(id)
  if (!job || job.status !== 'queued' || state().running.has(id)) return false
  const s = state()
  s.queue = s.queue.filter((qid) => qid !== id)
  updateJob(id, { status: 'cancelled' })
  return true
}

/** Ré-exécute un job existant (régénération) : même payload, compteur incrémenté. */
export function requeueJob(id: number): void {
  initOnce()
  updateJob(id, { status: 'queued', error: null, incrementRegen: true, review_status: 'pending' })
  const s = state()
  if (!s.queue.includes(id) && !s.running.has(id)) s.queue.push(id)
  schedule()
}

export function touchRunner(): void {
  initOnce()
}

/**
 * Ordonnanceur : démarre tous les jobs en file dont le lanceur n'a pas atteint
 * sa limite de générations simultanées. Rappelé à chaque fin de job.
 */
function schedule(): void {
  const s = state()
  const limit = getConcurrencyPerUser()

  const runningByUser = new Map<string, number>()
  for (const id of s.running) {
    const user = getJob(id)?.created_by ?? SYSTEM_USER
    runningByUser.set(user, (runningByUser.get(user) ?? 0) + 1)
  }

  let i = 0
  while (i < s.queue.length) {
    const id = s.queue[i]
    const job = getJob(id)
    if (!job || job.status !== 'queued') {
      s.queue.splice(i, 1)
      continue
    }
    const user = job.created_by ?? SYSTEM_USER
    const runningCount = runningByUser.get(user) ?? 0
    if (runningCount >= limit) {
      i++
      continue
    }
    s.queue.splice(i, 1)
    s.running.add(id)
    runningByUser.set(user, runningCount + 1)
    void processJob(id).finally(() => {
      state().running.delete(id)
      schedule()
    })
  }
}

async function processJob(id: number): Promise<void> {
  const job = getJob(id)
  if (!job || (job.status !== 'queued' && job.status !== 'running')) return
  updateJob(id, { status: 'running' })
  try {
    const payload = job.payload ? JSON.parse(job.payload) : {}
    if (job.type === 'decor') {
      const { runDecorStep } = await import('@/lib/pipeline/decor')
      await runDecorStep({ ...payload, jobId: id })
    } else if (job.type === 'decor-fix') {
      const { runDecorFixStep } = await import('@/lib/pipeline/decorFix')
      await runDecorFixStep({ ...payload, jobId: id })
    } else if (job.type === 'pillars') {
      const { runPillarsStep } = await import('@/lib/pipeline/pillars')
      await runPillarsStep({ ...payload, jobId: id })
      // Enchaînement automatique : si le lancement de la gamme portait une image
      // produit, l'Intégration part toute seule — l'utilisateur ne s'occupe que
      // de l'image finale (parcours décidé par Mathias le 09/07/2026).
      const done = getJob(id)
      if (done?.status === 'done' && typeof payload.productPath === 'string') {
        enqueueNewJob(
          'integration',
          {
            pillarsJobId: id,
            productPath: payload.productPath,
            size: payload.size,
            slug: payload.slug,
            // Un essai Lab reste un essai Lab jusqu'au bout (jamais dans Production).
            lab: payload.lab === true || undefined,
            // Rattachement catalogue (bloc 3.1) : suit jusqu'à la MES finale pour
            // que la case de la grille retrouve son image. `undefined` pour les
            // lancements normaux (Créer) — JSON.stringify les omet.
            catalogProductId: payload.catalogProductId,
            coloris: payload.coloris,
            format: payload.format,
            // Moteur produit (13/07/2026) : suit le job jusqu'à l'Intégration
            // pour que chaque étape lise SES réglages et SES prompts.
            moteur: payload.moteur,
            // Option « décliner en MP automatiquement » cochée au lancement
            // (page Génération, 13/07/2026) : suit jusqu'à l'Intégration.
            autoMp: payload.autoMp === true || undefined,
          },
          done.batch_id ?? undefined,
          done.created_by ?? undefined
        )
      }
    } else if (job.type === 'integration') {
      const { runIntegrationStep } = await import('@/lib/pipeline/integration')
      await runIntegrationStep({ ...payload, jobId: id })
      // Déclinaison Marketplace AUTOMATIQUE (option cochée au lancement) : mêmes
      // champs que /api/generation/mp, sans attendre la review de la MES Site.
      const done = getJob(id)
      if (done?.status === 'done' && payload.autoMp === true && done.result) {
        try {
          const result = JSON.parse(done.result) as {
            deliveryPath?: string
            zoneFrac?: { x: number; y: number; w: number; h: number }
          }
          if (result.deliveryPath) {
            enqueueNewJob(
              'marketplace',
              {
                sourcePath: path.resolve(config.rootDir, result.deliveryPath),
                slug: `gen-mp-${payload.size?.w ?? ''}`,
                gateFrac: result.zoneFrac,
                sizeW: payload.size?.w,
                size: payload.size,
                coloris: payload.coloris,
                format: '2000x2000',
                rootJobId: id,
                moteur: payload.moteur,
              },
              done.batch_id ?? undefined,
              done.created_by ?? undefined
            )
          }
        } catch {
          // résultat illisible : pas de MP automatique, la MES Site reste valable
        }
      }
    } else if (job.type === 'marketplace') {
      const { runMarketplaceStep } = await import('@/lib/pipeline/marketplace')
      await runMarketplaceStep({ ...payload, jobId: id })
    } else if (job.type === 'mes-fix') {
      const { runMesFixStep } = await import('@/lib/pipeline/mesFix')
      await runMesFixStep({ ...payload, jobId: id })
    } else {
      updateJob(id, { status: 'error', error: `Type de job inconnu : ${job.type}` })
    }
    // Les pipelines posent eux-mêmes status done/error + result sur le job.
  } catch (err) {
    // Filet de sécurité si le pipeline a levé avant d'avoir pu marquer l'erreur.
    const current = getJob(id)
    if (current && current.status === 'running') {
      updateJob(id, { status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }
}
