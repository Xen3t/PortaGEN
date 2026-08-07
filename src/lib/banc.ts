import path from 'node:path'
import fs from 'node:fs'
import { config } from '@/lib/config'

/**
 * LOT du banc « génération & resizing » (robustesse au rechargement, demande
 * Mathias 07/08/2026) : les images préparées (détourées + RALify + posées) sont
 * consignées dans un MANIFESTE sur disque — `data/generation/<lotId>/banc.json`.
 * La page porte le lot dans son URL (?lot=…) : au reload elle relit le manifeste
 * (plans déjà construits) puis /api/gamme/<lotId> (jobs éventuels — le lot sert
 * aussi de batchId de génération).
 */

/** Format des identifiants de lot (aussi barrière anti-évasion de chemin). */
export const BANC_LOT_RE = /^banc-[a-z0-9]+-[a-z0-9]+$/i

export interface BancManifestItem {
  /** Nom du fichier déposé (affichage). */
  name: string
  w: number
  h: number
  coloris: string
  /** PNG produit enregistré (rel racine) — sert au lancement des jobs. */
  productPath: string
  /** Plan gris préparé (rel racine) — servi par /api/artifacts?p=. */
  planPath: string
  /** Plan gris SANS RALify (rel) — présent seulement si RALify a été appliqué ;
   *  nourrit le comparateur avant/après RALify de la vue en grand. */
  planBrutPath?: string
  /** N° de DÉPÔT (07/08) : chaque « Ajouter des images » forme un groupe — la
   *  page les affiche séparément, du plus récent au plus ancien (suivi du rodage). */
  groupe?: number
  /** Fichier ORIGINEL déposé, avant détourage (rel) — vue de contrôle. */
  originalPath?: string
  /** PNG produit RALifié (rel) — présent si RALify a été appliqué ; vue de contrôle. */
  ralifyPath?: string
  /** VERSION retenue (07/08) : id du job (decor-autour ou mes-fix) que la case
   *  affiche. Absent = suivre la dernière version prête. */
  chosenJobId?: number
}

export interface BancManifest {
  moteur: string
  produit: string
  items: BancManifestItem[]
}

export function bancLotDir(lotId: string): string {
  return path.join(config.dataDir, 'generation', lotId)
}

export function bancPlanDir(lotId: string): string {
  return path.join(config.artifactsDir, 'banc', lotId)
}

function manifestPath(lotId: string): string {
  return path.join(bancLotDir(lotId), 'banc.json')
}

export function lireBancManifest(lotId: string): BancManifest | null {
  if (!BANC_LOT_RE.test(lotId)) return null
  try {
    const raw = fs.readFileSync(manifestPath(lotId), 'utf8')
    const m = JSON.parse(raw) as BancManifest
    return Array.isArray(m.items) ? m : null
  } catch {
    return null
  }
}

export function ecrireBancManifest(lotId: string, manifest: BancManifest): void {
  if (!BANC_LOT_RE.test(lotId)) throw new Error('Identifiant de lot invalide')
  fs.writeFileSync(manifestPath(lotId), JSON.stringify(manifest, null, 2), 'utf8')
}

/**
 * Résout un chemin (rel racine) en vérifiant qu'il vit DANS le dossier du lot —
 * les étapes RALify/pose reçoivent des chemins du client, jamais hors du lot.
 */
export function resoudreSousLot(lotId: string, relPath: string): string {
  if (!BANC_LOT_RE.test(lotId)) throw new Error('Identifiant de lot invalide')
  const dir = bancLotDir(lotId)
  const full = path.resolve(config.rootDir, relPath)
  if (!full.startsWith(dir + path.sep)) throw new Error('Chemin hors du lot')
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error('Fichier introuvable')
  return full
}
