import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'
import { getServerRoot } from '@/lib/db/settings'
import { parseSizeFromProductName } from '@/lib/productName'
import { detectColoris, colorisDef } from '@/lib/images/coloris'
import {
  canonicalMesFormat,
  classifyGammeDir,
  detectView,
  isIgnoredDir,
  isImage,
  isJpg,
  isPng,
  normalizeDirName,
  parseColorisDir,
  parseColorisFromDirName,
  parseMesColoris,
  parseMesFileFormat,
  parseRenduFormat,
  parseSizeDir,
  parseSkuRef,
} from '@/lib/catalogue/parse'

/** « 2048x2048 » (lu dans un nom) → format canonique via le ratio. */
function normalizeFormat(format: string): string {
  const m = format.match(/^(\d+)x(\d+)$/)
  if (!m) return format
  return canonicalMesFormat(Number(m[1]), Number(m[2]))
}

/**
 * Scan LECTURE SEULE du serveur de fichiers → pages produit (catalogue vivant,
 * cadrage 12/07/2026). RÈGLE ABSOLUE (Mathias) : aucune écriture sur le serveur,
 * on consulte c'est tout — ce module n'utilise QUE readdir/stat.
 * Périmètre v1 : marque CASANOOV, familles portails (le moteur MES Contraintes
 * existant les couvre). Les autres marques/familles viendront avec leurs moteurs.
 */

export const SCAN_BRANDS: ReadonlyArray<{ brand: string; families: string[] }> = [
  { brand: 'CASANOOV', families: ['PORTAIL BATTANT', 'PORTAIL COULISSANT', 'PORTILLON'] },
]

export interface ColorisSummary {
  coloris: string
  kitRef: string | null
  colorCode: string | null
  jpgCount: number
  pngCount: number
  /** Chemin relatif (à la gamme) du JPG face fermée retenu, s'il existe. */
  faceJpg: string | null
  /** Chemin relatif du PNG détouré correspondant le plus plausible. */
  facePng: string | null
  /**
   * Coloris DEVINÉ à partir du visuel produit (idée Mathias 12/07/2026) quand il
   * n'est pas nommé dans les dossiers (`coloris === 'non précisé'`). Sert de
   * proposition par défaut ; l'utilisateur peut corriger d'un clic sur la fiche.
   */
  detectedColoris: string | null
}

export interface SizeSummary {
  label: string
  w: number
  h: number
  coloris: ColorisSummary[]
}

export interface MesFile {
  format: string
  file: string
  /** Taille lue dans le nom du fichier ou d'un dossier parent (« 300x140 »), sinon null. */
  size: string | null
  /** Coloris déduit du nom de fichier parmi ceux de la gamme, sinon null. */
  coloris: string | null
}

export interface GammeSummary {
  sizes: SizeSummary[]
  moodboards: string[]
  mes: MesFile[]
  /** Dossiers non reconnus / anomalies — affichés sur la fiche « à compléter ». */
  warnings: string[]
}

export interface CatalogProductRow {
  id: number
  brand: string
  family: string
  name: string
  server_path: string
  status: 'detecte' | 'a_completer'
  summary: string
  /** JSON : références (`coloris|300x140`) apparues au dernier scan (étiquette NOUVEAU). */
  new_refs: string
  last_scan_at: string
  created_at: string
}

/**
 * Clés de référence d'un résumé (`coloris|largeurxhauteur`) — base de l'étiquette
 * NOUVEAU (bloc 3.4) : on compare l'ensemble d'un scan à celui du scan précédent.
 * On garde le coloris TEL QUE SCANNÉ (clé stable), pas l'affichage corrigé.
 */
export function summaryRefKeys(summary: GammeSummary): string[] {
  const keys: string[] = []
  for (const s of summary.sizes) {
    for (const c of s.coloris) keys.push(`${c.coloris}|${s.w}x${s.h}`)
  }
  return keys
}

/** Références présentes dans `next` mais absentes de `prev` (null prev = 1er scan → aucune). */
function diffNewRefs(prev: string[] | null, next: string[]): string[] {
  if (!prev) return []
  const old = new Set(prev)
  return next.filter((r) => !old.has(r))
}

