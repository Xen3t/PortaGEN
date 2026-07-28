import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'
import {
  listCatalogProducts,
  type CatalogProductRow,
  type GammeSummary,
} from '@/lib/catalogue/scan'
import { isIgnoredDir, isImage, normalizeDirName } from '@/lib/catalogue/parse'
import { listColorisOverrides } from '@/lib/catalogue/colorisOverride'
import { colorisDefAll } from '@/lib/catalogue/colorisStore'
import { detectColoris } from '@/lib/images/coloris'
import {
  canonicalKeyword,
  parseVisualFromFileName,
  VUE_MOODBOARD,
} from '@/lib/detection/nomenclature'
import {
  blobToEmbedding,
  computeEmbedding,
  embeddingModelAvailable,
  embeddingToBlob,
} from '@/lib/detection/embeddings'
import { saveExample, setImageEmbedding, setImageError, setImagePrediction, upsertImage } from '@/lib/detection/store'
import { classifyVue } from '@/lib/detection/classify'

/**
 * Analyse de la détection (bouton « Analyser les images » de Admin → Détection
 * des images, 24/07/2026). En un passage, LECTURE SEULE du serveur :
 *
 *  1. inventaire des images de chaque gamme du catalogue ;
 *  2. récolte des exemples GRATUITS : mots-clés lus dans les noms conformes ou
 *     anciens, dossiers (M.E.S, moodboards, coloris nommés), corrections de
 *     fiches — les clics de l'atelier ne sont jamais écrasés ;
 *  3. empreinte visuelle de chaque image nouvelle ou modifiée (DINOv2 local) ;
 *  4. prédiction de vue sur tout l'inventaire → alimente la file de l'atelier
 *     (les moins sûres d'abord) et les propositions de renommage.
 *
 * Relançable à volonté : tout est incrémental (empreintes en cache par
 * fichier, upserts partout).
 *
 * SUIVI DÉTAILLÉ (maquette atelier-detection-v7-phases, validée 27/07/2026 —
 * « toutes les phases, je veux les voir ») : état PAR PHASE (fait/total/départ/
 * fin/bilan), fichier en cours, et journal des 200 derniers événements —
 * le tout servi par GET /api/detection/analyse pour la carte « Ce qui se
 * passe derrière ».
 */

export type PhaseKey = 'inventaire' | 'exemples' | 'empreintes' | 'classement'
export const PHASE_KEYS: ReadonlyArray<PhaseKey> = [
  'inventaire',
  'exemples',
  'empreintes',
  'classement',
]

export interface PhaseInfo {
  fait: number
  total: number
  demarreA: number | null
  finiA: number | null
  /** Résumé une fois la phase finie (« 36/36 gammes · 26 084 images »). */
  bilan: string | null
}

export interface JournalEntry {
  id: number
  /** Epoch ms. */
  t: number
  phase: PhaseKey | 'système'
  niveau: 'info' | 'erreur'
  msg: string
}

export interface DetectionProgress {
  actif: boolean
  /** Phase courante (compat bouton animé). */
  phase: PhaseKey | null
  fait: number
  total: number
  demarreA: number | null
  phaseDemarreA: number | null
  erreur: string | null
  /** Ce qui est traité en ce moment (« Empreinte de VOGEL\…\IMG_2041.png »). */
  courant: string | null
  phases: Record<PhaseKey, PhaseInfo>
  /** Les 200 derniers événements de la DERNIÈRE analyse (reset au lancement). */
  journal: JournalEntry[]
  /** Résumé de fin (« Analyse terminée en 14 min — … »), null tant que ça tourne. */
  resume: string | null
}

const JOURNAL_MAX = 200

function emptyPhases(): Record<PhaseKey, PhaseInfo> {
  const make = (): PhaseInfo => ({ fait: 0, total: 0, demarreA: null, finiA: null, bilan: null })
  return { inventaire: make(), exemples: make(), empreintes: make(), classement: make() }
}

const g = globalThis as typeof globalThis & {
  __portagenDetectionProgress?: DetectionProgress
  __portagenDetectionJournalId?: number
}

