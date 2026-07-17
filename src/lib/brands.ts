import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'

/**
 * Les MARQUES comme profils de l'app (maquette navigation-v2 validée le
 * 12/07/2026) : choisies via le logo « PortaGEN CASANOOV ▾ », elles teintent
 * toute l'interface et filtrent Accueil/Catalogue/Production. Le choix est
 * mémorisé PAR UTILISATEUR en base — il le retrouve à la reconnexion,
 * même depuis un autre poste.
 */

export type BrandKey = 'casanoov' | 'cazeboo' | 'sicaan'

export interface BrandDef {
  key: BrandKey
  label: string
  what: string
  /** Couleurs officielles données par Mathias le 12/07/2026. */
  color: string
  /** true tant que la marque n'a pas de moteur : le catalogue affiche « bientôt ». */
  soon: boolean
}

export const BRANDS: readonly BrandDef[] = [
  { key: 'casanoov', label: 'CASANOOV', what: 'portails…', color: '#5d9228', soon: false },
  { key: 'cazeboo', label: 'CAZEBOO', what: 'pergolas…', color: '#38a0ad', soon: true },
  { key: 'sicaan', label: 'SICAAN', what: 'meubles…', color: '#dc9083', soon: true },
] as const

export const DEFAULT_BRAND: BrandKey = 'casanoov'

export function isBrandKey(value: unknown): value is BrandKey {
  return BRANDS.some((b) => b.key === value)
}

export function brandDef(key: BrandKey): BrandDef {
  return BRANDS.find((b) => b.key === key) ?? BRANDS[0]
}

export function getUserBrand(userId: number, db: Database.Database = getDb()): BrandKey {
  const row = db.prepare('SELECT brand FROM users WHERE id = ?').get(userId) as
    | { brand: string | null }
    | undefined
  return isBrandKey(row?.brand) ? row.brand : DEFAULT_BRAND
}

export function setUserBrand(
  userId: number,
  brand: BrandKey,
  db: Database.Database = getDb()
): void {
  db.prepare('UPDATE users SET brand = ? WHERE id = ?').run(brand, userId)
}
