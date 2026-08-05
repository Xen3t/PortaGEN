import type Database from 'better-sqlite3'
import { getDb, listJobsByBatch } from '@/lib/db'
import { normalizeDecorPath } from '@/lib/db/decors'

/**
 * Sessions de génération directe (validé le 13/07/2026, maquette sessions-v1) :
 * un lancement depuis la page « Génération » = une session. La ligne en base ne
 * porte que ce que les jobs ne savent pas (nom du produit, décor, moteur) — tout
 * le reste (avancement, MES, MP) se recalcule depuis les jobs du batch.
 *
 * Suppression : on efface la LIGNE de session uniquement — les jobs et les images
 * restent visibles dans Production (traçabilité), seuls l'accueil et la liste des
 * sessions ne la proposent plus.
 */

export interface GenerationSessionRow {
  batch_id: string
  produit: string
  moteur: string
  decor_id: number | null
  created_by: string | null
  created_at: string
}

/** Résumé d'une session pour les cartes de l'accueil (calculé depuis les jobs). */
export interface GenerationSessionSummary {
  batchId: string
  produit: string
  moteur: string
  decorId: number | null
  decorName: string | null
  createdAt: string
  /**
   * Origine de la session (maquette sessions-v2, validée le 13/07/2026) :
   * « directe » = page Génération, « catalogue » = lancement de gamme depuis
   * la page produit, « decor » = tirages de décor (28/07/2026), « decor-autour »
   * = nouveau mode « décor autour » (bascule 05/08/2026 — la carte ouvre
   * /generation/decor-autour). La carte catalogue ouvre la page de la gamme,
   * la carte décor ouvre MES Décors.
   */
  source: 'directe' | 'catalogue' | 'decor' | 'libre' | 'decor-autour'
  /** Nombre d'images du lot (un job Piliers par image déposée). */
  mesCount: number
  /** Nombre de MES finales déjà sorties — la progression « 3/5 images ». */
  mesDone: number
  /** Coloris distincts du lot, dans l'ordre d'apparition. */
  coloris: string[]
  /** true si au moins une déclinaison Marketplace a été lancée. */
  mpDone: boolean
  /** true si des jobs tournent encore (file ou en cours). */
  busy: boolean
  /** true si plus rien ne tourne et qu'aucune MES n'est sortie. */
  failed: boolean
  /** Chemin de la première MES prête (aperçu de la carte), sinon celui du décor. */
  thumbPath: string | null
}

export function createGenerationSession(
  // decorId null (05/08/2026) : une session « décor autour » n'a pas de décor —
  // Nano peint l'entrée autour du produit posé.
  input: { batchId: string; produit: string; moteur: string; decorId: number | null; createdBy: string },
  db: Database.Database = getDb()
): void {
  db.prepare(
    `INSERT INTO generation_sessions (batch_id, produit, moteur, decor_id, created_by)
     VALUES (?, ?, ?, ?, ?)`
  ).run(input.batchId, input.produit, input.moteur, input.decorId, input.createdBy)
}

export function getGenerationSession(
  batchId: string,
  db: Database.Database = getDb()
): GenerationSessionRow | undefined {
  return db
    .prepare('SELECT * FROM generation_sessions WHERE batch_id = ?')
    .get(batchId) as GenerationSessionRow | undefined
}

export function listGenerationSessions(
  createdBy: string,
  limit = 50,
  db: Database.Database = getDb()
): GenerationSessionRow[] {
  return db
    .prepare(
      'SELECT * FROM generation_sessions WHERE created_by = ? ORDER BY created_at DESC, batch_id DESC LIMIT ?'
    )
    .all(createdBy, limit) as GenerationSessionRow[]
}

export function deleteGenerationSession(batchId: string, db: Database.Database = getDb()): void {
  db.prepare('DELETE FROM generation_sessions WHERE batch_id = ?').run(batchId)
}

/**
 * Masque un lancement de gamme (carte Catalogue) de « Mes sessions » : pas de
 * ligne de session à effacer, on inscrit le lot dans hidden_session_batches.
 * Jobs et images conservés — la gamme reste consultable depuis le Catalogue.
 */
