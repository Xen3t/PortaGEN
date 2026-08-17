import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'

/**
 * Bibliothèque des DÉCORS de MES Contrainte (08/08/2026, maquette
 * decors-mes-contrainte-v2) : le paragraphe d'ambiance ({DECOR} des prompts
 * décor autour) devient un objet géré dans l'app — un nom, un texte de prompt
 * LIBRE et des images de référence optionnelles jointes à l'appel Nano.
 *
 * Règles d'accès (décision Mathias 08/08) : création/édition par TOUS les
 * utilisateurs ; décor PAR DÉFAUT et suppression réservés à l'admin. La règle
 * « maison toujours vue de face » ne vit PAS ici : elle est dans le texte figé
 * des prompts moteur, hors d'atteinte des décors custom.
 *
 * Fichiers image : data/mes-decors/<decorId>/<nom> — hors dossiers générés,
 * donc JAMAIS touchés par la remise à zéro (comme la table, hors CLEARED_TABLES).
 */

export interface MesDecorRow {
  id: number
  name: string
  prompt: string
  /** Version RÉÉCRITE par le LLM (obligatoire, 08/08 soir) — c'est ELLE qui
   *  remplit {DECOR} ; null = réécriture pas encore faite (repli : prompt). */
  promptIa: string | null
  /** Aperçu Nano 1K du décor seul (bibliothèque 17/08) — chemin RELATIF
   *  projet sous data/mes-decors/<id>/ ; null = pas encore généré. */
  apercu: string | null
  /** Chemins RELATIFS projet des images de référence (JSON en base). */
  images: string[]
  isDefault: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

interface RawRow {
  id: number
  name: string
  prompt: string
  prompt_ia: string | null
  apercu: string | null
  images: string
  is_default: number
  created_by: string | null
  created_at: string
  updated_at: string
}

function hydrate(r: RawRow): MesDecorRow {
  let images: string[] = []
  try {
    const parsed = JSON.parse(r.images)
    if (Array.isArray(parsed)) images = parsed.filter((p): p is string => typeof p === 'string')
  } catch {
    // JSON illisible = pas d'images (jamais bloquant)
  }
  return {
    id: r.id,
    name: r.name,
    prompt: r.prompt,
    promptIa: r.prompt_ia,
    apercu: r.apercu,
    images,
    isDefault: r.is_default === 1,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

export function listMesDecors(db: Database.Database = getDb()): MesDecorRow[] {
  const rows = db
    .prepare('SELECT * FROM mes_decors ORDER BY is_default DESC, name COLLATE NOCASE')
    .all() as RawRow[]
  return rows.map(hydrate)
}

export function getMesDecor(id: number, db: Database.Database = getDb()): MesDecorRow | undefined {
  const row = db.prepare('SELECT * FROM mes_decors WHERE id = ?').get(id) as RawRow | undefined
  return row ? hydrate(row) : undefined
}

/** Décor appliqué quand aucun n'est demandé — il en existe toujours un (seed). */
export function getMesDecorDefaut(db: Database.Database = getDb()): MesDecorRow | undefined {
  const row = db
    .prepare('SELECT * FROM mes_decors ORDER BY is_default DESC, id LIMIT 1')
    .get() as RawRow | undefined
  return row ? hydrate(row) : undefined
}

export function createMesDecor(
  name: string,
  createdBy: string,
  db: Database.Database = getDb(),
  // Création « en une phrase » (bibliothèque 17/08) : le texte humain et sa
  // version IA arrivent en même temps que le nom.
  champs?: { prompt?: string; promptIa?: string | null }
): MesDecorRow {
  const res = db
    .prepare(`INSERT INTO mes_decors (name, prompt, prompt_ia, created_by) VALUES (?, ?, ?, ?)`)
    .run(name, champs?.prompt ?? '', champs?.promptIa ?? null, createdBy)
  return getMesDecor(Number(res.lastInsertRowid), db)!
}

export function updateMesDecor(
  id: number,
  champs: { name?: string; prompt?: string; promptIa?: string | null },
  db: Database.Database = getDb()
): boolean {
  const decor = getMesDecor(id, db)
  if (!decor) return false
  const res = db
    .prepare(
      `UPDATE mes_decors SET name = ?, prompt = ?, prompt_ia = ?, updated_at = datetime('now') WHERE id = ?`
    )
    .run(
      champs.name ?? decor.name,
      champs.prompt ?? decor.prompt,
      champs.promptIa === undefined ? decor.promptIa : champs.promptIa,
      id
    )
  return res.changes > 0
}

/** Bascule le décor par défaut (admin) : un seul à la fois. */
export function setMesDecorDefaut(id: number, db: Database.Database = getDb()): boolean {
  if (!getMesDecor(id, db)) return false
  db.transaction(() => {
    db.prepare('UPDATE mes_decors SET is_default = 0 WHERE is_default = 1').run()
    db.prepare(`UPDATE mes_decors SET is_default = 1, updated_at = datetime('now') WHERE id = ?`).run(id)
  })()
  return true
}

/**
 * Suppression (admin). Refusée sur le DERNIER décor — il en faut toujours un
 * pour remplir {DECOR}. Si le supprimé était le défaut, le premier restant
 * (ordre alphabétique) le devient. Les fichiers image partent avec.
 */
export function deleteMesDecor(id: number, db: Database.Database = getDb()): { ok: boolean; error?: string } {
  const decor = getMesDecor(id, db)
  if (!decor) return { ok: false, error: 'Décor introuvable' }
  const total = (db.prepare('SELECT COUNT(*) AS n FROM mes_decors').get() as { n: number }).n
  if (total <= 1) {
    return { ok: false, error: 'Impossible de supprimer le dernier décor — il en faut toujours un.' }
  }
  db.transaction(() => {
    db.prepare('DELETE FROM mes_decors WHERE id = ?').run(id)
    if (decor.isDefault) {
      const next = db
        .prepare('SELECT id FROM mes_decors ORDER BY name COLLATE NOCASE LIMIT 1')
        .get() as { id: number } | undefined
      if (next) db.prepare('UPDATE mes_decors SET is_default = 1 WHERE id = ?').run(next.id)
    }
  })()
  fs.rmSync(mesDecorImagesDir(id), { recursive: true, force: true })
  return { ok: true }
}

/** Dossier des images de référence d'un décor (créé à la demande). */
export function mesDecorImagesDir(id: number): string {
  return path.join(config.dataDir, 'mes-decors', String(id))
}

/** Enregistre l'aperçu généré (chemin relatif projet) — l'ancien fichier part. */
export function setMesDecorApercu(
  id: number,
  relPath: string,
  db: Database.Database = getDb()
): MesDecorRow | undefined {
  const decor = getMesDecor(id, db)
  if (!decor) return undefined
  if (decor.apercu && decor.apercu !== relPath) {
    const ancien = path.resolve(config.rootDir, decor.apercu)
    if (ancien.startsWith(mesDecorImagesDir(id) + path.sep)) {
      try {
        fs.rmSync(ancien, { force: true })
      } catch {
        // fichier verrouillé : la base fait foi
      }
    }
  }
  db.prepare(`UPDATE mes_decors SET apercu = ?, updated_at = datetime('now') WHERE id = ?`).run(
    relPath,
    id
  )
  return getMesDecor(id, db)
}

/** Enregistre une image de référence et l'ajoute à la liste du décor. */
export function addMesDecorImage(
  id: number,
  fileName: string,
  buffer: Buffer,
  db: Database.Database = getDb()
): MesDecorRow | undefined {
  const decor = getMesDecor(id, db)
  if (!decor) return undefined
  const dir = mesDecorImagesDir(id)
  fs.mkdirSync(dir, { recursive: true })
  // Nom nettoyé + horodatage : deux ajouts du même fichier ne s'écrasent pas.
  const base = path.basename(fileName).replace(/[^\w.\- ]+/g, '_').slice(0, 80)
  const full = path.join(dir, `${Date.now().toString(36)}-${base}`)
  fs.writeFileSync(full, buffer)
  const rel = path.relative(config.rootDir, full).split(path.sep).join('/')
  const images = [...decor.images, rel]
  db.prepare(`UPDATE mes_decors SET images = ?, updated_at = datetime('now') WHERE id = ?`).run(
    JSON.stringify(images),
    id
  )
  return getMesDecor(id, db)
}

/** Retire une image de référence (liste + fichier). */
export function removeMesDecorImage(
  id: number,
  relPath: string,
  db: Database.Database = getDb()
): MesDecorRow | undefined {
  const decor = getMesDecor(id, db)
  if (!decor) return undefined
  const images = decor.images.filter((p) => p !== relPath)
  db.prepare(`UPDATE mes_decors SET images = ?, updated_at = datetime('now') WHERE id = ?`).run(
    JSON.stringify(images),
    id
  )
  // Anti-évasion : on n'efface que sous le dossier du décor.
  const dir = mesDecorImagesDir(id)
  const full = path.resolve(config.rootDir, relPath)
  if (full.startsWith(dir + path.sep)) {
    try {
      fs.rmSync(full, { force: true })
    } catch {
      // fichier verrouillé : la liste fait foi
    }
  }
  return getMesDecor(id, db)
}