/** readdir tolérant : un dossier illisible devient un avertissement, jamais une erreur. */
function safeReadDir(dir: string, warnings: string[]): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    warnings.push(`Dossier illisible : ${dir}`)
    return []
  }
}

/**
 * Collecte PROFONDE des images d'un dossier (profondeur bornée) : les visuels
 * produit vivent tantôt à plat, tantôt dans `Png`, tantôt dans `RENDU\WEB` /
 * `RENDU\MP` / `RENDU\PNG` (constaté sur VALIER). LINK / PROJECT / _OLD exclus.
 */
function collectColorisFiles(
  dir: string,
  relBase: string,
  warnings: string[],
  depth = 0
): { jpgs: string[]; pngs: string[] } {
  const jpgs: string[] = []
  const pngs: string[] = []
  for (const entry of safeReadDir(dir, warnings)) {
    if (entry.isDirectory()) {
      if (depth >= 3 || isIgnoredDir(entry.name) || normalizeDirName(entry.name) === 'LINK') continue
      const sub = collectColorisFiles(
        path.join(dir, entry.name),
        path.join(relBase, entry.name),
        warnings,
        depth + 1
      )
      jpgs.push(...sub.jpgs)
      pngs.push(...sub.pngs)
      continue
    }
    if (!entry.isFile() || !isImage(entry.name)) continue
    const rel = path.join(relBase, entry.name)
    if (isJpg(entry.name)) jpgs.push(rel)
    else if (isPng(entry.name)) pngs.push(rel)
  }
  return { jpgs, pngs }
}

/** Scan d'un dossier gamme (ex. VOGEL) : tailles → coloris → fichiers, MES, moodboards. */
export function scanGamme(gammeDir: string): GammeSummary {
  const warnings: string[] = []
  const summary: GammeSummary = { sizes: [], moodboards: [], mes: [], warnings }

  for (const entry of safeReadDir(gammeDir, warnings)) {
    if (!entry.isDirectory()) continue
    if (isIgnoredDir(entry.name)) continue
    const kind = classifyGammeDir(entry.name)
    const dirPath = path.join(gammeDir, entry.name)

    if (kind === 'image-produit') {
      scanImageProduit(dirPath, entry.name, summary)
    } else if (kind === 'mes-ia') {
      const before = summary.mes.length
      scanMesIa(dirPath, entry.name, summary)
      if (summary.mes.length === before) {
        summary.warnings.push(
          `Dossier MES présent (${entry.name}) mais aucune image reconnue dedans`
        )
      }
    } else if (kind === 'moodboard') {
      for (const f of safeReadDir(dirPath, warnings)) {
        if (f.isFile() && /\.(pdf|jpe?g|png)$/i.test(f.name)) {
          summary.moodboards.push(path.join(entry.name, f.name))
        }
      }
    }
    // image-fournisseur : ignoré en v1 (le détourage — chantier 2 — s'appuiera dessus).
  }

  if (summary.sizes.length === 0) {
    warnings.push('Aucune taille reconnue dans IMAGE PRODUIT')
  }

  // Attribution des MES aux coloris de la gamme (lecture du nom de fichier).
  const knownColoris = Array.from(
    new Set(summary.sizes.flatMap((s) => s.coloris.map((c) => c.coloris)))
  ).filter((c) => c !== 'non précisé')
  if (knownColoris.length > 0) {
    for (const m of summary.mes) {
      m.coloris = parseMesColoris(path.basename(m.file), knownColoris)
    }
  }
  return summary
}

