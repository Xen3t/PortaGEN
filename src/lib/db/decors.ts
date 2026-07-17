import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'
import { NATIVE_DIMS } from '@/lib/pipeline/nativeFormats'
import type { ImageSize } from '@/lib/genai/client'

/**
 * Bibliothèque de décors : chaque décor généré (étape 1 du pipeline) est référencé
 * en base avec ses métadonnées (nom, gamme, type, angle, statut, tags, favoris).
 *
 * Circuit des statuts (décision Mathias 09/07/2026) :
 *   a_valider (naissance) → actif (validation ADMIN, seuls les actifs sont proposés
 *   au choix) → archive (sortie de circulation, ouvert à tous, réversible).
 * Suppression définitive : admin uniquement, refusée si le décor a servi à une
 * génération validée (traçabilité) — l'archivage est alors la seule issue.
 */

export const DECOR_TYPES = ['battant', 'coulissant', 'portillon'] as const
export const DECOR_ANGLES = ['face', 'angle'] as const
export const DECOR_STATUSES = ['a_valider', 'actif', 'archive'] as const

export type DecorType = (typeof DECOR_TYPES)[number]
export type DecorAngle = (typeof DECOR_ANGLES)[number]
export type DecorStatus = (typeof DECOR_STATUSES)[number]

export interface DecorRow {
  id: number
  file_path: string
  name: string
  slug: string
  gamme: string | null
  type: DecorType
  angle: DecorAngle
  status: DecorStatus
  image_size: string | null
  width: number | null
  height: number | null
  moodboard_path: string | null
  job_id: number | null
  created_at: string
}

export interface DecorWithMeta extends DecorRow {
  tags: string[]
  favorite: boolean
  lastUsedAt: string | null
  lastUsedJobId: number | null
  versionCount: number
}

/** Chemins stockés en base avec des « / » (portables, et stables entre OS). */
export function normalizeDecorPath(p: string): string {
  const rel = path.isAbsolute(p) ? path.relative(config.rootDir, p) : p
  return rel.split(path.sep).join('/').split('\\').join('/')
}

export interface RegisterDecorInput {
  filePath: string
  name: string
  slug: string
  gamme?: string | null
  type?: DecorType
  angle?: DecorAngle
  status?: DecorStatus
  imageSize?: string | null
  width?: number | null
  height?: number | null
  moodboardPath?: string | null
  jobId?: number | null
  createdAt?: string
}

/** Référence un décor (idempotent : un fichier déjà connu n'est pas dupliqué). */
export function registerDecor(input: RegisterDecorInput, db: Database.Database = getDb()): number {
  const filePath = normalizeDecorPath(input.filePath)
  const existing = db.prepare('SELECT id FROM decors WHERE file_path = ?').get(filePath) as
    | { id: number }
    | undefined
  if (existing) {
    ensureInitialVersion(existing.id, db)
    return existing.id
  }
  const res = db
    .prepare(
      `INSERT INTO decors (file_path, name, slug, gamme, type, angle, status, image_size, width, height, moodboard_path, job_id, created_at)
       VALUES (@filePath, @name, @slug, @gamme, @type, @angle, @status, @imageSize, @width, @height, @moodboardPath, @jobId, COALESCE(@createdAt, datetime('now')))`
    )
    .run({
      filePath,
      name: input.name,
      slug: input.slug,
      gamme: input.gamme ?? null,
      type: input.type ?? 'battant',
      angle: input.angle ?? 'face',
      status: input.status ?? 'a_valider',
      imageSize: input.imageSize ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      moodboardPath: input.moodboardPath ? normalizeDecorPath(input.moodboardPath) : null,
      jobId: input.jobId ?? null,
      createdAt: input.createdAt ?? null,
    })
  const id = Number(res.lastInsertRowid)
  ensureInitialVersion(id, db)
  return id
}

// ---------------------------------------------------------------------------
// Versions : chaque décor garde tout son historique (tirage initial, corrections
// par prompt, restaurations). `decors.file_path` pointe la version COURANTE.
// ---------------------------------------------------------------------------

export type DecorVersionKind = 'initial' | 'correction' | 'restauration'

export interface DecorVersionRow {
  id: number
  decor_id: number
  version: number
  file_path: string
  kind: DecorVersionKind
  instruction: string | null
  job_id: number | null
  created_at: string
}

/** Garantit la version 1 (image d'origine) — utile pour les décors historiques. */
export function ensureInitialVersion(decorId: number, db: Database.Database = getDb()): void {
  const has = db.prepare('SELECT 1 FROM decor_versions WHERE decor_id = ? LIMIT 1').get(decorId)
  if (has) return
  const row = db
    .prepare('SELECT file_path, job_id, created_at FROM decors WHERE id = ?')
    .get(decorId) as { file_path: string; job_id: number | null; created_at: string } | undefined
  if (!row) return
  db.prepare(
    `INSERT INTO decor_versions (decor_id, version, file_path, kind, job_id, created_at)
     VALUES (?, 1, ?, 'initial', ?, ?)`
  ).run(decorId, row.file_path, row.job_id, row.created_at)
}

