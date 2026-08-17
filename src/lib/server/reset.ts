import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { config } from '@/lib/config'
import { getDb } from '@/lib/db'

/**
 * Remise à zéro de l'application (Admin → Réglages, maquette remise-a-zero-v2
 * validée le 15/07/2026) : efface tout ce que l'app a PRODUIT — MES et images
 * générées, sessions, historique jobs/API, décors, détourages, réglages par
 * coloris du catalogue — et conserve l'installation : comptes, prompts,
 * gabarits (size_params), images CANNY (data/moteurs/), réglages
 * (app_settings), palette de coloris, feedback, bibliothèque d'images produit
 * (data/products, déposée par l'équipe, pas produite par l'app).
 *
 * Le catalogue scanné (catalog_products), la détection des images
 * (detection_images, detection_examples) et les descriptions produit
 * (produit_descriptions) sont CONSERVÉS (demandes Mathias 28/07 et
 * 08/08/2026) : l'apprentissage de la détection est accroché aux produits par
 * product_id — vider le catalogue changerait les ids au re-scan et perdrait
 * ou mélangerait les exemples appris — et les descriptions sont une
 * bibliothèque constituée, pas une production de l'app. NE JAMAIS ajouter ces
 * tables à CLEARED_TABLES.
 *
 * Une sauvegarde complète (base + images) est créée AVANT toute suppression
 * dans data/sauvegardes/<date>/ (choix Mathias 15/07/2026 : base + images
 * malgré le poids, rien ne doit être perdu définitivement).
 */

/** Dossiers d'images produites par l'app : sauvegardés PUIS vidés. */
const GENERATED_DIRS = ['artifacts', 'generation', 'detourage'] as const

/** Caches recalculables (vignettes catalogue…) : vidés sans sauvegarde. */
const CACHE_DIRS = ['cache'] as const

/** Tables vidées — les enfants avant leurs parents (références). */
const CLEARED_TABLES = [
  'decor_favorites',
  'decor_tags',
  'decor_versions',
  'decors',
  'detourages',
  'catalog_coloris_settings',
  'catalog_coloris_override',
  'generation_sessions',
  'hidden_session_batches',
  'api_calls',
  'jobs',
  'backgrounds',
] as const

export interface ResetStatus {
  running: boolean
  /** Étape en cours (1 sauvegarde base, 2 copie images, 3 données, 4 images) — 0 au repos. */
  step: number
  error: string | null
  /** Dossier de la dernière sauvegarde (relatif projet), une fois terminé. */
  backupDir: string | null
  finishedAt: string | null
}

let status: ResetStatus = {
  running: false,
  step: 0,
  error: null,
  backupDir: null,
  finishedAt: null,
}

export function resetStatus(): ResetStatus {
  return { ...status }
}

/** Paramétrable uniquement pour les tests (base et dossiers jetables). */
export interface ResetDeps {
  db?: Database.Database
  dataDir?: string
  rootDir?: string
}

/** Poids total des images qui seront sauvegardées puis effacées (affichage admin). */
export function generatedBytes(dataDir: string = config.dataDir): number {
  let total = 0
  const walk = (p: string) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile()) total += fs.statSync(full).size
    }
  }
  for (const dir of GENERATED_DIRS) {
    const p = path.join(dataDir, dir)
    if (fs.existsSync(p)) walk(p)
  }
  return total
}

export async function runReset(deps: ResetDeps = {}): Promise<ResetStatus> {
  if (status.running) {
    return { ...status, error: 'Une remise à zéro est déjà en cours.' }
  }
  const db = deps.db ?? getDb()
  const dataDir = deps.dataDir ?? config.dataDir
  const rootDir = deps.rootDir ?? config.rootDir
  // Effacer les fichiers sous un job actif le ferait planter en plein vol.
  const active = db
    .prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued', 'running')`)
    .get() as { n: number }
  if (active.n > 0) {
    return {
      ...status,
      error: `${active.n} génération(s) en cours — attendre la fin ou les annuler avant de remettre à zéro.`,
    }
  }

  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(
    d.getHours()
  )}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  const backupDir = path.join(dataDir, 'sauvegardes', stamp)

  status = { running: true, step: 1, error: null, backupDir: null, finishedAt: null }
  try {
    // 1. Sauvegarde de la base — l'API backup de SQLite donne une copie cohérente
    //    même en WAL, contrairement à une copie brute des fichiers .db/.wal.
    fs.mkdirSync(backupDir, { recursive: true })
    await db.backup(path.join(backupDir, 'portagen.db'))

    // 2. Copie des images générées dans la sauvegarde.
    status.step = 2
    for (const dir of GENERATED_DIRS) {
      const src = path.join(dataDir, dir)
      if (fs.existsSync(src)) fs.cpSync(src, path.join(backupDir, dir), { recursive: true })
    }

    // 3. Suppression des données générées, puis VACUUM pour rendre sa taille
    //    d'origine au fichier de base (hors transaction, SQLite l'exige).
    status.step = 3
    db.transaction(() => {
      for (const table of CLEARED_TABLES) db.prepare(`DELETE FROM ${table}`).run()
    })()
    db.exec('VACUUM')

    // 4. Suppression des images — dossiers recréés vides, comme au premier lancement.
    status.step = 4
    for (const dir of [...GENERATED_DIRS, ...CACHE_DIRS]) {
      const p = path.join(dataDir, dir)
      fs.rmSync(p, { recursive: true, force: true })
      fs.mkdirSync(p, { recursive: true })
    }

    status = {
      running: false,
      step: 0,
      error: null,
      backupDir: path.relative(rootDir, backupDir).split(path.sep).join('/'),
      finishedAt: new Date().toISOString(),
    }
  } catch (err) {
    status = {
      running: false,
      step: 0,
      error: err instanceof Error ? err.message : String(err),
      backupDir: null,
      finishedAt: null,
    }
  }
  return resetStatus()
}