export function hideSessionBatch(
  batchId: string,
  createdBy: string,
  db: Database.Database = getDb()
): void {
  db.prepare(
    'INSERT OR IGNORE INTO hidden_session_batches (batch_id, created_by) VALUES (?, ?)'
  ).run(batchId, createdBy)
}

/** true si le lot contient au moins un job créé par cet utilisateur. */
export function batchBelongsTo(
  batchId: string,
  username: string,
  db: Database.Database = getDb()
): boolean {
  return (
    db.prepare('SELECT 1 FROM jobs WHERE batch_id = ? AND created_by = ? LIMIT 1').get(
      batchId,
      username
    ) !== undefined
  )
}

/** Construit le résumé « carte » d'une session depuis ses jobs. */
export function summarizeGenerationSession(
  row: GenerationSessionRow,
  db: Database.Database = getDb()
): GenerationSessionSummary {
  const jobs = listJobsByBatch(row.batch_id, db)
  const decor = row.decor_id
    ? (db.prepare('SELECT name, file_path FROM decors WHERE id = ?').get(row.decor_id) as
        | { name: string; file_path: string }
        | undefined)
    : undefined

  const coloris: string[] = []
  // Générations multiples (29/07/2026) : on compte PAR TAILLE (case), pas par
  // génération — sinon 2 tailles × 3 générations afficheraient « 6 MES » sur
  // l'accueil. Clé de taille = coloris + dimensions.
  const totalSlots = new Set<string>()
  const doneSlots = new Set<string>()
  let anyError = false
  let mpDone = false
  let busy = false
  let thumbPath: string | null = null
  const slotKey = (payload: Record<string, unknown>): string => {
    const col = typeof payload.coloris === 'string' ? payload.coloris.toLowerCase() : ''
    const s = payload.size as { w?: number; h?: number } | undefined
    return `${col}|${s?.w ?? '?'}x${s?.h ?? '?'}`
  }

  // Bascule « décor autour » (05/08/2026) : un batch decor-autour est une session
  // du NOUVEAU mode — sa carte ouvre /generation/decor-autour, pas le legacy.
  let hasDecorAutour = false

  for (const j of jobs) {
    let payload: Record<string, unknown> = {}
    let result: Record<string, unknown> = {}
    try {
      payload = j.payload ? JSON.parse(j.payload) : {}
      result = j.result ? JSON.parse(j.result) : {}
    } catch {
      // payload illisible : le job compte quand même dans l'avancement
    }
    if (j.status === 'queued' || j.status === 'running') busy = true
    if (j.status === 'error') anyError = true
    if (j.type === 'marketplace') mpDone = true
    if (j.type === 'decor-autour') hasDecorAutour = true
    // « pose-fusion » (17/07/2026) et « decor-autour » (05/08/2026) : UN job = une
    // MES complète — il compte à la fois dans le total (comme les piliers) et dans
    // le terminé (comme l'intégration).
    if (j.type === 'pillars' || j.type === 'pose-fusion' || j.type === 'decor-autour') {
      totalSlots.add(slotKey(payload))
      const col = typeof payload.coloris === 'string' ? payload.coloris : ''
      if (col && !coloris.includes(col)) coloris.push(col)
    }
    if (j.type === 'integration' || j.type === 'pose-fusion' || j.type === 'decor-autour') {
      const dp = typeof result.deliveryPath === 'string' ? result.deliveryPath : null
      if (j.status === 'done' && dp) {
        doneSlots.add(slotKey(payload))
        if (!thumbPath) thumbPath = dp
      }
    }
  }

  return {
    batchId: row.batch_id,
    produit: row.produit,
    moteur: row.moteur,
    decorId: row.decor_id,
    decorName: decor?.name ?? null,
    createdAt: row.created_at,
    source: hasDecorAutour ? 'decor-autour' : 'directe',
    mesCount: totalSlots.size,
    mesDone: doneSlots.size,
    coloris,
    mpDone,
    busy,
    failed: !busy && doneSlots.size === 0 && anyError,
    thumbPath: thumbPath ?? decor?.file_path ?? null,
  }
}