export function listDecorVersions(
  decorId: number,
  db: Database.Database = getDb()
): DecorVersionRow[] {
  ensureInitialVersion(decorId, db)
  return db
    .prepare('SELECT * FROM decor_versions WHERE decor_id = ? ORDER BY version DESC')
    .all(decorId) as DecorVersionRow[]
}

/**
 * Enregistre une nouvelle version (correction ou restauration) et la rend
 * COURANTE. Une correction repasse le décor « À valider » (nouvelle image =
 * nouvelle validation) ; une restauration conserve le statut.
 */
export function addDecorVersion(
  decorId: number,
  input: {
    filePath: string
    kind: Exclude<DecorVersionKind, 'initial'>
    instruction?: string | null
    jobId?: number | null
    width?: number | null
    height?: number | null
  },
  db: Database.Database = getDb()
): DecorVersionRow {
  ensureInitialVersion(decorId, db)
  const filePath = normalizeDecorPath(input.filePath)
  const next =
    ((db
      .prepare('SELECT MAX(version) AS v FROM decor_versions WHERE decor_id = ?')
      .get(decorId) as { v: number | null }).v ?? 0) + 1
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO decor_versions (decor_id, version, file_path, kind, instruction, job_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(decorId, next, filePath, input.kind, input.instruction ?? null, input.jobId ?? null)
    const sets = ['file_path = @filePath']
    const params: Record<string, unknown> = { id: decorId, filePath }
    if (input.width != null) {
      sets.push('width = @width')
      params.width = input.width
    }
    if (input.height != null) {
      sets.push('height = @height')
      params.height = input.height
    }
    if (input.kind === 'correction') sets.push(`status = 'a_valider'`)
    db.prepare(`UPDATE decors SET ${sets.join(', ')} WHERE id = @id`).run(params)
  })
  tx()
  return db
    .prepare('SELECT * FROM decor_versions WHERE decor_id = ? AND version = ?')
    .get(decorId, next) as DecorVersionRow
}

/** Restaure une ancienne version : elle redevient courante via une nouvelle entrée d'historique. */
export function restoreDecorVersion(
  decorId: number,
  versionId: number,
  db: Database.Database = getDb()
): DecorVersionRow | null {
  const version = db
    .prepare('SELECT * FROM decor_versions WHERE id = ? AND decor_id = ?')
    .get(versionId, decorId) as DecorVersionRow | undefined
  if (!version) return null
  const current = db.prepare('SELECT file_path FROM decors WHERE id = ?').get(decorId) as
    | { file_path: string }
    | undefined
  if (!current) return null
  if (current.file_path === version.file_path) return version
  return addDecorVersion(
    decorId,
    {
      filePath: version.file_path,
      kind: 'restauration',
      instruction: `Retour à la version ${version.version}`,
    },
    db
  )
}

export function getDecor(id: number, db: Database.Database = getDb()): DecorRow | undefined {
  return db.prepare('SELECT * FROM decors WHERE id = ?').get(id) as DecorRow | undefined
}

export function getDecorByPath(
  filePath: string,
  db: Database.Database = getDb()
): DecorRow | undefined {
  return db
    .prepare('SELECT * FROM decors WHERE file_path = ?')
    .get(normalizeDecorPath(filePath)) as DecorRow | undefined
}

const EDITABLE_FIELDS = ['name', 'gamme', 'type', 'angle', 'status'] as const
export type DecorEditableField = (typeof EDITABLE_FIELDS)[number]

