import type Database from 'better-sqlite3'
import { getDb, type JobRow } from '@/lib/db'
import { gabaritSetForSize } from '@/lib/gabaritSets'
import type { MoteurKey } from '@/lib/moteurs'

/**
 * Essais du LAB (refonte lab-v1, validée par Mathias le 22/07/2026) : l'historique
 * vit EN BASE — la liste est reconstruite depuis les jobs marqués `lab` dans leur
 * payload (avant : pastilles en localStorage, 12 max, perdues au changement de
 * navigateur). Un essai = un job seul, ou le groupe de jobs d'un lancement
 * multi-tailles (même batch_id). Archiver un essai = poser lab_archived_at sur
 * ses jobs : il quitte la liste, tout est conservé (visible dans « Archives »).
 */

export type LabStep = 'decor' | 'pillars' | 'integration'

export interface LabEssai {
  /** Job de tête (premier du groupe) — identifiant de l'essai côté interface. */
  id: number
  /** Tous les jobs du groupe (un lancement multi-tailles en a plusieurs). */
  ids: number[]
  step: LabStep
  moteur: MoteurKey
  /** Jeu Gabarits XL (décor XL ou taille coulissante ≥ 450). */
  xl: boolean
  /** running si un job tourne encore ; error si terminé avec au moins une erreur. */
  status: 'running' | 'done' | 'error'
  done: number
  errors: number
  total: number
  createdAt: string
  /** Première image disponible de l'essai (chemin relatif projet) — vignette. */
  thumbPath: string | null
  titre: string
  detail: string
  /** Tokens des appels image cumulés — le client applique le tarif (Réglages). */
  inputTokens: number
  outputTokens: number
  archived: boolean
}

interface ParsedJob extends JobRow {
  p: Record<string, unknown>
  r: Record<string, unknown>
}

const STEP_OF_TYPE: Record<string, LabStep> = {
  decor: 'decor',
  'decor-fix': 'decor',
  pillars: 'pillars',
  integration: 'integration',
  'pose-fusion': 'integration',
}

/** Nom de fichier seul, sans dossier ni extension (libellés lisibles). */
function fileLabel(p: unknown): string {
  const s = String(p ?? '')
  return (s.split(/[\\/]/).pop() ?? s).replace(/\.(png|jpe?g|webp)$/i, '')
}

function parse(row: JobRow): ParsedJob | null {
  try {
    const p = row.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : {}
    const r = row.result ? (JSON.parse(row.result) as Record<string, unknown>) : {}
    return { ...row, p, r }
  } catch {
    return null // payload corrompu : le job n'apparaît pas dans le LAB
  }
}

/** Moteur du job — un payload « coulissant-xl » (jeu du décor XL) reste TERMINUS. */
function moteurOf(j: ParsedJob): { moteur: MoteurKey; xl: boolean } {
  const raw = String(j.p.moteur ?? 'battant')
  if (raw === 'coulissant-xl') return { moteur: 'coulissant', xl: true }
  const moteur = (['battant', 'coulissant', 'portillon'].includes(raw) ? raw : 'battant') as MoteurKey
  const size = j.p.size as { w?: number } | undefined
  const xl = gabaritSetForSize(moteur, size?.w ?? 0) === 'coulissant-xl'
  return { moteur, xl }
}

/** Première image montrable d'un job, dans l'ordre le plus parlant par étape. */
function thumbOf(j: ParsedJob): string | null {
  for (const key of ['imagePath', 'compositePath', 'deliveryPath', 'rawOutputPath', 'overlayPath']) {
    const v = j.r[key]
    if (typeof v === 'string' && v) return v
  }
  return null
}

function signedPx(v: unknown): string {
  const n = Number(v) || 0
  return `${n >= 0 ? '+' : ''}${n} px`
}

/** Libellés de l'essai (titre + seconde ligne), construits depuis le job de tête. */
function labelsOf(step: LabStep, jobs: ParsedJob[]): { titre: string; detail: string } {
  const head = jobs[0]
  const sizeOf = (j: ParsedJob) => j.p.size as { w?: number; h?: number } | undefined
  if (step === 'decor') {
    const titre = `Décor · ${fileLabel(head.p.moodboardPath) || 'moodboard'}`
    const parts: string[] = []
    if (head.r.imageSize) parts.push(String(head.r.imageSize))
    const off = head.r.sidewalkOffsetPxDelivery
    if (off !== undefined && off !== null) parts.push(`trottoir ${signedPx(off)}`)
    const veg = head.r.corridorGreenFraction
    if (veg !== undefined && veg !== null) {
      parts.push(`végétation couloir ${((Number(veg) || 0) * 100).toFixed(1).replace('.', ',')} %`)
    }
    return { titre, detail: parts.join(' · ') }
  }
  if (step === 'pillars') {
    const s = sizeOf(head)
    const titre =
      jobs.length > 1 ? `Piliers · ${jobs.length} tailles` : `Piliers · ${s?.w ?? '?'}×${s?.h ?? '?'}`
    const parts: string[] = [`décor ${fileLabel(head.p.decorPath)}`]
    const done = jobs.find((j) => j.status === 'done')
    if (done?.r.groundOffsetPxNative !== undefined) {
      parts.push(
        `sol ${signedPx(done.r.groundOffsetPxNative)}${done.r.groundAlign === 'measured' ? ' (mesuré)' : ''}`
      )
    }
    return { titre, detail: parts.join(' · ') }
  }
  const s = sizeOf(head)
  const method = head.type === 'pose-fusion' ? 'pose + fusion' : String(head.r.method ?? head.p.method ?? '')
  const titre = `Intégration · ${s ? `${s.w}×${s.h}` : (method || '?')}`
  const parts: string[] = []
  const produit = head.p.productPath ?? head.r.productPath
  if (produit) parts.push(`produit ${fileLabel(produit)}`)
  if (method) parts.push(method)
  return { titre, detail: parts.join(' · ') }
}

