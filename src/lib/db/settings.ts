import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'

/**
 * Réglages d'application, en base et pilotés depuis l'écran Admin → Réglages
 * (règle du projet : aucun réglage accessible uniquement par fichier/CLI/env).
 */

export function getSetting(key: string, db: Database.Database = getDb()): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string, db: Database.Database = getDb()): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, value)
}

/** Générations simultanées par utilisateur (défaut 10, borné 1–20). */
export const CONCURRENCY_KEY = 'runner_concurrency_per_user'
export const CONCURRENCY_DEFAULT = 10
export const CONCURRENCY_MIN = 1
export const CONCURRENCY_MAX = 20

export function getConcurrencyPerUser(db: Database.Database = getDb()): number {
  const raw = Number(getSetting(CONCURRENCY_KEY, db))
  if (!Number.isFinite(raw) || raw < CONCURRENCY_MIN) return CONCURRENCY_DEFAULT
  return Math.min(CONCURRENCY_MAX, Math.round(raw))
}

/**
 * Racine du serveur de fichiers de l'entreprise (catalogue vivant, cadrage du
 * 12/07/2026). RÈGLE ABSOLUE : l'app n'y accède qu'en LECTURE — aucune écriture
 * tant que Mathias n'a pas donné le feu vert.
 */
export const SERVER_ROOT_KEY = 'server_root_path'
// Chemin interne : jamais en dur dans le code — vient de .env.local (SERVER_ROOT).
export const SERVER_ROOT_DEFAULT = process.env.SERVER_ROOT ?? ''

export function getServerRoot(db: Database.Database = getDb()): string {
  const raw = getSetting(SERVER_ROOT_KEY, db)
  return raw && raw.trim() ? raw.trim() : SERVER_ROOT_DEFAULT
}

/**
 * Tarif Gemini indicatif, en € par MILLION de tokens (entrée / sortie), saisi dans
 * Admin → Réglages moteur. 0 = non configuré → aucun coût en € affiché (les tokens
 * restent toujours visibles). Sert au coût par essai du Lab moteur.
 */
export const PRICE_IN_KEY = 'gemini_price_eur_per_mtok_in'
export const PRICE_OUT_KEY = 'gemini_price_eur_per_mtok_out'

export interface Pricing {
  inEurPerMTok: number
  outEurPerMTok: number
}

export function getPricing(db: Database.Database = getDb()): Pricing {
  const inRaw = Number(getSetting(PRICE_IN_KEY, db))
  const outRaw = Number(getSetting(PRICE_OUT_KEY, db))
  return {
    inEurPerMTok: Number.isFinite(inRaw) && inRaw > 0 ? inRaw : 0,
    outEurPerMTok: Number.isFinite(outRaw) && outRaw > 0 ? outRaw : 0,
  }
}