function progress(): DetectionProgress {
  if (!g.__portagenDetectionProgress) {
    g.__portagenDetectionProgress = {
      actif: false,
      phase: null,
      fait: 0,
      total: 0,
      demarreA: null,
      phaseDemarreA: null,
      erreur: null,
      courant: null,
      phases: emptyPhases(),
      journal: [],
      resume: null,
    }
  }
  // Bases d'état créées avant la v7 (hot-reload dev) : compléments doux.
  if (!g.__portagenDetectionProgress.phases) g.__portagenDetectionProgress.phases = emptyPhases()
  if (!g.__portagenDetectionProgress.journal) g.__portagenDetectionProgress.journal = []
  return g.__portagenDetectionProgress
}

export function getDetectionProgress(): DetectionProgress {
  return { ...progress() }
}

function logJ(phase: JournalEntry['phase'], msg: string, niveau: JournalEntry['niveau'] = 'info'): void {
  const p = progress()
  const id = (g.__portagenDetectionJournalId = (g.__portagenDetectionJournalId ?? 0) + 1)
  p.journal.push({ id, t: Date.now(), phase, niveau, msg })
  if (p.journal.length > JOURNAL_MAX) p.journal.splice(0, p.journal.length - JOURNAL_MAX)
}

function setCourant(txt: string | null): void {
  progress().courant = txt
}

function phaseStart(key: PhaseKey, total: number): void {
  const p = progress()
  p.phase = key
  p.fait = 0
  p.total = total
  p.phaseDemarreA = Date.now()
  p.phases[key].total = total
  p.phases[key].fait = 0
  p.phases[key].demarreA = Date.now()
}

function phaseTick(key: PhaseKey): void {
  const p = progress()
  p.fait++
  p.phases[key].fait = p.fait
}

function phaseEnd(key: PhaseKey, bilan: string): void {
  const p = progress()
  p.phases[key].finiA = Date.now()
  p.phases[key].bilan = bilan
}

/** Parcours PROFOND des images d'une gamme — mêmes exclusions que le scan. */
function walkImages(
  dir: string,
  relBase = '',
  depth = 0,
  out: Array<{ rel: string; mtimeMs: number; size: number }> = []
): Array<{ rel: string; mtimeMs: number; size: number }> {
  if (depth > 6) return out
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    const rel = relBase ? path.join(relBase, entry.name) : entry.name
    if (entry.isDirectory()) {
      const n = normalizeDirName(entry.name)
      if (isIgnoredDir(entry.name) || n === 'LINK' || n.includes('RUNWAY')) continue
      walkImages(full, rel, depth + 1, out)
      continue
    }
    if (!entry.isFile() || !isImage(entry.name)) continue
    try {
      const st = fs.statSync(full)
      out.push({ rel, mtimeMs: Math.round(st.mtimeMs), size: st.size })
    } catch {
      // Fichier illisible : ignoré, l'inventaire n'échoue jamais pour un fichier.
    }
  }
  return out
}

/** L'image est-elle rangée sous « M.E.S IA » (dossier de sorties) ? */
function isUnderMes(rel: string): boolean {
  return rel
    .split(/[\\/]+/)
    .some((seg) => normalizeDirName(seg).replace(/[^A-Z]/g, '').startsWith('MES'))
}

interface HarvestRow {
  imageId: number
  absPath: string
  rel: string
  productName: string
  hasEmbedding: boolean
}

/**
 * Récolte des exemples d'UN produit + inventaire de ses images.
 * Retourne les lignes d'inventaire et le nombre de fichiers disparus.
 */
