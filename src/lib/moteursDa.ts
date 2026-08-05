import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'
import { getSetting, setSetting } from '@/lib/db/settings'
import {
  MOTEUR_REGLAGES_DEFAUTS,
  sanitizeMoteurReglages,
  type MoteurReglages,
} from '@/lib/moteurs'

/**
 * Registre des MOTEURS « DÉCOR AUTOUR » (bascule du 05/08/2026,
 * docs/CADRAGE-DECOR-AUTOUR-2026-08-05.md) — SÉPARATION TOTALE demandée par
 * Mathias : les moteurs de la méthode legacy (src/lib/moteurs.ts — clés
 * battant/coulissant/portillon, désormais affichés « (legacy) ») gardent leurs
 * clés, réglages, prompts et pipelines INTACTS ; la nouvelle méthode a SES
 * moteurs, avec leurs propres clés, réglages (app_settings `moteur.<clé>.reglages`)
 * et prompts (`<clé>-decor-autour`).
 *
 * Clés = noms de code des dieux (janus/terminus/forculus) : courtes, stables,
 * et sans collision possible avec les clés legacy.
 */

export type MoteurDaKey = 'janus' | 'terminus' | 'forculus'

export interface MoteurDaDef {
  key: MoteurDaKey
  /** Type de produit (même vocabulaire que le legacy : Battant/Coulissant/Portillon). */
  label: string
  /** Nom de code — SANS « (legacy) » : c'est la génération actuelle. */
  codeName: string
  status: 'actif'
  famille: string
  /** Mot du produit pour les libellés d'écran. */
  produit: string
  /** Lettre de la nomenclature produit (300B140 → B). */
  lettre: 'B' | 'C' | 'P'
}

export const MOTEURS_DA: MoteurDaDef[] = [
  { key: 'janus', label: 'Battant', codeName: 'JANUS', status: 'actif', famille: 'Portails', produit: 'portail', lettre: 'B' },
  { key: 'terminus', label: 'Coulissant', codeName: 'TERMINUS', status: 'actif', famille: 'Portails', produit: 'portail', lettre: 'C' },
  { key: 'forculus', label: 'Portillon', codeName: 'FORCULUS', status: 'actif', famille: 'Portails', produit: 'portillon', lettre: 'P' },
]

export function isMoteurDaKey(key: string): key is MoteurDaKey {
  return MOTEURS_DA.some((m) => m.key === key)
}

export function moteurDaDef(key: string): MoteurDaDef | undefined {
  return MOTEURS_DA.find((m) => m.key === key)
}

/** Lettre de nomenclature → moteur décor autour (détection au dépôt d'images). */
export function moteurDaForLettre(lettre: string): MoteurDaKey {
  return lettre === 'C' ? 'terminus' : lettre === 'P' ? 'forculus' : 'janus'
}

/**
 * Réglages d'un moteur décor autour — MÊME forme que les réglages legacy
 * (MoteurReglages : RALify, marketplace, générations par taille, livraison…),
 * mais persistés sous LEURS clés (`moteur.janus.reglages`) : rien de partagé.
 * Défaut integrationMethod = 'decor-autour' (la méthode du moteur, immuable).
 */
export const MOTEUR_DA_REGLAGES_DEFAUTS: MoteurReglages = {
  ...MOTEUR_REGLAGES_DEFAUTS,
  integrationMethod: 'decor-autour',
}

const reglagesKey = (key: MoteurDaKey) => `moteur.${key}.reglages`

export function getMoteurDaReglages(
  key: MoteurDaKey,
  db: Database.Database = getDb()
): MoteurReglages {
  const raw = getSetting(reglagesKey(key), db)
  if (!raw) return { ...MOTEUR_DA_REGLAGES_DEFAUTS }
  try {
    const parsed = JSON.parse(raw) as Partial<MoteurReglages>
    return { ...MOTEUR_DA_REGLAGES_DEFAUTS, ...sanitizeMoteurReglages(parsed) }
  } catch {
    return { ...MOTEUR_DA_REGLAGES_DEFAUTS }
  }
}

/** Fusionne les champs fournis dans les réglages existants, puis persiste. */
export function patchMoteurDaReglages(
  key: MoteurDaKey,
  patch: Partial<MoteurReglages>,
  db: Database.Database = getDb()
): MoteurReglages {
  const next = { ...getMoteurDaReglages(key, db), ...sanitizeMoteurReglages(patch) }
  setSetting(reglagesKey(key), JSON.stringify(next), db)
  return next
}

/**
 * Nom du prompt système d'un moteur décor autour : TOUJOURS préfixé par la clé
 * (`janus-decor-autour`) — pas d'exception « battant garde les noms nus », c'est
 * une nouvelle génération de moteurs.
 */
export function moteurDaPromptName(key: MoteurDaKey, base: string): string {
  return `${key}-${base}`
}
