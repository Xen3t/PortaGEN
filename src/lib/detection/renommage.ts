import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'
import {
  getCatalogProduct,
  listCatalogProducts,
  type CatalogProductRow,
  type GammeSummary,
} from '@/lib/catalogue/scan'
import { parseSizeDir } from '@/lib/catalogue/parse'
import { parseSizeFromProductName } from '@/lib/productName'
import {
  buildFileName,
  destFromDims,
  REF_PLACEHOLDER,
  sizeToken,
  VUE_AUTRE,
  VUE_MOODBOARD,
} from '@/lib/detection/nomenclature'

/**
 * Aide au renommage nomenclature HOORTRADE (24/07/2026) : propose pour chaque
 * image un nom conforme GAMME-TAILLE_VUE_DESTINATION_REF, construit depuis la
 * vue APPRISE/DÉTECTÉE, la taille lue dans le chemin, la destination déduite
 * des dimensions et la réf KIT du dossier coloris quand elle est connue.
 *
 * RÈGLE ABSOLUE : le serveur O:\ n'est JAMAIS modifié. L'export écrit des
 * COPIES renommées dans data/exports/ + un tableau récapitulatif CSV. Rien
 * n'est inventé : réf ou destination inconnues restent marquées « à compléter ».
 */

/** Seuil de confiance pour utiliser une PRÉDICTION (sans exemple) au renommage. */
const RENAME_MIN_CONF = 0.55

export interface RenameProposal {
  imageId: number
  productId: number
  productName: string
  family: string
  relPath: string
  /** Vue retenue (exemple appris en priorité, sinon prédiction confiante). */
  keyword: string
  /** D'où vient la vue : « appris » (exemple) ou « détecté » (prédiction). */
  vueOrigine: 'appris' | 'detecte'
  proposed: string
  /** Ce qui manque pour un nom complet (réf, destination, taille). */
  manque: string[]
  dejaConforme: boolean
}

interface ImageRow {
  id: number
  product_id: number
  rel_path: string
  width: number | null
  height: number | null
  pred_vue: string | null
  pred_vue_conf: number | null
  ex_label: string | null
}

/** Taille (cm) d'une image : segments du chemin, du plus proche au plus lointain. */
function sizeFromRelPath(relPath: string): { w: number; h: number } | null {
  const parts = relPath.split(/[\\/]+/)
  for (let i = parts.length - 1; i >= 0; i--) {
    const bySizeDir = parseSizeDir(parts[i])
    if (bySizeDir) return { w: bySizeDir.w, h: bySizeDir.h }
    const byName = parseSizeFromProductName(parts[i])
    if (byName) return { w: byName.w, h: byName.h }
  }
  return null
}

/** Réfs KIT connues d'une gamme : dossier de carte coloris → réf. */
function kitRefsByDir(product: CatalogProductRow): Array<{ dir: string; ref: string }> {
  let summary: GammeSummary
  try {
    summary = JSON.parse(product.summary) as GammeSummary
  } catch {
    return []
  }
  const out: Array<{ dir: string; ref: string }> = []
  for (const size of summary.sizes) {
    for (const card of size.coloris) {
      if (!card.kitRef) continue
      const face = card.faceJpg ?? card.facePng
      if (!face) continue
      out.push({ dir: path.dirname(face), ref: card.kitRef })
    }
  }
  return out
}

function kitRefFor(relPath: string, refs: Array<{ dir: string; ref: string }>): string | null {
  const dir = path.dirname(relPath)
  let best: { dir: string; ref: string } | null = null
  for (const r of refs) {
    if (dir === r.dir || dir.startsWith(r.dir + path.sep)) {
      if (!best || r.dir.length > best.dir.length) best = r
    }
  }
  return best?.ref ?? null
}

const NUMBERED = new Set(['MES', 'ZOOM', 'IT', 'CONTENT'])

/**
 * Propositions de renommage d'un produit (ou de tous). La numérotation des
 * bases numérotées (MES-01…) suit l'ordre des chemins — choix éditorial à
 * ajuster à la main si besoin (MES-01 = image principale du site).
 */