function harvestProduct(
  product: CatalogProductRow,
  db: Database.Database
): { rows: HarvestRow[]; gone: number } {
  let summary: GammeSummary
  try {
    summary = JSON.parse(product.summary) as GammeSummary
  } catch {
    return { rows: [], gone: 0 }
  }
  const walked = walkImages(product.server_path)
  const walkedSet = new Set(walked.map((w) => w.rel))

  // Fichiers disparus du serveur : lignes et exemples retirés (les clics d'atelier
  // sur un fichier disparu ne peuvent plus servir de toute façon).
  const known = db
    .prepare('SELECT rel_path FROM detection_images WHERE product_id = ?')
    .all(product.id) as Array<{ rel_path: string }>
  const gone = known.filter((k) => !walkedSet.has(k.rel_path))
  if (gone.length > 0) {
    const delImg = db.prepare('DELETE FROM detection_images WHERE product_id = ? AND rel_path = ?')
    const delEx = db.prepare('DELETE FROM detection_examples WHERE product_id = ? AND rel_path = ?')
    for (const k of gone) {
      delImg.run(product.id, k.rel_path)
      delEx.run(product.id, k.rel_path)
    }
  }

  const rows: HarvestRow[] = []
  const moodboards = new Set(summary.moodboards.filter((m) => isImage(m)))
  for (const w of walked) {
    const row = upsertImage(
      { productId: product.id, relPath: w.rel, mtimeMs: w.mtimeMs, size: w.size },
      db
    )
    rows.push({
      imageId: row.id,
      absPath: path.join(product.server_path, w.rel),
      rel: w.rel,
      productName: product.name,
      hasEmbedding: row.embedding != null,
    })

    // Exemple de VUE lu dans le nom (conforme ou ancien), sinon déduit du rangement.
    const parsed = parseVisualFromFileName(path.basename(w.rel))
    if (parsed) {
      saveExample(
        {
          productId: product.id,
          relPath: w.rel,
          axis: 'vue',
          label: canonicalKeyword(parsed.ident),
          source: 'nom',
          gamme: product.name,
        },
        db
      )
    } else if (moodboards.has(w.rel)) {
      saveExample(
        { productId: product.id, relPath: w.rel, axis: 'vue', label: VUE_MOODBOARD, source: 'dossier', gamme: product.name },
        db
      )
    } else if (isUnderMes(w.rel)) {
      saveExample(
        { productId: product.id, relPath: w.rel, axis: 'vue', label: 'MES', source: 'dossier', gamme: product.name },
        db
      )
    }
  }
  return { rows, gone: gone.length }
}

/**
 * Exemples COLORIS + famille + gamme d'un produit : les visuels de face des
 * cartes NOMMÉES (le nom des dossiers fait foi) et les corrections de fiche.
 * Traits de couleur mesurés sur l'image (asynchrone — sharp). Retourne le
 * nombre d'exemples coloris écrits.
 */
async function harvestColoris(product: CatalogProductRow, db: Database.Database): Promise<number> {
  let summary: GammeSummary
  try {
    summary = JSON.parse(product.summary) as GammeSummary
  } catch {
    return 0
  }
  const overrides = listColorisOverrides(product.id, db)
  let saved = 0
  for (const size of summary.sizes) {
    for (const card of size.coloris) {
      const corrected = overrides[card.coloris]
      const named = card.coloris !== 'non précisé' ? card.coloris : null
      const raw = corrected ?? named
      if (!raw) continue
      // Label CANONISÉ via la palette (« GRIS » scanné et « Gris » corrigé sont
      // le même coloris — constaté le 24/07 : les doublons divisaient les votes).
      const label = colorisDefAll(raw, db)?.label ?? raw.trim()
      const rel = card.facePng ?? card.faceJpg
      if (!rel) continue
      const abs = path.join(product.server_path, rel)
      let features: { L: number; tint: number; matFrac: number }
      try {
        setCourant(`Mesure du coloris de ${product.name}\\${rel}`)
        const det = await detectColoris(abs)
        features = { L: det.L, tint: det.tint, matFrac: det.matFrac }
      } catch {
        continue // Visuel illisible : pas d'exemple couleur.
      }
      saveExample(
        {
          productId: product.id,
          relPath: rel,
          axis: 'coloris',
          label,
          source: corrected ? 'fiche' : 'dossier',
          features,
          gamme: product.name,
        },
        db
      )
      saved++
      // Le même visuel produit atteste aussi de la famille et de la gamme
      // (appris « en silence » depuis le rangement — décision Mathias 24/07).
      saveExample(
        { productId: product.id, relPath: rel, axis: 'famille', label: product.family, source: 'dossier', gamme: product.name },
        db
      )
      saveExample(
        { productId: product.id, relPath: rel, axis: 'gamme', label: product.name, source: 'dossier', gamme: product.name },
        db
      )
    }
  }
  return saved
}

