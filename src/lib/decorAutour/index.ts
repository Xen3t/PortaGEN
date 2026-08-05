import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { isPng } from '@/lib/catalogue/parse'
import { config } from '@/lib/config'
import { computeLayout, projection, projectRect } from '@/lib/geometry'
import { poserProduitSurCible } from '@/lib/images/pose'
import { parseSizeFromProductName } from '@/lib/productName'

/**
 * MINI-APP « DÉCOR AUTOUR » (battants) — v2, retours Mathias 05/08/2026.
 *
 * On pose un PNG produit détouré sur un plan gris uni, MAIS à sa VRAIE échelle —
 * celle que PortaGEN calcule déjà pour ses MES (géométrie des gabarits :
 * computeLayout → projection → rectangle du portail). Nano peint ensuite l'entrée
 * tout autour, sans dessiner de piliers/muret gris (c'est Nano qui les construit).
 *
 * v2 : la sélection est un EXPLORATEUR de dossier (multi-images), la taille est
 * lue dans le nom de fichier (parseSizeFromProductName : « EIGER 300B140 » → 300×140).
 *
 * On réutilise tel quel :
 *  - la géométrie PortaGEN (src/lib/geometry) pour le rectangle du portail ;
 *  - la « pose » PortaGEN (src/lib/images/pose) pour le nettoyage du PNG
 *    (seuil alpha, réparation des pieds) et l'étirement sur la cible ;
 *  - le client Nano de l'app (src/lib/genai/client) côté route API.
 */

/** Racine de navigation : les produits détourés (borne de sécurité des chemins). */
const PRODUCTS_ROOT = path.join(config.dataDir, 'products')

/** Chemin relatif à la racine projet (format attendu par les routes/clients). */
function relOf(full: string): string {
  return path.relative(config.rootDir, full)
}

/** Vrai si `full` est PRODUCTS_ROOT ou vit dessous (anti-évasion de chemin). */
function sousProduits(full: string): boolean {
  return full === PRODUCTS_ROOT || full.startsWith(PRODUCTS_ROOT + path.sep)
}

export interface DossierCrumb {
  name: string
  rel: string
}
export interface DossierRef {
  name: string
  rel: string
}
export interface ImageRef {
  name: string
  rel: string
  /** Taille lue dans le nom (cm), null si non reconnue → non générable. */
  w: number | null
  h: number | null
}
export interface DossierListing {
  dir: string
  parent: string | null
  crumbs: DossierCrumb[]
  folders: DossierRef[]
  images: ImageRef[]
}

/** Fil d'Ariane de PRODUCTS_ROOT (« products ») jusqu'à `target` inclus. */
function construireCrumbs(target: string): DossierCrumb[] {
  const crumbs: DossierCrumb[] = [{ name: 'products', rel: relOf(PRODUCTS_ROOT) }]
  const sub = path.relative(PRODUCTS_ROOT, target)
  if (sub && sub !== '.') {
    let acc = PRODUCTS_ROOT
    for (const seg of sub.split(path.sep)) {
      acc = path.join(acc, seg)
      crumbs.push({ name: seg, rel: relOf(acc) })
    }
  }
  return crumbs
}

/**
 * Liste un dossier sous data/products : sous-dossiers + images PNG (avec la
 * taille lue dans le nom). `relDir` absent = racine data/products.
 */