/**
 * Résumé « carte » d'un batch SANS ligne generation_sessions : lancement de
 * gamme (Catalogue, sessions-v2 du 13/07/2026) ou tirages de décor (28/07/2026,
 * demande Mathias : un lancement de décor = une session). Tout se lit dans les
 * jobs du batch. Renvoie null si le batch ne contient ni MES ni décor (ex.
 * batch marketplace seul, ou essais du Lab moteur — jamais sur l'accueil).
 */
function summarizeCatalogueBatch(
  batchId: string,
  createdAt: string,
  db: Database.Database = getDb()
): GenerationSessionSummary | null {
  const jobs = listJobsByBatch(batchId, db)

  let produit = ''
  let moteur = 'battant'
  const coloris: string[] = []
  // Générations multiples (29/07/2026) : MES comptées PAR TAILLE (case), pas par
  // génération. Clé = coloris + dimensions.
  const totalSlots = new Set<string>()
  const doneSlots = new Set<string>()
  const slotKey = (payload: Record<string, unknown>): string => {
    const col = typeof payload.coloris === 'string' ? payload.coloris.toLowerCase() : ''
    const s = payload.size as { w?: number; h?: number } | undefined
    return `${col}|${s?.w ?? '?'}x${s?.h ?? '?'}`
  }
  let anyError = false
  let mpDone = false
  let busy = false
  let thumbPath: string | null = null
  // Tirages de décor : comptés à part — un batch 100 % décor devient une
  // session « decor » (le total/terminé réutilise mesCount/mesDone des cartes).
  let decorCount = 0
  let decorDone = 0
  let decorGamme = ''
  let decorNom = ''
  let decorMoodboard = ''
  // MES Libres (28/07/2026) : un batch 100 % libre devient une session « libre »
  // — total/terminé = variantes, vignette = première variante sortie.
  let libreCount = 0
  let libreDone = 0
  let libreLabel = ''

  for (const j of jobs) {
    let payload: Record<string, unknown> = {}
    let result: Record<string, unknown> = {}
    try {
      payload = j.payload ? JSON.parse(j.payload) : {}
      result = j.result ? JSON.parse(j.result) : {}
    } catch {
      // payload illisible : le job compte quand même dans l'avancement
    }
    if (payload.lab === true) return null
    if (j.status === 'queued' || j.status === 'running') busy = true
    if (j.status === 'error') anyError = true
    if (j.type === 'marketplace' || j.type === 'libre-mp') mpDone = true
    if (typeof payload.moteur === 'string' && payload.moteur) moteur = payload.moteur
    if (j.type === 'libre') {
      libreCount++
      if (!libreLabel && typeof payload.productLabel === 'string') libreLabel = payload.productLabel
      const img = typeof result.imagePath === 'string' ? result.imagePath : null
      if (j.status === 'done' && img) {
        libreDone++
        if (!thumbPath) thumbPath = img
      }
    }
    if (j.type === 'decor') {
      decorCount++
      if (!decorNom && typeof payload.name === 'string') decorNom = payload.name
      if (!decorGamme && typeof payload.gamme === 'string' && payload.gamme) decorGamme = payload.gamme
      if (!decorMoodboard && typeof payload.moodboardPath === 'string') decorMoodboard = payload.moodboardPath
      const img = typeof result.imagePath === 'string' ? result.imagePath : null
      if (j.status === 'done') {
        decorDone++
        if (img && !thumbPath) thumbPath = img
      }
    }
    // « pose-fusion » (17/07/2026) et « decor-autour » (05/08/2026) : UN job =
    // une MES complète (total ET terminé).
    if (j.type === 'pillars' || j.type === 'pose-fusion' || j.type === 'decor-autour') {
      totalSlots.add(slotKey(payload))
      const col = typeof payload.coloris === 'string' ? payload.coloris : ''
      if (col && !coloris.includes(col)) coloris.push(col)
    }
    if (j.type === 'integration' || j.type === 'pose-fusion' || j.type === 'decor-autour') {
      const fp =
        (typeof result.deliveryPath === 'string' && result.deliveryPath) ||
        (typeof result.compositePath === 'string' && result.compositePath) ||
        null
      if (j.status === 'done' && fp) {
        doneSlots.add(slotKey(payload))
        if (!thumbPath) thumbPath = fp
      }
    }
    // Nom de la gamme : la fiche catalogue d'abord, sinon le dossier du visuel.
    if (!produit) {
      const pid = Number(payload.catalogProductId)
      if (Number.isInteger(pid) && pid > 0) {
        const p = db.prepare('SELECT name FROM catalog_products WHERE id = ?').get(pid) as
          | { name: string }
          | undefined
        if (p) produit = p.name
      }
      if (!produit && typeof payload.productPath === 'string') {
        const parts = payload.productPath.split(/[\\/]/)
        const i = parts.indexOf('products')
        if (i >= 0 && i + 2 < parts.length) produit = parts[i + 1]
      }
    }
  }
  // Comptes MES ramenés au nombre de TAILLES (une case = une génération retenue).
  const mesCount = totalSlots.size
  const doneMes = doneSlots.size
  // Batch 100 % décor → session « decor » : total/terminé = tirages, vignette =
  // premier décor sorti (sinon le moodboard), nom = décor sinon gamme.
  if (mesCount === 0 && decorCount > 0) {
    return {
      batchId,
      produit: decorNom || decorGamme || 'Décor',
      moteur,
      decorId: null,
      decorName: decorGamme || null,
      createdAt,
      source: 'decor',
      mesCount: decorCount,
      mesDone: decorDone,
      coloris: [],
      mpDone: false,
      busy,
      failed: !busy && decorDone === 0 && anyError,
      thumbPath: thumbPath ?? (decorMoodboard ? normalizeDecorPath(decorMoodboard) : null),
    }
  }
  // Batch 100 % MES Libres → session « libre » : réouverture via
  // /generation?libre=<batch>, nom = type/catégorie saisi au lancement.
  if (mesCount === 0 && libreCount > 0) {
    return {
      batchId,
      produit: libreLabel || 'MES Libre',
      moteur: 'libre',
      decorId: null,
      decorName: null,
      createdAt,
      source: 'libre',
      mesCount: libreCount,
      mesDone: libreDone,
      coloris: [],
      mpDone,
      busy,
      failed: !busy && libreDone === 0 && anyError,
      thumbPath,
    }
  }
  if (mesCount === 0) return null

  return {
    batchId,
    produit: produit || 'Gamme',
    moteur,
    decorId: null,
    decorName: null,
    createdAt,
    source: 'catalogue',
    mesCount,
    mesDone: doneMes,
    coloris,
    mpDone,
    busy,
    failed: !busy && doneMes === 0 && anyError,
    thumbPath,
  }
}

/**
 * Toutes les sessions de l'utilisateur, directes ET lancements de gamme,
 * mélangées et triées des plus récentes aux plus anciennes (sessions-v2).
 */
export function listAllSessions(
  createdBy: string,
  limit = 50,
  db: Database.Database = getDb()
): GenerationSessionSummary[] {
  const direct = listGenerationSessions(createdBy, limit, db).map((row) =>
    summarizeGenerationSession(row, db)
  )
  const batchRows = db
    .prepare(
      `SELECT batch_id, MIN(created_at) AS created_at FROM jobs
       WHERE created_by = ? AND batch_id IS NOT NULL
         AND batch_id NOT IN (SELECT batch_id FROM generation_sessions)
         AND batch_id NOT IN (SELECT batch_id FROM hidden_session_batches)
       GROUP BY batch_id ORDER BY created_at DESC LIMIT ?`
    )
    .all(createdBy, limit) as { batch_id: string; created_at: string }[]
  const catalogue = batchRows
    .map((r) => summarizeCatalogueBatch(r.batch_id, r.created_at, db))
    .filter((s): s is GenerationSessionSummary => s !== null)

  return [...direct, ...catalogue]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
}