let running: Promise<void> | null = null

/**
 * Respiration : rend la main à la boucle d'événements. Les phases inventaire et
 * classement sont SYNCHRONES (readdir réseau, cosinus) — sans cette pause à
 * chaque pas, le serveur ne répondrait plus à rien pendant plusieurs minutes
 * (bug du 24/07 : le clic sur « Analyser » paraissait mort, la réponse HTTP
 * attendait la fin de l'inventaire).
 */
const yieldTick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** Lance l'analyse complète si elle ne tourne pas déjà. Retourne false si déjà en cours. */
export function startAnalyse(db: Database.Database = getDb()): boolean {
  if (progress().actif) return false
  if (!embeddingModelAvailable()) {
    const p = progress()
    p.erreur = 'Modèle d’empreintes introuvable (models/dinov2-small.onnx)'
    return false
  }
  const p = progress()
  p.actif = true
  p.erreur = null
  p.demarreA = Date.now()
  p.phaseDemarreA = null
  p.courant = null
  p.phases = emptyPhases()
  p.journal = []
  p.resume = null
  logJ('système', 'Analyse lancée — lecture seule du serveur')
  // Départ DÉTACHÉ après la réponse HTTP : le clic répond tout de suite.
  running = (async () => {
    await yieldTick()
    await runAnalyse(db)
  })()
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e)
      progress().erreur = msg
      logJ('système', `Analyse arrêtée en erreur : ${msg}`, 'erreur')
    })
    .finally(() => {
      const st = progress()
      st.actif = false
      st.phase = null
      st.courant = null
      running = null
    })
  return true
}

