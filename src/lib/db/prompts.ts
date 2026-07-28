import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'

export interface PromptRow {
  id: number
  name: string
  version: number
  content: string
  comment: string | null
  created_by: string | null
  created_at: string
}

/** Dernière version d'un prompt système — celle qu'utilisent les pipelines. */
export function getActivePrompt(name: string, db: Database.Database = getDb()): PromptRow {
  const row = db
    .prepare('SELECT * FROM prompts WHERE name = ? ORDER BY version DESC LIMIT 1')
    .get(name) as PromptRow | undefined
  if (!row) throw new Error(`Prompt système introuvable : ${name}`)
  return row
}

export function listPromptNames(
  db: Database.Database = getDb()
): { name: string; version: number; updated: string; updatedBy: string | null }[] {
  // Date ET auteur viennent de la ligne de la version active (refonte Prompt
  // System 28/07/2026, maquette prompt-system-v6 : « 28/07 · Mathias » sur
  // chaque ligne fermée de la fiche moteur).
  return db
    .prepare(
      `SELECT p.name, p.version, p.created_at AS updated, p.created_by AS updatedBy
       FROM prompts p
       JOIN (SELECT name, MAX(version) AS v FROM prompts GROUP BY name) m
         ON m.name = p.name AND m.v = p.version
       ORDER BY p.name`
    )
    .all() as { name: string; version: number; updated: string; updatedBy: string | null }[]
}

export function listPromptVersions(name: string, db: Database.Database = getDb()): PromptRow[] {
  return db
    .prepare('SELECT * FROM prompts WHERE name = ? ORDER BY version DESC')
    .all(name) as PromptRow[]
}

export function getPromptVersion(
  name: string,
  version: number,
  db: Database.Database = getDb()
): PromptRow | undefined {
  return db.prepare('SELECT * FROM prompts WHERE name = ? AND version = ?').get(name, version) as
    | PromptRow
    | undefined
}

/** Enregistre une nouvelle version (immutable — on n'écrase jamais l'historique). */
export function savePromptVersion(
  name: string,
  content: string,
  createdBy: string,
  comment?: string,
  db: Database.Database = getDb()
): PromptRow {
  const current = db
    .prepare('SELECT MAX(version) AS v FROM prompts WHERE name = ?')
    .get(name) as { v: number | null }
  const version = (current.v ?? 0) + 1
  db.prepare(
    'INSERT INTO prompts (name, version, content, comment, created_by) VALUES (?, ?, ?, ?, ?)'
  ).run(name, version, content, comment ?? null, createdBy)
  return getActivePrompt(name, db)
}
