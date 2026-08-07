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
 * Marquage IA des images (brief Mathias 21/07/2026) : chaque image produite par
 * PortaGEN reçoit la métadonnée IPTC DigitalSourceType = trainedAlgorithmicMedia
 * (cf. src/lib/images/marquage.ts). Réglage GLOBAL — jamais par moteur.
 * ACTIVÉ par défaut : seul un « 0 » explicite le coupe.
 */
export const MARQUAGE_IA_KEY = 'iptc_tagging_enabled'

export function isMarquageIaActif(db: Database.Database = getDb()): boolean {
  return getSetting(MARQUAGE_IA_KEY, db) !== '0'
}

/**
 * Modèle de génération d'images (demande Mathias 28/07/2026) : bascule dans
 * Admin → Réglages généraux entre Nano Banana Pro (gemini-3-pro-image, défaut)
 * et Nano Banana (gemini-3.1-flash-image — « Nano Banana 2 », le modèle rapide
 * et beaucoup moins cher de la même famille). Réglage GLOBAL, effet immédiat
 * sur les prochaines générations.
 */
export const IMAGE_MODEL_KEY = 'gemini_image_model'
export const IMAGE_MODELS = [
  { id: 'gemini-3-pro-image', label: 'Nano Banana Pro' },
  { id: 'gemini-3.1-flash-image', label: 'Nano Banana' },
] as const

export function getImageModel(db: Database.Database = getDb()): string {
  const raw = getSetting(IMAGE_MODEL_KEY, db)
  if (raw && IMAGE_MODELS.some((m) => m.id === raw)) return raw
  // Défaut historique : Nano Banana Pro (surchargable par GEMINI_IMAGE_MODEL en .env).
  return process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3-pro-image'
}

/**
 * Modèle VISION des descriptions produit (07/08/2026, demande Mathias : tout
 * réglage sous UI). Défaut : l'alias pro stable vérifié via ListModels le
 * 07/08 — tout nom saisi dans l'admin doit être vérifié de la même façon.
 */
export const VISION_MODEL_KEY = 'gemini_vision_model'
export const VISION_MODEL_DEFAULT = 'gemini-pro-latest'

export function getVisionModel(db: Database.Database = getDb()): string {
  const raw = getSetting(VISION_MODEL_KEY, db)
  return raw && raw.trim() ? raw.trim() : VISION_MODEL_DEFAULT
}

/**
 * Gabarit du PROMPT vision des descriptions produit (07/08/2026) : null =
 * gabarit d'usine (src/lib/genai/descriptionProduit.ts). Éditable dans
 * Admin → Réglages → Générations & modèle.
 */
export const VISION_TEMPLATE_KEY = 'vision_description_template'

export function getVisionTemplate(db: Database.Database = getDb()): string | null {
  const raw = getSetting(VISION_TEMPLATE_KEY, db)
  return raw && raw.trim() ? raw : null
}

/**
 * Sas de calcul d'image (07/08/2026) : nombre de phases sharp (RALify, plan
 * gris, livraison) autorisées de front dans le processus web — au-delà, les
 * jobs patientent. Réglable depuis Admin → Réglages (défaut 3, borné 1-8).
 */
export const SAS_IMAGES_KEY = 'sas_images_limite'
export const SAS_IMAGES_DEFAULT = 3
export const SAS_IMAGES_MIN = 1
export const SAS_IMAGES_MAX = 8

export function getSasImagesLimite(db: Database.Database = getDb()): number {
  const raw = Number(getSetting(SAS_IMAGES_KEY, db))
  if (!Number.isFinite(raw) || raw < SAS_IMAGES_MIN) return SAS_IMAGES_DEFAULT
  return Math.min(SAS_IMAGES_MAX, Math.round(raw))
}

/**
 * Chaînes de PRÉPARATION côté page MES Contrainte (07/08/2026) : nombre
 * d'images préparées de front par le navigateur (détourage → RALify →
 * description → pose). Défaut 3 (choix Mathias 07/08), borné 1-6.
 */
export const PREP_CONCURRENCE_KEY = 'prep_concurrence'
export const PREP_CONCURRENCE_DEFAUT = 3
export const PREP_CONCURRENCE_MIN = 1
export const PREP_CONCURRENCE_MAX = 6

export function getPrepConcurrence(db: Database.Database = getDb()): number {
  const raw = Number(getSetting(PREP_CONCURRENCE_KEY, db))
  if (!Number.isFinite(raw) || raw < PREP_CONCURRENCE_MIN) return PREP_CONCURRENCE_DEFAUT
  return Math.min(PREP_CONCURRENCE_MAX, Math.round(raw))
}