async function runAnalyse(db: Database.Database): Promise<void> {
  const debut = Date.now()
  const products = listCatalogProducts(db)

  // 1. Inventaire + exemples de vue (noms/dossiers), produit par produit. Le
  // parcours d'une gamme est synchrone (readdir réseau) : respiration entre
  // chaque produit pour que le serveur continue de répondre.
  phaseStart('inventaire', products.length)
  logJ('inventaire', `${products.length} gammes à parcourir`)
  const toEmbed: Array<{ imageId: number; absPath: string; rel: string; productName: string }> = []
  let totalImages = 0
  for (const product of products) {
    setCourant(`Inventaire de ${product.name}`)
    const { rows, gone } = harvestProduct(product, db)
    totalImages += rows.length
    const nouvelles = rows.filter((r) => !r.hasEmbedding).length
    for (const r of rows) {
      if (!r.hasEmbedding) {
        toEmbed.push({ imageId: r.imageId, absPath: r.absPath, rel: r.rel, productName: r.productName })
      }
    }
    logJ(
      'inventaire',
      `${product.name} : ${rows.length} images` +
        (nouvelles > 0 ? ` · ${nouvelles} à analyser` : '') +
        (gone > 0 ? ` · ${gone} disparue${gone > 1 ? 's' : ''}` : '')
    )
    phaseTick('inventaire')
    await yieldTick()
  }
  phaseEnd('inventaire', `${products.length} gammes · ${totalImages.toLocaleString('fr-FR')} images`)

  // 2. Exemples coloris/famille/gamme depuis les cartes nommées + corrections.
  phaseStart('exemples', products.length)
  for (const product of products) {
    const n = await harvestColoris(product, db)
    if (n > 0) logJ('exemples', `${product.name} : ${n} exemple${n > 1 ? 's' : ''} coloris`)
    phaseTick('exemples')
  }
  const totalExemples = (
    db.prepare('SELECT COUNT(*) AS n FROM detection_examples').get() as { n: number }
  ).n
  logJ('exemples', `récolte terminée : ${totalExemples.toLocaleString('fr-FR')} exemples au total`)
  phaseEnd('exemples', `${totalExemples.toLocaleString('fr-FR')} exemples`)

  // 3. Empreintes des images nouvelles/modifiées — concurrence bornée pour
  // ménager le serveur de fichiers (même règle que le scan).
  phaseStart('empreintes', toEmbed.length)
  if (toEmbed.length === 0) logJ('empreintes', 'rien de nouveau — toutes les empreintes sont en cache')
  let embErrors = 0
  let cursor = 0
  const worker = async () => {
    while (cursor < toEmbed.length) {
      const item = toEmbed[cursor++]
      setCourant(`Empreinte de ${item.productName}\\${item.rel}`)
      try {
        const [embedding, meta] = await Promise.all([
          computeEmbedding(item.absPath),
          sharp(item.absPath)
            .metadata()
            .catch(() => null),
        ])
        setImageEmbedding(
          item.imageId,
          embeddingToBlob(embedding),
          meta?.width && meta?.height ? { width: meta.width, height: meta.height } : null,
          db
        )
      } catch (e) {
        embErrors++
        setImageError(item.imageId, e instanceof Error ? e.message : String(e), db)
        logJ('empreintes', `illisible : ${item.productName}\\${item.rel} — analyse poursuivie`, 'erreur')
      }
      phaseTick('empreintes')
      const fait = progress().phases.empreintes.fait
      if (fait % 100 === 0) {
        logJ('empreintes', `${fait.toLocaleString('fr-FR')}/${toEmbed.length.toLocaleString('fr-FR')} empreintes calculées`)
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  phaseEnd(
    'empreintes',
    `${(toEmbed.length - embErrors).toLocaleString('fr-FR')} nouvelle${toEmbed.length - embErrors > 1 ? 's' : ''}` +
      (embErrors > 0 ? ` · ${embErrors} illisible${embErrors > 1 ? 's' : ''}` : '')
  )

  // 4. Prédiction de vue sur tout l'inventaire analysé (file d'atelier + renommage).
  const analysed = db
    .prepare('SELECT id, embedding, pred_vue FROM detection_images WHERE embedding IS NOT NULL')
    .all() as Array<{ id: number; embedding: Buffer; pred_vue: string | null }>
  phaseStart('classement', analysed.length)
  setCourant('Classement de toutes les images')
  let changed = 0
  for (const row of analysed) {
    const pred = classifyVue(blobToEmbedding(row.embedding), db)
    if (pred.keyword !== row.pred_vue) changed++
    setImagePrediction(row.id, { vue: pred.keyword, conf: pred.conf, why: pred.why }, db)
    phaseTick('classement')
    const fait = progress().phases.classement.fait
    if (fait % 2000 === 0) {
      logJ('classement', `avis recalculés : ${fait.toLocaleString('fr-FR')}/${analysed.length.toLocaleString('fr-FR')}`)
    }
    // Classement synchrone (cosinus) : respiration régulière, même raison que l'inventaire.
    if (fait % 25 === 0) await yieldTick()
  }
  logJ(
    'classement',
    `avis recalculés : ${analysed.length.toLocaleString('fr-FR')} — ${changed.toLocaleString('fr-FR')} changent d'avis`
  )
  phaseEnd('classement', `${analysed.length.toLocaleString('fr-FR')} avis · ${changed.toLocaleString('fr-FR')} changés`)

  const minutes = Math.max(1, Math.round((Date.now() - debut) / 60000))
  const resume =
    `Analyse terminée en ${minutes} min — ` +
    `${(toEmbed.length - embErrors).toLocaleString('fr-FR')} nouvelles empreintes · ` +
    `${changed.toLocaleString('fr-FR')} avis changés` +
    (embErrors > 0 ? ` · ${embErrors} illisible${embErrors > 1 ? 's' : ''}` : '')
  progress().resume = resume
  logJ('système', resume)
}

/** Analyse en cours (pour l'API de progression). */
export function analyseRunning(): boolean {
  return running !== null
}
