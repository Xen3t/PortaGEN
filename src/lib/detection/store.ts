import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'

/**
 * Stockage de la détection des images (chantier 24/07/2026) :
 *  - detection_images : inventaire des images du serveur (lecture seule) avec
 *    empreinte visuelle et dernière prédiction de vue ;
 *  - detection_examples : exemples appris, un par (image, axe).
 *
 * Règle de préséance des sources (du plus fort au plus faible) :
 * atelier > fiche > nom/dossier. Une récolte automatique n'écrase JAMAIS un
 * clic de l'atelier ; un clic écrase tout.
 */

export type DetectionAxis = 'vue' | 'coloris' | 'famille' | 'gamme'
export type ExampleSource = 'nom' | 'dossier' | 'fiche' | 'atelier'

const SOURCE_RANK: Record<ExampleSource, number> = { nom: 0, dossier: 0, fiche: 1, atelier: 2 }

export interface DetectionImageRow {
  id: number
  product_id: number
  rel_path: string
  mtime_ms: number | null
  size: number | null
  width: number | null
  height: number | null
  embedding: Buffer | null
  pred_vue: string | null
  pred_vue_conf: number | null
  pred_vue_why: string | null
  bulk_rejected_vue: string | null
  error: string | null
  analyzed_at: string | null
}

export interface DetectionExampleRow {
  id: number
  product_id: number
  rel_path: string
  axis: DetectionAxis
  label: string
  source: ExampleSource
  features: string | null
  gamme: string | null
  created_at: string
}

export function upsertImage(
  img: {
    productId: number
    relPath: string
    mtimeMs: number | null
    size: number | null
  },
  db: Database.Database = getDb()
): DetectionImageRow {
  db.prepare(
    `INSERT INTO detection_images (product_id, rel_path, mtime_ms, size)
     VALUES (@productId, @relPath, @mtimeMs, @size)
     ON CONFLICT(product_id, rel_path) DO UPDATE SET
       -- Fichier modifié depuis : empreinte et prédiction à refaire.
       embedding = CASE WHEN detection_images.mtime_ms IS excluded.mtime_ms
         AND detection_images.size IS excluded.size THEN detection_images.embedding ELSE NULL END,
       pred_vue = CASE WHEN detection_images.mtime_ms IS excluded.mtime_ms
         AND detection_images.size IS excluded.size THEN detection_images.pred_vue ELSE NULL END,
       mtime_ms = excluded.mtime_ms, size = excluded.size, error = NULL`
  ).run(img)
  return db
    .prepare('SELECT * FROM detection_images WHERE product_id = ? AND rel_path = ?')
    .get(img.productId, img.relPath) as DetectionImageRow
}

export function setImageEmbedding(
  id: number,
  embedding: Buffer,
  dims: { width: number; height: number } | null,
  db: Database.Database = getDb()
): void {
  db.prepare(
    `UPDATE detection_images SET embedding = ?, width = ?, height = ?, error = NULL,
       analyzed_at = datetime('now') WHERE id = ?`
  ).run(embedding, dims?.width ?? null, dims?.height ?? null, id)
}

export function setImageError(id: number, error: string, db: Database.Database = getDb()): void {
  db.prepare(
    `UPDATE detection_images SET error = ?, analyzed_at = datetime('now') WHERE id = ?`
  ).run(error, id)
}

export function setImagePrediction(
  id: number,
  pred: { vue: string | null; conf: number; why: string | null },
  db: Database.Database = getDb()
): void {
  db.prepare(
    `UPDATE detection_images SET pred_vue = ?, pred_vue_conf = ?, pred_vue_why = ? WHERE id = ?`
  ).run(pred.vue, pred.conf, pred.why, id)
}

export function getImage(id: number, db: Database.Database = getDb()): DetectionImageRow | undefined {
  return db.prepare('SELECT * FROM detection_images WHERE id = ?').get(id) as
    | DetectionImageRow
    | undefined
}

/**
 * Enregistre un exemple en respectant la préséance des sources. Retourne true
 * si l'exemple a été écrit (false = un exemple plus fort existait déjà).
 */
export function saveExample(
  ex: {
    productId: number
    relPath: string
    axis: DetectionAxis
    label: string
    source: ExampleSource
    features?: unknown
    gamme?: string | null
  },
  db: Database.Database = getDb()
): boolean {
  const existing = db
    .prepare(
      'SELECT source FROM detection_examples WHERE product_id = ? AND rel_path = ? AND axis = ?'
    )
    .get(ex.productId, ex.relPath, ex.axis) as { source: ExampleSource } | undefined
  if (existing && SOURCE_RANK[existing.source] > SOURCE_RANK[ex.source]) return false
  db.prepare(
    `INSERT INTO detection_examples (product_id, rel_path, axis, label, source, features, gamme)
     VALUES (@productId, @relPath, @axis, @label, @source, @features, @gamme)
     ON CONFLICT(product_id, rel_path, axis) DO UPDATE SET
       label = excluded.label, source = excluded.source, features = excluded.features,
       gamme = excluded.gamme, created_at = datetime('now')`
  ).run({
    productId: ex.productId,
    relPath: ex.relPath,
    axis: ex.axis,
    label: ex.label,
    source: ex.source,
    features: ex.features === undefined ? null : JSON.stringify(ex.features),
    gamme: ex.gamme ?? null,
  })
  return true
}

