import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'
import { getSetting, setSetting } from '@/lib/db/settings'
import { CANONICAL_COLORIS, type ColorisDef } from '@/lib/catalogue/colorisPalette'

/**
 * Coloris AJOUTÉS depuis l'admin (fiche moteur → Reconnaissance du coloris,
 * demande Mathias 13/07/2026), persistés en base (app_settings `coloris.custom`,
 * JSON) et fusionnés avec la palette d'origine (gris/blanc/noir/teck, dans le code).
 *
 * Version minimale assumée : un coloris ajouté est disponible PARTOUT où on
 * choisit un coloris à la main (correction sur la fiche produit, pastilles) ;
 * la DÉTECTION automatique par l'image, elle, continue de ne trancher qu'entre
 * les 4 coloris d'origine (heuristique mesurée sur 86 visuels — on ramifiera
 * sur retours).
 */

const KEY = 'coloris.custom'

export interface ColorisEntry extends ColorisDef {
  /** true = ajouté depuis l'admin (supprimable), false = palette d'origine. */
  custom: boolean
}

function isValidDef(v: unknown): v is ColorisDef {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return (
    typeof c.key === 'string' &&
    c.key.length > 0 &&
    typeof c.label === 'string' &&
    c.label.length > 0 &&
    (c.ral === null || typeof c.ral === 'string') &&
    typeof c.swatch === 'string' &&
    /^#[0-9a-f]{6}$/i.test(c.swatch)
  )
}

export function listCustomColoris(db: Database.Database = getDb()): ColorisDef[] {
  const raw = getSetting(KEY, db)
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(isValidDef) : []
  } catch {
    return []
  }
}

/** Palette complète : coloris d'origine puis coloris ajoutés. */
export function listAllColoris(db: Database.Database = getDb()): ColorisEntry[] {
  return [
    ...CANONICAL_COLORIS.map((c) => ({ ...c, custom: false })),
    ...listCustomColoris(db).map((c) => ({ ...c, custom: true })),
  ]
}

/** Retrouve un coloris (origine OU ajouté) par sa clé ou son libellé. */
export function colorisDefAll(
  keyOrLabel: string,
  db: Database.Database = getDb()
): ColorisEntry | undefined {
  const q = keyOrLabel.trim().toLowerCase()
  return listAllColoris(db).find((c) => c.key === q || c.label.toLowerCase() === q)
}

/** Clé stable d'un libellé : minuscules, sans accents ni ponctuation. */
function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function addColoris(
  input: { label: string; ral?: string | null; swatch: string },
  db: Database.Database = getDb()
): { ok: true; coloris: ColorisEntry } | { ok: false; error: string } {
  const label = input.label.trim()
  if (!label || label.length > 40) {
    return { ok: false, error: 'Nom de coloris requis (40 caractères maximum)' }
  }
  if (!/^#[0-9a-f]{6}$/i.test(input.swatch)) {
    return { ok: false, error: 'Couleur de pastille invalide' }
  }
  const ral = typeof input.ral === 'string' && input.ral.trim() ? input.ral.trim() : null
  if (ral && ral.length > 20) return { ok: false, error: 'Code RAL trop long' }
  const key = slugify(label)
  if (!key) return { ok: false, error: 'Nom de coloris invalide' }
  if (colorisDefAll(key, db) || colorisDefAll(label, db)) {
    return { ok: false, error: `Le coloris « ${label} » existe déjà` }
  }
  const def: ColorisDef = { key, label, ral, swatch: input.swatch.toLowerCase() }
  setSetting(KEY, JSON.stringify([...listCustomColoris(db), def]), db)
  return { ok: true, coloris: { ...def, custom: true } }
}

export function removeColoris(
  key: string,
  db: Database.Database = getDb()
): { ok: true } | { ok: false; error: string } {
  const q = key.trim().toLowerCase()
  if (CANONICAL_COLORIS.some((c) => c.key === q)) {
    return { ok: false, error: 'Les coloris d’origine ne se suppriment pas' }
  }
  const customs = listCustomColoris(db)
  const next = customs.filter((c) => c.key !== q)
  if (next.length === customs.length) return { ok: false, error: 'Coloris introuvable' }
  setSetting(KEY, JSON.stringify(next), db)
  return { ok: true }
}
