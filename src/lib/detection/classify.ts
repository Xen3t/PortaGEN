import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'
import { blobToEmbedding, cosineSimilarity } from '@/lib/detection/embeddings'
import { axisStamp, listAxisExamples, listColorisExamples } from '@/lib/detection/store'

/**
 * Classement par plus proches voisins sur les exemples appris (24/07/2026).
 *
 * Deux recettes, un seul entraînement (les clics de l'atelier) :
 *  - VUE (et famille/gamme) : ressemblance d'EMPREINTE visuelle — l'empreinte
 *    voit les formes et le style, exactement ce qui distingue FRONT / BACK /
 *    ST / MES… ;
 *  - COLORIS : distance de COULEUR MESURÉE (clarté, teinte, fraction de
 *    matière — mesure existante de coloris.ts), gamme par gamme, car
 *    l'empreinte est quasi aveugle aux nuances gris/noir (mesuré : deux faces
 *    gris/noir ≈ 0,98 de similarité d'empreinte).
 *
 * Principe assumé : en dessous des seuils, on répond « je ne sais pas » (l'image
 * part dans la file de l'atelier) plutôt que d'inventer — c'est ce qui élimine
 * les faux positifs.
 */

const K = 5
/** En dessous : aucun exemple ressemblant → pas de proposition. */
const MIN_SIMILARITY = 0.55
/** Proposition « sûre » : voisinage net ET quasi unanime. */
const SURE_SIMILARITY = 0.72
const SURE_SHARE = 0.75

export interface VuePrediction {
  keyword: string | null
  /** 0..1 — part du vote × similarité du meilleur voisin. */
  conf: number
  sure: boolean
  why: string | null
}

interface VueNeighbor {
  label: string
  sim: number
  productName: string
}

interface VueCache {
  stamp: string
  examples: Array<{ label: string; embedding: Float32Array; productName: string }>
}

/** Cache mémoire des exemples de vue, accroché à globalThis (hot-reload dev). */
const g = globalThis as typeof globalThis & { __portagenVueCache?: VueCache }

function vueExamples(db: Database.Database): VueCache['examples'] {
  const stamp = axisStamp('vue', db)
  if (!g.__portagenVueCache || g.__portagenVueCache.stamp !== stamp) {
    g.__portagenVueCache = {
      stamp,
      examples: listAxisExamples('vue', db).map((e) => ({
        label: e.label,
        embedding: blobToEmbedding(e.embedding),
        productName: e.productName,
      })),
    }
  }
  return g.__portagenVueCache.examples
}

/** Les K voisins les plus proches (petit N : parcours complet, pas d'index). */
function nearest(
  embedding: Float32Array,
  examples: VueCache['examples'],
  k: number,
  skip?: (e: VueCache['examples'][number]) => boolean
): VueNeighbor[] {
  const best: VueNeighbor[] = []
  for (const e of examples) {
    if (skip?.(e)) continue
    const sim = cosineSimilarity(embedding, e.embedding)
    if (best.length < k) {
      best.push({ label: e.label, sim, productName: e.productName })
      best.sort((a, b) => b.sim - a.sim)
    } else if (sim > best[k - 1].sim) {
      best[k - 1] = { label: e.label, sim, productName: e.productName }
      best.sort((a, b) => b.sim - a.sim)
    }
  }
  return best
}

function voteFromNeighbors(neighbors: VueNeighbor[]): VuePrediction {
  const near = neighbors.filter((n) => n.sim >= MIN_SIMILARITY)
  if (near.length === 0) {
    return { keyword: null, conf: 0, sure: false, why: 'aucun exemple ressemblant' }
  }
  // Poids = ce qui dépasse le seuil (un voisin limite pèse peu, un quasi-jumeau pèse lourd).
  const weights = new Map<string, number>()
  for (const n of near) {
    weights.set(n.label, (weights.get(n.label) ?? 0) + (n.sim - MIN_SIMILARITY))
  }
  let top: string | null = null
  let topW = 0
  let totalW = 0
  for (const [label, w] of weights) {
    totalW += w
    if (w > topW) {
      top = label
      topW = w
    }
  }
  const share = totalW > 0 ? topW / totalW : 0
  const topNeighbors = near.filter((n) => n.label === top)
  const topSim = topNeighbors[0].sim
  const gammes = Array.from(new Set(topNeighbors.map((n) => n.productName))).slice(0, 3)
  return {
    keyword: top,
    conf: Math.round(share * topSim * 100) / 100,
    sure: share >= SURE_SHARE && topSim >= SURE_SIMILARITY && topNeighbors.length >= 2,
    why: `ressemble à ${topNeighbors.length} exemple${topNeighbors.length > 1 ? 's' : ''} « ${top} » (${gammes.join(', ')})`,
  }
}

