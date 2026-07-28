import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'
import { getCatalogProduct, resolveCatalogFile } from '@/lib/catalogue/scan'
import { colorisDefAll } from '@/lib/catalogue/colorisStore'
import { detectColoris } from '@/lib/images/coloris'
import {
  canonicalKeyword,
  parseVisualBlock,
  VUE_AUTRE,
  VUE_MOODBOARD,
} from '@/lib/detection/nomenclature'
import { getImage, saveExample } from '@/lib/detection/store'

/**
 * Classement « atelier » d'une image — logique PARTAGÉE entre le mode un par un
 * et le mode par lots (27/07/2026) : mot-clé canonisé, famille + gamme attestées
 * par les vues produit, coloris mesuré sur l'image quand il est donné.
 */

/** Bases « vue produit » : attestent aussi famille + gamme, et portent un coloris. */
export const PRODUCT_BASES: ReadonlySet<string> = new Set([
  'FRONT',
  'BACK',
  'LEFT',
  'RIGHT',
  'ABOVE',
  'BELOW',
])

export type ClassementResult =
  | { ok: true; vue: string; coloris: string | null }
  | { ok: false; error: string; status: number }

export async function applyAtelierClassement(
  input: { imageId: number; vue: string; coloris?: string | null },
  db: Database.Database = getDb()
): Promise<ClassementResult> {
  const vueRaw = input.vue.trim().toUpperCase()
  if (!vueRaw) return { ok: false, error: 'Classement incomplet', status: 400 }

  const image = getImage(input.imageId, db)
  if (!image) return { ok: false, error: 'Image inconnue', status: 404 }
  const product = getCatalogProduct(image.product_id, db)
  if (!product) return { ok: false, error: 'Produit introuvable', status: 404 }

  // Mot-clé : listing officiel (canonisé) ou étiquettes internes.
  let vue: string
  if (vueRaw === VUE_AUTRE || vueRaw === VUE_MOODBOARD) {
    vue = vueRaw
  } else {
    const ident = parseVisualBlock(vueRaw)
    if (!ident) return { ok: false, error: `Vue inconnue : ${vueRaw}`, status: 400 }
    vue = canonicalKeyword(ident)
  }

  saveExample(
    {
      productId: product.id,
      relPath: image.rel_path,
      axis: 'vue',
      label: vue,
      source: 'atelier',
      gamme: product.name,
    },
    db
  )

  const base = vue.split('-')[0]
  if (PRODUCT_BASES.has(base)) {
    // Une vue produit confirmée à la main atteste famille + gamme du dossier.
    saveExample(
      { productId: product.id, relPath: image.rel_path, axis: 'famille', label: product.family, source: 'atelier', gamme: product.name },
      db
    )
    saveExample(
      { productId: product.id, relPath: image.rel_path, axis: 'gamme', label: product.name, source: 'atelier', gamme: product.name },
      db
    )
  }

  let colorisLabel: string | null = null
  const colorisRaw = input.coloris?.trim()
  if (colorisRaw && PRODUCT_BASES.has(base)) {
    const def = colorisDefAll(colorisRaw, db)
    if (!def) return { ok: false, error: `Coloris inconnu : ${colorisRaw}`, status: 400 }
    const abs = resolveCatalogFile(product, image.rel_path)
    if (abs) {
      try {
        const det = await detectColoris(abs)
        saveExample(
          {
            productId: product.id,
            relPath: image.rel_path,
            axis: 'coloris',
            label: def.label,
            source: 'atelier',
            features: { L: det.L, tint: det.tint, matFrac: det.matFrac },
            gamme: product.name,
          },
          db
        )
        colorisLabel = def.label
      } catch {
        // Visuel illisible : la vue est apprise, le coloris passe.
      }
    }
  }

  return { ok: true, vue, coloris: colorisLabel }
}