export function listerDossier(relDir?: string): DossierListing {
  const target = relDir ? path.resolve(config.rootDir, relDir) : PRODUCTS_ROOT
  if (!sousProduits(target)) throw new Error('Dossier hors périmètre (data/products uniquement)')
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new Error('Dossier introuvable')
  }
  const entries = fs.readdirSync(target, { withFileTypes: true })
  const folders: DossierRef[] = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, rel: relOf(path.join(target, e.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  const images: ImageRef[] = entries
    .filter((e) => e.isFile() && isPng(e.name))
    .map((e) => {
      const size = parseSizeFromProductName(e.name)
      return { name: e.name, rel: relOf(path.join(target, e.name)), w: size?.w ?? null, h: size?.h ?? null }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  const parent = target === PRODUCTS_ROOT ? null : relOf(path.dirname(target))
  return { dir: relOf(target), parent, crumbs: construireCrumbs(target), folders, images }
}

export interface RenduRecent {
  /** Clé unique (base du nom de fichier) */
  key: string
  /** Libellé produit lisible (nom sans les jetons techniques) */
  title: string
  /** Taille lue dans le nom du rendu (cm) */
  w: number | null
  h: number | null
  /** Plan gris envoyé (rel) et rendu brut recadré (rel) — servis via /api/artifacts */
  planPath: string
  resultPath: string
  /** Date du fichier (ms) — tri du plus récent au plus ancien */
  mtime: number
}

/**
 * Liste les rendus DÉJÀ produits (data/artifacts/decor-autour), du plus récent
 * au plus ancien : chaque `final-<base>.jpg` apparié à son `plan-<base>.png`.
 * Permet à l'UI de retrouver les images après un rafraîchissement / redémarrage
 * (l'outil ne gardait l'historique qu'en mémoire).
 */
export function listerRendus(): RenduRecent[] {
  const dir = path.join(config.artifactsDir, 'decor-autour')
  if (!fs.existsSync(dir)) return []
  const files = new Set(fs.readdirSync(dir))
  const rendus: RenduRecent[] = []
  for (const f of files) {
    if (!f.startsWith('final-') || !/\.jpe?g$/i.test(f)) continue
    const base = f.replace(/^final-/, '').replace(/\.jpe?g$/i, '')
    const plan = `plan-${base}.png`
    if (!files.has(plan)) continue
    const m = base.match(/^(.*)-(\d+)x(\d+)-/)
    const finalFull = path.join(dir, f)
    rendus.push({
      key: base,
      title: m ? m[1].replace(/-/g, ' ').trim() : base,
      w: m ? Number(m[2]) : null,
      h: m ? Number(m[3]) : null,
      planPath: relOf(path.join(dir, plan)),
      resultPath: relOf(finalFull),
      mtime: fs.statSync(finalFull).mtimeMs,
    })
  }
  return rendus.sort((a, b) => b.mtime - a.mtime)
}

/** Résout un chemin d'image demandé par l'UI (PNG sous data/products). */
export function resoudreProduit(rel: string): string {
  const full = path.resolve(config.rootDir, rel)
  if (!sousProduits(full)) throw new Error('Image hors périmètre')
  if (!fs.existsSync(full) || !fs.statSync(full).isFile() || !isPng(full)) {
    throw new Error('Image introuvable')
  }
  return full
}

/** Taille (cm) lue dans le nom d'un fichier, ou erreur claire si absente. */
export function tailleProduit(fileName: string): { w: number; h: number } {
  const size = parseSizeFromProductName(fileName)
  if (!size) throw new Error(`Taille introuvable dans le nom : ${fileName}`)
  return size
}

export interface PlanGris {
  /** Plan gris (format livraison) avec le portail posé à sa vraie échelle (PNG) */
  buffer: Buffer
  /** Rectangle réellement couvert par le portail (px) */
  portail: { x: number; y: number; w: number; h: number }
  planW: number
  planH: number
  /** Pixels de matière restaurés dans les trous d'alpha (pieds alu…) */
  alphaReparePx: number
}

export interface PlanGrisOptions {
  /** Alpha minimal conservé au nettoyage (0-255) — réglage moteur poseSeuilAlpha */
  seuilAlpha?: number
  /** Réparation de la bande basse (pieds) — false pour un produit SANS pieds */
  reparePieds?: boolean
  /** Réparation des poches enclavées — false pour le coulissant (clairance sous-lame) */
  reparePochesPieds?: boolean
}

/**
 * Construit le plan gris : produit posé à l'échelle PortaGEN. Le rectangle du
 * portail vient de la géométrie des gabarits (défauts battant) ; AUCUN débord
 * (on ne pose pas de piliers, Nano les peint autour). Accepte un chemin OU un
 * Buffer (produit déjà traité — RALify — côté pipeline).
 */
export async function construirePlanGris(
  produit: Buffer | string,
  size: { w: number; h: number },
  opts: PlanGrisOptions = {}
): Promise<PlanGris> {
  const layout = computeLayout(size)
  const planW = config.delivery.width
  const planH = config.delivery.height
  const proj = projection(planW, planH, layout.sceneW, layout.sceneH, 'stretch')
  const portail = projectRect(
    { x: layout.gateLeft, y: layout.gateTop, w: layout.gateW, h: layout.gateH },
    proj
  )

  const gris = await sharp({
    create: { width: planW, height: planH, channels: 4, background: { r: 200, g: 200, b: 200, alpha: 1 } },
  })
    .png()
    .toBuffer()

  const pose = await poserProduitSurCible(
    gris,
    produit,
    { x: portail.x, y: portail.y, w: portail.w, h: portail.h },
    opts.seuilAlpha,
    opts.reparePochesPieds ?? true,
    opts.reparePieds ?? true
  )
  return {
    buffer: pose.image,
    portail: pose.cible,
    planW,
    planH,
    alphaReparePx: pose.produit.alphaReparePx,
  }
}

/** Description par défaut de l'ambiance (éditable côté UI). */
export const DESCRIPTION_DEFAUT =
  "Derrière le portail, une maison individuelle française (pavillon) vue de face, façade frontale visible au-dessus du muret. De part et d'autre, piliers carrés et muret bas en stucco blanc (crépi), chapeau plat. Devant, trottoir béton, bordure, route bitume. Grand ciel bleu dégagé et ensoleillé, lumière franche de beau temps."

/**
 * Prompt « décor autour » : ossature FIXE (élévation à plat + portail verrouillé,
 * les deux leviers validés au banc v1) autour de la description ÉDITABLE de
 * l'ambiance. On ne dit jamais « coulissant/glisser » — ici c'est un battant.
 */
export function promptDecorAutour(description: string): string {
  const desc = description.trim() || DESCRIPTION_DEFAUT
  return `Photorealistic photograph shot as a strict ARCHITECTURAL ELEVATION / flat front view. The camera is exactly perpendicular to the gate, dead-on, at gate mid-height. ZERO perspective: no vanishing point, no diagonal lines, no 3/4 angle, no foreshortening. Everything is parallel to the image plane — walls run perfectly horizontal from the left edge to the right edge, pillars are vertical, and the ground layers (sidewalk, kerb, road) read as flat HORIZONTAL BANDS stacked one above another across the whole width.

The attached image is a plain neutral-grey work canvas with a wooden double-swing driveway gate already correctly placed and centered on it. The grey area is empty and must be replaced by a realistic environment, keeping this same flat frontal geometry.

Build the environment AROUND the gate, all seen perfectly head-on. Ambiance: ${desc}

KEEP THE GATE UNCHANGED: same exact size, width, height, centred position, slats, texture, colour and hardware as in the input. Do NOT resize, move, recenter or restyle it — only construct the entrance strictly around its current outline.

Photorealistic, high detail. Absolutely FLAT, FRONTAL, symmetrical — no perspective whatsoever.`
}
