import path from 'node:path'
import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'
import { classifyView, isUsableFace, type ViewKind } from './parse'
import { listDetourages, type DetourageStatus } from './detourageStore'
import type { CatalogProductRow } from './scan'

/**
 * File de détourage d'une page produit (chantier 2) : les références qui n'ont
 * PAS encore de découpe utilisable (PNG serveur de face, ou détourage local
 * validé). Chaque item porte le type de vue de la source (face / angle / dos /
 * aucune) et l'état du détourage local.
 */

export interface DetourageQueueItem {
  coloris: string
  size: string // '300x140'
  w: number
  h: number
  ref: string // 'VOGEL 300B140'
  /** type de vue de la source à détourer ; null si aucune photo. */
  sourceKind: ViewKind | null
  /** chemin relatif (gamme) de la source à détourer. */
  sourceRel: string | null
  /** état du détourage local, ou 'none'. */
  status: DetourageStatus | 'none'
  /** chemin relatif projet du PNG local (à servir via /api/artifacts). */
  pngPath: string | null
}

interface ColorisNode {
  coloris: string
  faceJpg: string | null
  facePng: string | null
}
interface SizeNode {
  w: number
  h: number
  coloris: ColorisNode[]
}

function familyLetter(family: string): string {
  const f = family.toUpperCase()
  if (f.includes('BATTANT')) return 'B'
  if (f.includes('COULISSANT')) return 'C'
  if (f.includes('PORTILLON')) return 'P'
  return 'x'
}

/** Un PNG serveur n'est « utilisable » que s'il est bien une face (pas un dos/angle). */
export function serverPngUsable(facePng: string | null): boolean {
  return !!facePng && isUsableFace(classifyView(path.basename(facePng)))
}

export function buildDetourageQueue(
  product: CatalogProductRow,
  db: Database.Database = getDb()
): DetourageQueueItem[] {
  const summary = JSON.parse(product.summary) as { sizes: SizeNode[] }
  const letter = familyLetter(product.family)
  const rows = listDetourages(product.id, db)
  const byKey = new Map(rows.map((r) => [`${r.coloris}|${r.size_label}`, r]))

  const items: DetourageQueueItem[] = []
  for (const size of summary.sizes) {
    const sizeLabel = `${size.w}x${size.h}`
    for (const c of size.coloris) {
      const row = byKey.get(`${c.coloris}|${sizeLabel}`)
      // Déjà générable via un vrai PNG serveur et jamais retouché → hors file.
      if (serverPngUsable(c.facePng) && !row) continue
      items.push({
        coloris: c.coloris,
        size: sizeLabel,
        w: size.w,
        h: size.h,
        ref: `${product.name} ${size.w}${letter}${size.h}`,
        sourceKind: c.faceJpg ? classifyView(path.basename(c.faceJpg)) : null,
        sourceRel: c.faceJpg ?? null,
        status: row ? row.status : 'none',
        pngPath: row ? row.png_path : null,
      })
    }
  }
  return items
}