export interface LabEssaisListe {
  essais: LabEssai[]
  activeCount: number
  archivedCount: number
}

/** Liste des essais du LAB, du plus récent au plus ancien. */
export function listLabEssais(
  opts: { archived?: boolean } = {},
  db: Database.Database = getDb()
): LabEssaisListe {
  const rows = db
    .prepare(`SELECT * FROM jobs WHERE payload LIKE '%"lab":true%' ORDER BY id DESC LIMIT 1000`)
    .all() as JobRow[]
  const labJobs = rows.map(parse).filter((j): j is ParsedJob => j !== null && j.p.lab === true)

  // Un essai = un batch (lancement multi-tailles) ou un job isolé.
  const groups = new Map<string, ParsedJob[]>()
  for (const j of labJobs) {
    const key = j.batch_id ?? `job-${j.id}`
    const g = groups.get(key)
    if (g) g.push(j)
    else groups.set(key, [j])
  }

  const tokens = db.prepare(
    `SELECT COALESCE(SUM(input_tokens), 0) AS tin, COALESCE(SUM(output_tokens), 0) AS tout
     FROM api_calls WHERE kind = 'image.generate' AND job_id IN
     (SELECT value FROM json_each(?))`
  )

  const essais: LabEssai[] = []
  for (const jobs of groups.values()) {
    jobs.sort((a, b) => a.id - b.id)
    const head = jobs[0]
    const step = STEP_OF_TYPE[head.type]
    if (!step) continue
    const { moteur } = moteurOf(head)
    const xl = jobs.some((j) => moteurOf(j).xl)
    const running = jobs.some((j) => j.status === 'queued' || j.status === 'running')
    const errors = jobs.filter((j) => j.status === 'error').length
    const doneJobs = jobs.filter((j) => j.status === 'done')
    const t = tokens.get(JSON.stringify(jobs.map((j) => j.id))) as { tin: number; tout: number }
    const withThumb = doneJobs.find((j) => thumbOf(j) !== null) ?? jobs.find((j) => thumbOf(j) !== null)
    essais.push({
      id: head.id,
      ids: jobs.map((j) => j.id),
      step,
      moteur,
      xl,
      status: running ? 'running' : errors > 0 ? 'error' : 'done',
      done: doneJobs.length,
      errors,
      total: jobs.length,
      createdAt: head.created_at,
      thumbPath: withThumb ? thumbOf(withThumb) : null,
      ...labelsOf(step, jobs),
      inputTokens: t.tin,
      outputTokens: t.tout,
      archived: jobs.every((j) => j.lab_archived_at !== null),
    })
  }

  essais.sort((a, b) => b.id - a.id)
  const archivedCount = essais.filter((e) => e.archived).length
  return {
    essais: essais.filter((e) => e.archived === (opts.archived === true)),
    activeCount: essais.length - archivedCount,
    archivedCount,
  }
}

/**
 * Archive des essais du LAB : `ids` = jobs de tête OU n'importe quel job des
 * groupes visés — tout le groupe (même batch) est archivé d'un bloc. `'all'`
 * archive tous les essais actifs. Seuls les jobs `lab` sont touchés. Retourne
 * le nombre de jobs archivés.
 */
export function archiveLabEssais(
  ids: number[] | 'all',
  db: Database.Database = getDb()
): number {
  if (ids === 'all') {
    return db
      .prepare(
        `UPDATE jobs SET lab_archived_at = datetime('now')
         WHERE lab_archived_at IS NULL AND payload LIKE '%"lab":true%'`
      )
      .run().changes
  }
  if (ids.length === 0) return 0
  // Étend aux groupes complets : un id d'un lancement multi-tailles archive le lot.
  const res = db
    .prepare(
      `UPDATE jobs SET lab_archived_at = datetime('now')
       WHERE lab_archived_at IS NULL AND payload LIKE '%"lab":true%'
         AND (id IN (SELECT value FROM json_each(@ids))
              OR batch_id IN (SELECT batch_id FROM jobs
                              WHERE batch_id IS NOT NULL AND id IN (SELECT value FROM json_each(@ids))))`
    )
    .run({ ids: JSON.stringify(ids) })
  return res.changes
}