export function updateDecor(
  id: number,
  fields: Partial<Pick<DecorRow, DecorEditableField>>,
  db: Database.Database = getDb()
): void {
  const sets: string[] = []
  const params: Record<string, unknown> = { id }
  for (const key of EDITABLE_FIELDS) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = @${key}`)
      params[key] = fields[key]
    }
  }
  if (sets.length === 0) return
  db.prepare(`UPDATE decors SET ${sets.join(', ')} WHERE id = @id`).run(params)
}

/** Remplace l'intégralité des tags d'un décor (normalisés, dédoublonnés). */
export function setDecorTags(id: number, tags: string[], db: Database.Database = getDb()): void {
  const clean = sanitizeTags(tags)
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM decor_tags WHERE decor_id = ?').run(id)
    const insert = db.prepare('INSERT OR IGNORE INTO decor_tags (decor_id, tag) VALUES (?, ?)')
    for (const tag of clean) insert.run(id, tag)
  })
  tx()
}

/** Ajoute des tags sans toucher aux existants (action groupée « Taguer »). */
export function addDecorTags(id: number, tags: string[], db: Database.Database = getDb()): void {
  const insert = db.prepare('INSERT OR IGNORE INTO decor_tags (decor_id, tag) VALUES (?, ?)')
  for (const tag of sanitizeTags(tags)) insert.run(id, tag)
}

export function sanitizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const out: string[] = []
  for (const t of tags) {
    if (typeof t !== 'string') continue
    const clean = t.trim().replace(/\s+/g, ' ').slice(0, 40)
    if (!clean) continue
    if (!out.some((x) => x.localeCompare(clean, 'fr', { sensitivity: 'base' }) === 0)) {
      out.push(clean)
    }
  }
  return out.slice(0, 12)
}

export function listAllTags(db: Database.Database = getDb()): string[] {
  return (db.prepare('SELECT DISTINCT tag FROM decor_tags ORDER BY tag COLLATE NOCASE').all() as {
    tag: string
  }[]).map((r) => r.tag)
}

export function listGammes(db: Database.Database = getDb()): string[] {
  return (db
    .prepare(
      `SELECT DISTINCT gamme FROM decors WHERE gamme IS NOT NULL AND gamme != '' ORDER BY gamme COLLATE NOCASE`
    )
    .all() as { gamme: string }[]).map((r) => r.gamme)
}

/** Bascule le favori de l'utilisateur (les favoris sont PAR utilisateur). */
export function toggleFavorite(
  userId: number,
  decorId: number,
  db: Database.Database = getDb()
): boolean {
  const existing = db
    .prepare('SELECT 1 FROM decor_favorites WHERE user_id = ? AND decor_id = ?')
    .get(userId, decorId)
  if (existing) {
    db.prepare('DELETE FROM decor_favorites WHERE user_id = ? AND decor_id = ?').run(
      userId,
      decorId
    )
    return false
  }
  db.prepare('INSERT INTO decor_favorites (user_id, decor_id) VALUES (?, ?)').run(userId, decorId)
  return true
}

/**
 * Motifs de recherche du chemin d'un décor dans les payloads de jobs (JSON TEXT).
 * Deux formes coexistent : chemins « / » (bibliothèque) et chemins Windows
 * échappés en JSON (« \\ ») des jobs historiques.
 */
function payloadNeedles(filePath: string): string[] {
  const fwd = normalizeDecorPath(filePath)
  const back = fwd.split('/').join('\\')
  const backJson = JSON.stringify(back).slice(1, -1) // \ → \\ comme dans le JSON stocké
  return [...new Set([fwd, backJson])]
}

export interface DecorLastUse {
  at: string
  jobId: number
  jobType: string
}

/** Dernière génération (piliers/intégration) ayant utilisé ce décor. */
export function getDecorLastUse(
  filePath: string,
  db: Database.Database = getDb()
): DecorLastUse | null {
  for (const needle of payloadNeedles(filePath)) {
    const row = db
      .prepare(
        `SELECT id, type, created_at FROM jobs
         WHERE type != 'decor' AND payload LIKE '%' || ? || '%'
         ORDER BY id DESC LIMIT 1`
      )
      .get(needle) as { id: number; type: string; created_at: string } | undefined
    if (row) return { at: row.created_at, jobId: row.id, jobType: row.type }
  }
  return null
}

/**
 * true si le décor a servi à une génération VALIDÉE → suppression interdite.
 * Toutes les versions du décor sont vérifiées, pas seulement la courante.
 */
export function decorUsedByValidatedJob(
  filePath: string,
  db: Database.Database = getDb()
): boolean {
  const decor = getDecorByPath(filePath, db)
  const paths = new Set([normalizeDecorPath(filePath)])
  if (decor) {
    for (const v of listDecorVersions(decor.id, db)) paths.add(v.file_path)
  }
  for (const p of paths) {
    for (const needle of payloadNeedles(p)) {
      const row = db
        .prepare(
          `SELECT 1 FROM jobs
           WHERE type != 'decor' AND review_status = 'approved' AND payload LIKE '%' || ? || '%'
           LIMIT 1`
        )
        .get(needle)
      if (row) return true
    }
  }
  return false
}

/** Supprime l'entrée en base (tags, favoris, versions). Les fichiers sont gérés par l'appelant. */
export function deleteDecorRow(id: number, db: Database.Database = getDb()): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM decor_tags WHERE decor_id = ?').run(id)
    db.prepare('DELETE FROM decor_favorites WHERE decor_id = ?').run(id)
    db.prepare('DELETE FROM decor_versions WHERE decor_id = ?').run(id)
    db.prepare('DELETE FROM decors WHERE id = ?').run(id)
  })
  tx()
}

/** Passe en « actif » le décor issu d'un job (pont Suivi & validation → bibliothèque). */
export function activateDecorByJob(jobId: number, db: Database.Database = getDb()): void {
  db.prepare(`UPDATE decors SET status = 'actif' WHERE job_id = ? AND status = 'a_valider'`).run(
    jobId
  )
}

/** Liste complète pour l'interface, avec tags, favori de l'utilisateur et dernière utilisation. */
export function listDecorLibrary(
  userId: number,
  db: Database.Database = getDb()
): DecorWithMeta[] {
  const rows = db.prepare('SELECT * FROM decors ORDER BY created_at DESC, id DESC').all() as DecorRow[]
  const tagRows = db.prepare('SELECT decor_id, tag FROM decor_tags ORDER BY tag COLLATE NOCASE').all() as {
    decor_id: number
    tag: string
  }[]
  const favRows = db
    .prepare('SELECT decor_id FROM decor_favorites WHERE user_id = ?')
    .all(userId) as { decor_id: number }[]
  const tagsById = new Map<number, string[]>()
  for (const t of tagRows) {
    const list = tagsById.get(t.decor_id) ?? []
    list.push(t.tag)
    tagsById.set(t.decor_id, list)
  }
  const favIds = new Set(favRows.map((f) => f.decor_id))
  const versionCounts = new Map(
    (db
      .prepare('SELECT decor_id, COUNT(*) AS n FROM decor_versions GROUP BY decor_id')
      .all() as { decor_id: number; n: number }[]).map((r) => [r.decor_id, r.n])
  )
  return rows.map((row) => {
    const use = getDecorLastUse(row.file_path, db)
    return {
      ...row,
      tags: tagsById.get(row.id) ?? [],
      favorite: favIds.has(row.id),
      lastUsedAt: use?.at ?? null,
      lastUsedJobId: use?.jobId ?? null,
      versionCount: versionCounts.get(row.id) ?? 1,
    }
  })
}

/** Nom lisible dérivé d'un slug de dossier (« background-1-portail-battant-veymont »). */
export function prettifySlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => (/^\d+$/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
}

const DECOR_FILE_RE = /^decor-(1K|2K|4K)-.*\.(png|jpe?g)$/i

/**
 * Réconcilie la base avec le disque : les fichiers décor inconnus sont référencés
 * (statut « actif » : ils précèdent le circuit de validation), les entrées dont le
 * fichier a disparu sont retirées. `decorRoot` n'est paramétrable que pour les tests.
 */
export function syncDecorsFromDisk(
  db: Database.Database = getDb(),
  decorRoot: string = path.join(config.artifactsDir, 'decor')
): void {
  const onDisk = new Set<string>()
  if (fs.existsSync(decorRoot)) {
    for (const slug of fs.readdirSync(decorRoot)) {
      const dir = path.join(decorRoot, slug)
      if (!fs.statSync(dir).isDirectory()) continue
      for (const file of fs.readdirSync(dir)) {
        const m = file.match(DECOR_FILE_RE)
        if (!m) continue
        const full = path.join(dir, file)
        const rel = normalizeDecorPath(full)
        onDisk.add(rel)
        // Connu comme décor OU comme ancienne version d'un décor → pas une nouveauté.
        const known =
          db.prepare('SELECT 1 FROM decors WHERE file_path = ?').get(rel) ??
          db.prepare('SELECT 1 FROM decor_versions WHERE file_path = ?').get(rel)
        if (known) continue
        const imageSize = m[1].toUpperCase() as ImageSize
        const dims = NATIVE_DIMS[imageSize]
        const mtime = fs.statSync(full).mtime
        const stamp = `${String(mtime.getDate()).padStart(2, '0')}/${String(
          mtime.getMonth() + 1
        ).padStart(2, '0')} ${String(mtime.getHours()).padStart(2, '0')}:${String(
          mtime.getMinutes()
        ).padStart(2, '0')}`
        registerDecor(
          {
            filePath: rel,
            name: `${prettifySlug(slug)} · ${stamp}`,
            slug,
            status: 'actif',
            imageSize,
            width: dims?.width ?? null,
            height: dims?.height ?? null,
            createdAt: mtime.toISOString(),
          },
          db
        )
      }
    }
  }
  // Entrées orphelines (fichier supprimé à la main sur le disque)
  const known = db.prepare('SELECT id, file_path FROM decors').all() as {
    id: number
    file_path: string
  }[]
  for (const row of known) {
    if (onDisk.has(row.file_path)) continue
    const abs = path.resolve(config.rootDir, row.file_path)
    if (!fs.existsSync(abs)) deleteDecorRow(row.id, db)
  }
}