export function deleteExample(
  productId: number,
  relPath: string,
  axis: DetectionAxis,
  db: Database.Database = getDb()
): void {
  db.prepare(
    'DELETE FROM detection_examples WHERE product_id = ? AND rel_path = ? AND axis = ?'
  ).run(productId, relPath, axis)
}

/** Exemples d'un axe joints à leur image (empreinte présente uniquement). */
export interface AxisExample {
  label: string
  gamme: string | null
  features: string | null
  embedding: Buffer
  productName: string
  relPath: string
}

export function listAxisExamples(
  axis: DetectionAxis,
  db: Database.Database = getDb()
): AxisExample[] {
  return db
    .prepare(
      `SELECT e.label, e.gamme, e.features, i.embedding, p.name AS productName, e.rel_path AS relPath
       FROM detection_examples e
       JOIN detection_images i ON i.product_id = e.product_id AND i.rel_path = e.rel_path
       JOIN catalog_products p ON p.id = e.product_id
       WHERE e.axis = ? AND i.embedding IS NOT NULL`
    )
    .all(axis) as AxisExample[]
}

/** Exemples coloris : les traits mesurés suffisent, pas besoin d'empreinte. */
export function listColorisExamples(db: Database.Database = getDb()): Array<{
  label: string
  gamme: string | null
  features: string | null
}> {
  return db
    .prepare(
      `SELECT label, gamme, features FROM detection_examples
       WHERE axis = 'coloris' AND features IS NOT NULL`
    )
    .all() as Array<{ label: string; gamme: string | null; features: string | null }>
}