function buildColoris(
  coloris: string,
  kitRef: string | null,
  colorCode: string | null,
  jpgs: string[],
  pngs: string[]
): ColorisSummary {
  // Face fermée : préférence au rendu WEB (format site) quand il existe en double.
  const faces = jpgs.filter((f) => detectView(path.basename(f)).isFaceView)
  const faceJpg = faces.find((f) => /\\WEB\\|\/WEB\//i.test(f)) ?? faces[0] ?? null
  // Rapprochement JPG↔PNG non trivial (noms fournisseur) : v1 = premier PNG
  // marqué face, sinon PNG unique du dossier, sinon rien (le détourage tranchera).
  const facePng =
    pngs.find((f) => detectView(path.basename(f)).isFaceView) ??
    (pngs.length === 1 ? pngs[0] : null)
  return {
    coloris,
    kitRef,
    colorCode,
    jpgCount: jpgs.length,
    pngCount: pngs.length,
    faceJpg,
    facePng,
    detectedColoris: null,
  }
}

/**
 * Devine le coloris des cartes NON nommées (« non précisé ») à partir de leur
 * visuel de face — LECTURE SEULE, en-têtes + pixels centraux. Concurrence bornée
 * pour ménager le serveur de fichiers. Ce qui est déjà nommé dans les dossiers
 * n'est jamais deviné (le nom fait foi).
 */
export async function detectColorisForGamme(
  gammeDir: string,
  summary: GammeSummary
): Promise<void> {
  const pending = summary.sizes
    .flatMap((s) => s.coloris)
    .filter((c) => c.coloris === 'non précisé' && (c.facePng || c.faceJpg))
  if (pending.length === 0) return
  let cursor = 0
  const worker = async () => {
    while (cursor < pending.length) {
      const c = pending[cursor++]
      const rel = c.facePng ?? c.faceJpg
      if (!rel) continue
      try {
        const det = await detectColoris(path.join(gammeDir, rel))
        if (det.coloris) c.detectedColoris = colorisDef(det.coloris)?.label ?? null
      } catch {
        // Visuel illisible : reste sans proposition.
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
}

function scanImageProduit(dir: string, relBase: string, summary: GammeSummary): void {
  for (const sizeEntry of safeReadDir(dir, summary.warnings)) {
    if (!sizeEntry.isDirectory()) continue
    if (isIgnoredDir(sizeEntry.name)) continue
    const sizeInfo = parseSizeDir(sizeEntry.name)
    if (!sizeInfo) {
      summary.warnings.push(`Taille non reconnue : ${path.join(relBase, sizeEntry.name)}`)
      continue
    }
    const size: SizeSummary = { ...sizeInfo, coloris: [] }
    const sizeDir = path.join(dir, sizeEntry.name)
    const entries = safeReadDir(sizeDir, summary.warnings)

    for (const colorEntry of entries) {
      if (!colorEntry.isDirectory()) continue
      if (isIgnoredDir(colorEntry.name)) continue
      const info = parseColorisDir(colorEntry.name)
      if (!info) continue // sous-dossier technique (Png…) : géré par collectColorisFiles
      const relColor = path.join(relBase, sizeEntry.name, colorEntry.name)
      const { jpgs, pngs } = collectColorisFiles(
        path.join(sizeDir, colorEntry.name),
        relColor,
        summary.warnings
      )
      size.coloris.push(buildColoris(info.coloris, info.kitRef, info.colorCode, jpgs, pngs))
    }

    // Variantes SANS sous-dossier coloris : fichiers à plat dans le dossier
    // taille (coulissants, réf SKU dans le nom du dossier) ou rangés en
    // RENDU\WEB|MP|PNG (VALIER, réf SKU dans les noms de fichiers).
    if (size.coloris.length === 0) {
      const rel = path.join(relBase, sizeEntry.name)
      const { jpgs, pngs } = collectColorisFiles(sizeDir, rel, summary.warnings)
      if (jpgs.length > 0 || pngs.length > 0) {
        const kitRef =
          parseSkuRef(sizeEntry.name) ??
          parseSkuRef(path.basename(jpgs[0] ?? pngs[0] ?? '')) ??
          null
        // Coloris écrit dans le NOM du dossier taille (convention ATHOS :
        // « ATHOS 300B140 - Gris »), sinon « non précisé » (la détection image
        // proposera alors une valeur).
        const coloris = parseColorisFromDirName(sizeEntry.name) ?? 'non précisé'
        size.coloris.push(buildColoris(coloris, kitRef, null, jpgs, pngs))
      } else {
        summary.warnings.push(`Aucun coloris reconnu pour la taille ${sizeInfo.label}`)
      }
    }
    summary.sizes.push(size)
  }
  summary.sizes.sort((a, b) => a.w - b.w || a.h - b.h)
}

/**
 * MES existantes — RÈGLE (Mathias, 12/07/2026) : seules comptent les images
 * des dossiers de SORTIE au sein de « M.E.S IA » : `RENDU` (convention
 * actuelle) et `Export` (ancienne convention, ex. « Export WEB ») — SAUF
 * « Export RUNWAY » (essais vidéo, ignorés). Rien des LINK, PROJECT ou
 * fichiers à plat — sources et travail en cours. Le format vient du dossier
 * porteur (2000x1330, WEB, MP…), sinon du nom de fichier, sinon des
 * dimensions lues.
 */
/** Taille d'une MES : nom de fichier d'abord, puis dossiers parents (du plus proche au plus lointain). */
function mesSizeFromPath(relPath: string): string | null {
  const parts = relPath.split(/[\\/]+/)
  for (let i = parts.length - 1; i >= 0; i--) {
    const size = parseSizeFromProductName(parts[i])
    if (size) return `${size.w}x${size.h}`
  }
  return null
}

function scanMesIa(
  dir: string,
  relBase: string,
  summary: GammeSummary,
  depth = 0,
  inheritedFormat: string | null = null,
  inRendu = false
): void {
  if (depth > 5) return
  for (const entry of safeReadDir(dir, summary.warnings)) {
    const rel = path.join(relBase, entry.name)
    if (entry.isFile()) {
      if (!inRendu) continue // hors RENDU : sources et fichiers de travail, jamais des MES
      if (!isImage(entry.name)) continue
      const raw = inheritedFormat ?? parseMesFileFormat(entry.name) ?? 'autre'
      // Le coloris est posé en fin de scanGamme (il faut connaître ceux de la gamme).
      summary.mes.push({
        format: normalizeFormat(raw),
        file: rel,
        size: mesSizeFromPath(rel),
        coloris: null,
      })
      continue
    }
    if (!entry.isDirectory()) continue
    const dirName = normalizeDirName(entry.name)
    if (isIgnoredDir(entry.name) || dirName === 'LINK' || dirName.includes('RUNWAY')) continue
    const isRendu =
      inRendu || dirName === 'RENDU' || dirName === 'RENDUS' || dirName.startsWith('EXPORT')
    const format = parseRenduFormat(entry.name) ?? inheritedFormat
    scanMesIa(path.join(dir, entry.name), rel, summary, depth + 1, format, isRendu)
  }
}

/**
 * Résolution des formats restés « autre » par LECTURE DES DIMENSIONS de
 * l'image (règle Mathias : nom d'abord, sinon on regarde la taille —
 * ratio 1:1 = marketplace, ratio 2000/1330 = site). Lecture seule, en-têtes
 * uniquement, concurrence bornée pour ménager le serveur de fichiers.
 */
export async function resolveMesFormats(gammeDir: string, summary: GammeSummary): Promise<void> {
  const pending = summary.mes.filter((m) => m.format === 'autre')
  if (pending.length === 0) return
  let cursor = 0
  const worker = async () => {
    while (cursor < pending.length) {
      const m = pending[cursor++]
      try {
        const meta = await sharp(path.join(gammeDir, m.file)).metadata()
        if (meta.width && meta.height) {
          const fmt = canonicalMesFormat(meta.width, meta.height)
          if (fmt !== 'autre') m.format = fmt
        }
      } catch {
        // Image illisible : reste « autre ».
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
}

/** Statut de fiche : « à compléter » dès qu'une anomalie est détectée. */
export function deriveStatus(summary: GammeSummary): 'detecte' | 'a_completer' {
  return summary.warnings.length > 0 ? 'a_completer' : 'detecte'
}

export interface ScanReport {
  scanned: number
  errors: string[]
  durationMs: number
}

/**
 * Scan complet du périmètre : upsert des pages produit en base (locale).
 * `root` n'est paramétrable que pour les tests — par défaut le réglage admin.
 */
export async function runCatalogScan(
  db: Database.Database = getDb(),
  root?: string
): Promise<ScanReport> {
  const started = Date.now()
  const serverRoot = root ?? getServerRoot(db)
  const errors: string[] = []
  let scanned = 0

  const upsert = db.prepare(
    `INSERT INTO catalog_products (brand, family, name, server_path, status, summary, new_refs, last_scan_at)
     VALUES (@brand, @family, @name, @serverPath, @status, @summary, @newRefs, datetime('now'))
     ON CONFLICT(server_path) DO UPDATE SET
       brand = excluded.brand, family = excluded.family, name = excluded.name,
       status = excluded.status, summary = excluded.summary, new_refs = excluded.new_refs,
       last_scan_at = excluded.last_scan_at`
  )
  const readSummary = db.prepare('SELECT summary FROM catalog_products WHERE server_path = ?')

  for (const { brand, families } of SCAN_BRANDS) {
    for (const family of families) {
      const familyDir = path.join(serverRoot, brand, 'PRODUITS', family)
      if (!fs.existsSync(familyDir)) {
        errors.push(`Dossier famille introuvable : ${familyDir}`)
        continue
      }
      const gammes: { name: string; dir: string }[] = []
      for (const entry of safeReadDir(familyDir, errors)) {
        if (entry.isDirectory() && !isIgnoredDir(entry.name)) {
          gammes.push({ name: entry.name.trim(), dir: path.join(familyDir, entry.name) })
        }
      }
      // Le scan (réseau) se fait HORS transaction ; seule l'écriture locale est groupée.
      const rows: Record<string, string>[] = []
      for (const g of gammes) {
        const summary = scanGamme(g.dir)
        await resolveMesFormats(g.dir, summary)
        await detectColorisForGamme(g.dir, summary)
        // Diff NOUVEAU : le résumé PRÉCÉDENT (déjà en base) sert de référence.
        const prev = readSummary.get(g.dir) as { summary: string } | undefined
        const prevRefs = prev ? summaryRefKeys(JSON.parse(prev.summary) as GammeSummary) : null
        const newRefs = diffNewRefs(prevRefs, summaryRefKeys(summary))
        rows.push({
          brand,
          family,
          name: g.name,
          serverPath: g.dir,
          status: deriveStatus(summary),
          summary: JSON.stringify(summary),
          newRefs: JSON.stringify(newRefs),
        })
      }
      db.transaction(() => {
        for (const row of rows) upsert.run(row)
      })()
      scanned += rows.length
    }
  }

  return { scanned, errors, durationMs: Date.now() - started }
}

export function listCatalogProducts(db: Database.Database = getDb()): CatalogProductRow[] {
  return db
    .prepare('SELECT * FROM catalog_products ORDER BY brand, family, name')
    .all() as CatalogProductRow[]
}

export function getCatalogProduct(
  id: number,
  db: Database.Database = getDb()
): CatalogProductRow | undefined {
  return db.prepare('SELECT * FROM catalog_products WHERE id = ?').get(id) as
    | CatalogProductRow
    | undefined
}

/**
 * Rescan d'UN SEUL produit (bouton ↻ de la page produit — demande Mathias :
 * jamais tout le serveur depuis une page produit). Quelques secondes au lieu
 * de plusieurs minutes.
 */
export async function rescanCatalogProduct(
  id: number,
  db: Database.Database = getDb()
): Promise<CatalogProductRow | undefined> {
  const product = getCatalogProduct(id, db)
  if (!product) return undefined
  const summary = scanGamme(product.server_path)
  await resolveMesFormats(product.server_path, summary)
  await detectColorisForGamme(product.server_path, summary)
  // Diff NOUVEAU vs le résumé précédent de CE produit (bloc 3.4).
  const prevRefs = summaryRefKeys(JSON.parse(product.summary) as GammeSummary)
  const newRefs = diffNewRefs(prevRefs, summaryRefKeys(summary))
  db.prepare(
    `UPDATE catalog_products SET status = ?, summary = ?, new_refs = ?, last_scan_at = datetime('now') WHERE id = ?`
  ).run(deriveStatus(summary), JSON.stringify(summary), JSON.stringify(newRefs), id)
  return getCatalogProduct(id, db)
}

/**
 * Résout un chemin relatif à une gamme vers un fichier du serveur, en LECTURE,
 * sans jamais sortir de la racine configurée (traversée interdite).
 */
export function resolveCatalogFile(product: CatalogProductRow, relPath: string): string | null {
  const root = path.resolve(product.server_path)
  const full = path.resolve(root, relPath)
  if (full !== root && !full.startsWith(root + path.sep)) return null
  try {
    if (!fs.statSync(full).isFile()) return null
  } catch {
    return null
  }
  return full
}
