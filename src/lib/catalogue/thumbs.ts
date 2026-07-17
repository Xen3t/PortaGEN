import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { config } from '@/lib/config'
import {
  resolveCatalogFile,
  type CatalogProductRow,
  type GammeSummary,
} from '@/lib/catalogue/scan'

/**
 * Miniatures du catalogue : les visuels du serveur pèsent plusieurs Mo alors
 * que l'interface affiche des vignettes de 80 px — chaque image est réduite
 * UNE fois puis servie depuis le cache local (data/cache/catalogue-thumbs).
 * Lecture seule côté serveur d'entreprise : le cache vit uniquement en local.
 * La clé intègre mtime + taille : un fichier modifié sur le serveur régénère
 * sa miniature tout seul.
 */

const CACHE_DIR = path.join(config.dataDir, 'cache', 'catalogue-thumbs')

export const THUMB_MIN_WIDTH = 32
export const THUMB_MAX_WIDTH = 1024

/** Générations en cours : une page qui affiche 2× la même image ne la fabrique qu'une fois. */
const inFlight = new Map<string, Promise<string>>()

export async function getCatalogThumb(absSource: string, width: number): Promise<string> {
  const w = Math.min(THUMB_MAX_WIDTH, Math.max(THUMB_MIN_WIDTH, Math.round(width)))
  const st = fs.statSync(absSource)
  const hash = crypto
    .createHash('sha1')
    .update(`${absSource}|${st.mtimeMs}|${st.size}|${w}`)
    .digest('hex')
  const out = path.join(CACHE_DIR, `${hash}.webp`)
  if (fs.existsSync(out)) return out

  const pending = inFlight.get(out)
  if (pending) return pending

  const job = (async () => {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    const tmp = `${out}.${process.pid}.${Math.floor(Math.random() * 1e9)}.tmp`
    await sharp(absSource)
      .rotate() // respecte l'orientation EXIF des photos
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(tmp)
    try {
      fs.renameSync(tmp, out)
    } catch {
      // Une requête concurrente a déjà posé la miniature : la nôtre est superflue.
      fs.rmSync(tmp, { force: true })
      if (!fs.existsSync(out)) throw new Error(`Miniature non écrite : ${out}`)
    }
    return out
  })()
  inFlight.set(out, job)
  try {
    return await job
  } finally {
    inFlight.delete(out)
  }
}

/** Largeurs servies par l'interface (tableau des visuels / galeries MES). */
export const THUMB_FACE_WIDTH = 160
export const THUMB_MES_WIDTH = 240

export interface WarmReport {
  done: number
  failed: number
  durationMs: number
}

/** Produits dont les miniatures sont en cours de génération (dédoublonnage). */
const warmingProducts = new Set<number>()

/**
 * Miniatures À LA CONSULTATION (décision Mathias 12/07/2026, exit le
 * préchauffage global) : quand une page produit est ouverte, SES miniatures
 * se génèrent en tâche de fond — le navigateur qui les demande dans la
 * foulée rejoint les générations en cours (Map in-flight de getCatalogThumb).
 * Ne refait jamais une miniature en cache. Concurrence 3 (ménage le NAS).
 */
export async function warmProductThumbs(product: CatalogProductRow): Promise<WarmReport> {
  const started = Date.now()
  if (warmingProducts.has(product.id)) return { done: 0, failed: 0, durationMs: 0 }
  warmingProducts.add(product.id)
  try {
    const summary = JSON.parse(product.summary) as GammeSummary
    const targets: { abs: string; width: number }[] = []
    for (const size of summary.sizes) {
      for (const c of size.coloris) {
        if (c.faceJpg) {
          const abs = resolveCatalogFile(product, c.faceJpg)
          if (abs) targets.push({ abs, width: THUMB_FACE_WIDTH })
        }
      }
    }
    for (const m of summary.mes) {
      const abs = resolveCatalogFile(product, m.file)
      if (abs) targets.push({ abs, width: THUMB_MES_WIDTH })
    }
    let done = 0
    let failed = 0
    let cursor = 0
    const worker = async () => {
      while (cursor < targets.length) {
        const t = targets[cursor++]
        try {
          await getCatalogThumb(t.abs, t.width)
          done += 1
        } catch {
          failed += 1
        }
      }
    }
    await Promise.all([worker(), worker(), worker()])
    return { done, failed, durationMs: Date.now() - started }
  } finally {
    warmingProducts.delete(product.id)
  }
}