/** Prédit le mot-clé de vue d'une image à partir de son empreinte. */
export function classifyVue(embedding: Float32Array, db: Database.Database = getDb()): VuePrediction {
  return voteFromNeighbors(nearest(embedding, vueExamples(db), K))
}

/**
 * Fiabilité mesurée : chaque exemple de vue est reclassé par ses voisins SAUF
 * lui-même (validation « un contre tous »), sur un échantillon borné.
 */
export function selfTestVue(
  db: Database.Database = getDb(),
  maxN = 300
): { testes: number; corrects: number; fiabilite: number | null } {
  const examples = vueExamples(db)
  if (examples.length < 8) return { testes: 0, corrects: 0, fiabilite: null }
  const step = Math.max(1, Math.floor(examples.length / maxN))
  let testes = 0
  let corrects = 0
  for (let i = 0; i < examples.length; i += step) {
    const target = examples[i]
    const pred = voteFromNeighbors(
      nearest(target.embedding, examples, K, (e) => e === target)
    )
    testes++
    if (pred.keyword === target.label) corrects++
  }
  return { testes, corrects, fiabilite: testes > 0 ? corrects / testes : null }
}

// ————————————————————————————— Coloris —————————————————————————————

export interface ColorisFeatures {
  /** Clarté 0..255 de la matière (bas = foncé). */
  L: number
  /** Teinte b−r (+ bleuté, − chaud/bois). */
  tint: number
  /** Fraction de matière colorée/sombre dans la zone centrale. */
  matFrac: number
}

export interface ColorisPrediction {
  coloris: string | null
  sure: boolean
  why: string | null
}

/** Distance de couleur normalisée (échelles mesurées sur les 86 visuels de juillet). */
function colorisDistance(a: ColorisFeatures, b: ColorisFeatures): number {
  const dL = (a.L - b.L) / 40
  const dT = (a.tint - b.tint) / 25
  const dM = (a.matFrac - b.matFrac) / 0.35
  return Math.sqrt(dL * dL + dT * dT + dM * dM)
}

const COLORIS_K = 5
/** Au-delà : la matière ne ressemble à aucun exemple → pas de proposition. */
const COLORIS_MAX_DISTANCE = 1.6
/** « Sûr » : voisin très proche et vote net. */
const COLORIS_SURE_DISTANCE = 0.6
const COLORIS_SURE_SHARE = 0.8

/**
 * Prédit le coloris depuis la couleur mesurée de la matière. Les voisins de la
 * MÊME gamme comptent double (leçon de juillet : le gris d'ATHOS est plus
 * foncé que le noir de VALIER — on ne compare jamais deux gammes à égalité).
 */
export function classifyColoris(
  features: ColorisFeatures,
  gamme: string | null,
  db: Database.Database = getDb()
): ColorisPrediction {
  const rows = listColorisExamples(db)
  const examples: Array<{ label: string; gamme: string | null; f: ColorisFeatures }> = []
  for (const r of rows) {
    try {
      const f = JSON.parse(r.features ?? '') as ColorisFeatures
      if (typeof f?.L === 'number' && typeof f?.tint === 'number') {
        examples.push({ label: r.label, gamme: r.gamme, f })
      }
    } catch {
      // Traits illisibles : exemple ignoré.
    }
  }
  if (examples.length === 0) return { coloris: null, sure: false, why: null }

  const scored = examples
    .map((e) => ({
      label: e.label,
      sameGamme: !!gamme && !!e.gamme && e.gamme.toUpperCase() === gamme.toUpperCase(),
      d: colorisDistance(features, e.f),
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, COLORIS_K)
    .filter((s) => s.d <= COLORIS_MAX_DISTANCE)
  if (scored.length === 0) return { coloris: null, sure: false, why: 'matière hors des exemples connus' }

  const weights = new Map<string, number>()
  for (const s of scored) {
    const w = (1 / (s.d + 0.15)) * (s.sameGamme ? 2 : 1)
    weights.set(s.label, (weights.get(s.label) ?? 0) + w)
  }
  let top: string | null = null
  let topW = 0
  let totalW = 0
  for (const [label, w] of weights) {
    totalW += w
    if (w > topW) {
      top = label
      topW = w
    }
  }
  const share = totalW > 0 ? topW / totalW : 0
  const best = scored.find((s) => s.label === top)
  const nTop = scored.filter((s) => s.label === top).length
  const sure =
    share >= COLORIS_SURE_SHARE && !!best && best.d <= COLORIS_SURE_DISTANCE && nTop >= 2
  return {
    coloris: top,
    sure,
    why: `couleur proche de ${nTop} exemple${nTop > 1 ? 's' : ''} « ${top} »${
      best?.sameGamme ? ' (même gamme)' : ''
    }`,
  }
}