/** Jeton de fraîcheur d'un axe — invalide les caches mémoire du classement. */
export function axisStamp(axis: DetectionAxis, db: Database.Database = getDb()): string {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS mx,
         COALESCE(MAX(created_at), '') AS at FROM detection_examples WHERE axis = ?`
    )
    .get(axis) as { n: number; mx: number; at: string }
  return `${row.n}|${row.mx}|${row.at}`
}

export interface DetectionStats {
  images: { total: number; analysees: number; enErreur: number }
  aClasser: number
  exemples: {
    total: number
    parSource: Record<string, number>
    parAxe: Record<string, Array<{ label: string; n: number }>>
  }
}

export function detectionStats(db: Database.Database = getDb()): DetectionStats {
  const images = db
    .prepare(
      `SELECT COUNT(*) AS total,
         SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) AS analysees,
         SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS enErreur
       FROM detection_images`
    )
    .get() as { total: number; analysees: number | null; enErreur: number | null }
  const aClasser = db
    .prepare(
      `SELECT COUNT(*) AS n FROM detection_images i
       WHERE i.embedding IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM detection_examples e
         WHERE e.product_id = i.product_id AND e.rel_path = i.rel_path AND e.axis = 'vue'
       )`
    )
    .get() as { n: number }
  const parSource: Record<string, number> = {}
  for (const row of db
    .prepare(`SELECT source, COUNT(*) AS n FROM detection_examples GROUP BY source`)
    .all() as Array<{ source: string; n: number }>) {
    parSource[row.source] = row.n
  }
  const parAxe: Record<string, Array<{ label: string; n: number }>> = {}
  for (const row of db
    .prepare(
      `SELECT axis, label, COUNT(*) AS n FROM detection_examples
       GROUP BY axis, label ORDER BY axis, n DESC`
    )
    .all() as Array<{ axis: string; label: string; n: number }>) {
    ;(parAxe[row.axis] ??= []).push({ label: row.label, n: row.n })
  }
  const total = Object.values(parSource).reduce((a, b) => a + b, 0)
  return {
    images: {
      total: images.total,
      analysees: images.analysees ?? 0,
      enErreur: images.enErreur ?? 0,
    },
    aClasser: aClasser.n,
    exemples: { total, parSource, parAxe },
  }
}

/**
 * File de l'atelier : images analysées SANS exemple de vue, les moins sûres
 * d'abord (celles où les clics rapportent le plus).
 */
export function labelQueue(
  limit: number,
  db: Database.Database = getDb()
): Array<DetectionImageRow & { productName: string; family: string }> {
  return db
    .prepare(
      `SELECT i.*, p.name AS productName, p.family AS family
       FROM detection_images i
       JOIN catalog_products p ON p.id = i.product_id
       WHERE i.embedding IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM detection_examples e
         WHERE e.product_id = i.product_id AND e.rel_path = i.rel_path AND e.axis = 'vue'
       )
       -- Les refus du mode lots d'abord : l'utilisateur a déjà dit ce que
       -- l'image N'EST PAS — la trancher au plus vite a le plus de valeur.
       ORDER BY (i.bulk_rejected_vue IS NOT NULL) DESC, COALESCE(i.pred_vue_conf, 0) ASC, i.id ASC
       LIMIT ?`
    )
    .all(limit) as Array<DetectionImageRow & { productName: string; family: string }>
}

/**
 * Mode « par lots » (maquette atelier-detection-v5-lots, validée 27/07/2026) :
 * vues proposées = prédictions des images encore sans étiquette, comptées par
 * mot-clé — le lot d'une vue sert les images LES PLUS SÛRES d'abord.
 */
export function listBulkVues(
  db: Database.Database = getDb()
): Array<{ vue: string; n: number }> {
  return db
    .prepare(
      `SELECT i.pred_vue AS vue, COUNT(*) AS n
       FROM detection_images i
       WHERE i.embedding IS NOT NULL AND i.pred_vue IS NOT NULL
         AND (i.bulk_rejected_vue IS NULL OR i.bulk_rejected_vue <> i.pred_vue)
         AND NOT EXISTS (
         SELECT 1 FROM detection_examples e
         WHERE e.product_id = i.product_id AND e.rel_path = i.rel_path AND e.axis = 'vue'
       )
       GROUP BY i.pred_vue ORDER BY n DESC`
    )
    .all() as Array<{ vue: string; n: number }>
}

export function bulkQueue(
  vue: string,
  limit: number,
  offset: number,
  db: Database.Database = getDb()
): Array<DetectionImageRow & { productName: string; family: string }> {
  return db
    .prepare(
      `SELECT i.*, p.name AS productName, p.family AS family
       FROM detection_images i
       JOIN catalog_products p ON p.id = i.product_id
       WHERE i.embedding IS NOT NULL AND i.pred_vue = ?
         -- Décochée dans un lot de CETTE vue : ne revient jamais dans ces lots
         -- (elle attend en tête de la file un par un). Si une nouvelle analyse
         -- la prédit AUTREMENT, elle peut réapparaître dans le lot de l'autre vue.
         AND (i.bulk_rejected_vue IS NULL OR i.bulk_rejected_vue <> i.pred_vue)
         AND NOT EXISTS (
         SELECT 1 FROM detection_examples e
         WHERE e.product_id = i.product_id AND e.rel_path = i.rel_path AND e.axis = 'vue'
       )
       ORDER BY i.pred_vue_conf DESC, i.id ASC
       LIMIT ? OFFSET ?`
    )
    .all(vue, limit, offset) as Array<DetectionImageRow & { productName: string; family: string }>
}

/** Mémorise le refus d'un lot : « cette image n'est PAS un {vue} » (27/07/2026). */
export function rejectFromBulk(
  imageIds: number[],
  vue: string,
  db: Database.Database = getDb()
): void {
  const stmt = db.prepare('UPDATE detection_images SET bulk_rejected_vue = ? WHERE id = ?')
  const all = db.transaction(() => {
    for (const id of imageIds) stmt.run(vue, id)
  })
  all()
}

/** Derniers classements FAITS À LA MAIN (bande « mes derniers classements » + annuler). */
export function recentAtelierExamples(
  limit: number,
  db: Database.Database = getDb()
): Array<{
  imageId: number
  productId: number
  productName: string
  family: string
  relPath: string
  vue: string
  coloris: string | null
  createdAt: string
}> {
  return db
    .prepare(
      `SELECT i.id AS imageId, e.product_id AS productId, p.name AS productName,
         p.family AS family, e.rel_path AS relPath, e.label AS vue, e.created_at AS createdAt,
         (SELECT c.label FROM detection_examples c
          WHERE c.product_id = e.product_id AND c.rel_path = e.rel_path
            AND c.axis = 'coloris' AND c.source = 'atelier') AS coloris
       FROM detection_examples e
       JOIN detection_images i ON i.product_id = e.product_id AND i.rel_path = e.rel_path
       JOIN catalog_products p ON p.id = e.product_id
       WHERE e.axis = 'vue' AND e.source = 'atelier'
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT ?`
    )
    .all(limit) as Array<{
    imageId: number
    productId: number
    productName: string
    family: string
    relPath: string
    vue: string
    coloris: string | null
    createdAt: string
  }>
}

/**
 * Annule les classements FAITS À LA MAIN d'une image (tous axes) : elle
 * revient dans la file. Les exemples automatiques (nom/dossier/fiche) seront
 * re-récoltés à la prochaine analyse si le nom de fichier en fournit.
 */
export function deleteAtelierExamples(
  productId: number,
  relPath: string,
  db: Database.Database = getDb()
): number {
  const res = db
    .prepare(
      `DELETE FROM detection_examples
       WHERE product_id = ? AND rel_path = ? AND source = 'atelier'`
    )
    .run(productId, relPath)
  return res.changes
}