export function listRenameProposals(
  db: Database.Database = getDb(),
  opts: { productId?: number; limit?: number } = {}
): RenameProposal[] {
  const products = opts.productId
    ? ([getCatalogProduct(opts.productId, db)].filter(Boolean) as CatalogProductRow[])
    : listCatalogProducts(db)
  const limit = opts.limit ?? 500
  const proposals: RenameProposal[] = []

  const stmt = db.prepare(
    `SELECT i.id, i.product_id, i.rel_path, i.width, i.height, i.pred_vue, i.pred_vue_conf,
       (SELECT e.label FROM detection_examples e
        WHERE e.product_id = i.product_id AND e.rel_path = i.rel_path AND e.axis = 'vue') AS ex_label
     FROM detection_images i WHERE i.product_id = ? ORDER BY i.rel_path`
  )

  for (const product of products) {
    if (proposals.length >= limit) break
    const refs = kitRefsByDir(product)
    const rows = stmt.all(product.id) as ImageRow[]
    const counters = new Map<string, number>()
    for (const row of rows) {
      if (proposals.length >= limit) break
      const keyword =
        row.ex_label ??
        (row.pred_vue && (row.pred_vue_conf ?? 0) >= RENAME_MIN_CONF ? row.pred_vue : null)
      if (!keyword || keyword === VUE_AUTRE || keyword === VUE_MOODBOARD) continue

      const size = sizeFromRelPath(row.rel_path)
      const dest = row.width && row.height ? destFromDims(row.width, row.height) : null
      const ref = kitRefFor(row.rel_path, refs)
      const base = keyword.split('-')[0]
      let num: number | null = null
      if (NUMBERED.has(base)) {
        const key = `${base}|${dest ?? '?'}`
        num = (counters.get(key) ?? 0) + 1
        counters.set(key, num)
      }
      const ext = path.extname(row.rel_path).toLowerCase().replace('.', '').replace('jpg', 'jpeg')
      const manque: string[] = []
      if (!size) manque.push('taille')
      if (!dest) manque.push('destination')
      if (!ref) manque.push('réf KIT')
      const proposed = buildFileName({
        gamme: product.name,
        sizeToken: size ? sizeToken(size.w, size.h, product.family) : '??',
        keyword,
        num,
        dest: dest ?? 'DEST-?',
        ref,
        ext: ext || 'jpeg',
      })
      proposals.push({
        imageId: row.id,
        productId: product.id,
        productName: product.name,
        family: product.family,
        relPath: row.rel_path,
        keyword,
        vueOrigine: row.ex_label ? 'appris' : 'detecte',
        proposed,
        manque,
        dejaConforme: path.basename(row.rel_path) === proposed,
      })
    }
  }
  return proposals
}

export interface RenameExportResult {
  dir: string
  copied: number
  incomplete: number
  csvPath: string
}

/**
 * Export des copies renommées : data/exports/renommage-<horodatage>/GAMME/…
 * + recap.csv (original ; proposition ; manques). Copies UNIQUEMENT — le
 * serveur n'est jamais touché.
 */
export function exportRenames(
  db: Database.Database = getDb(),
  opts: { productId?: number } = {}
): RenameExportResult {
  const proposals = listRenameProposals(db, { ...opts, limit: 5000 })
  const stampDate = new Date()
  const stamp = stampDate
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15)
  const dir = path.join(config.dataDir, 'exports', `renommage-${stamp}`)
  fs.mkdirSync(dir, { recursive: true })

  const lines = ['gamme;fichier d’origine;proposition;statut']
  let copied = 0
  let incomplete = 0
  for (const p of proposals) {
    const product = getCatalogProduct(p.productId, db)
    if (!product) continue
    const src = path.join(product.server_path, p.relPath)
    const destDir = path.join(dir, p.productName.replace(/[^\w\- ]/g, '_'))
    let statut = 'copié'
    if (p.manque.length > 0) {
      incomplete++
      statut = `à compléter (${p.manque.join(', ')})`
    }
    try {
      fs.mkdirSync(destDir, { recursive: true })
      let target = path.join(destDir, p.proposed)
      // Collision improbable (numérotation par produit) : suffixe défensif.
      for (let i = 2; fs.existsSync(target) && i < 100; i++) {
        target = path.join(destDir, p.proposed.replace(/(\.[a-z]+)$/i, `-${i}$1`))
      }
      fs.copyFileSync(src, target)
      copied++
    } catch {
      statut = 'copie impossible (fichier illisible)'
    }
    lines.push(`${p.productName};${p.relPath};${p.proposed};${statut}`)
  }
  const csvPath = path.join(dir, 'recap.csv')
  // BOM : Excel ouvre le CSV en UTF-8 sans réglage.
  fs.writeFileSync(csvPath, '﻿' + lines.join('\r\n'), 'utf8')
  return { dir, copied, incomplete, csvPath }
}

export { REF_PLACEHOLDER }
