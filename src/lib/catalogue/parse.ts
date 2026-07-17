import { parseSizeFromProductName } from '@/lib/productName'

/**
 * Parseurs du scan serveur (catalogue vivant, cadrage 12/07/2026).
 * Les conventions de nommage du serveur sont HÉTÉROGÈNES (au moins trois
 * générations constatées sur VOGEL le 12/07/2026) : tout ici est tolérant —
 * espaces doubles, points optionnels, séparateurs variables. Ce qui n'est pas
 * reconnu n'est jamais bloquant : il devient un avertissement sur la fiche.
 * Module pur (aucun accès disque) — testé unitairement.
 */

/** Normalise un nom de dossier pour comparaison : majuscules, sans points ni espaces. */
export function normalizeDirName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.\s]+/g, '')
    .trim()
}

/** Dossiers standards d'une gamme, reconnus malgré les variantes (« M.E.S IA » / « M.E.S. IA »…). */
export type StandardDir =
  | 'image-produit'
  | 'image-fournisseur'
  | 'mes-ia'
  | 'moodboard'
  | 'autre'

export function classifyGammeDir(name: string): StandardDir {
  const n = normalizeDirName(name)
  // « PHOTO PRODUIT » = variante du template récent (constatée sur les portillons).
  if (
    n === 'IMAGEPRODUIT' ||
    n === 'IMAGESPRODUIT' ||
    n === 'IMAGESPRODUITS' ||
    n === 'PHOTOPRODUIT' ||
    n === 'PHOTOSPRODUIT' ||
    n === 'PHOTOSPRODUITS'
  ) {
    return 'image-produit'
  }
  if (n === 'IMAGEFOURNISSEUR' || n === 'IMAGESFOURNISSEUR' || n === 'IMAGESFOURNISSEURS') {
    return 'image-fournisseur'
  }
  if (n === 'MESIA' || n === 'MES') return 'mes-ia'
  if (n === 'MOODBOARD' || n === 'MOODBOARDS') return 'moodboard'
  return 'autre'
}

/** Dossiers à ignorer partout (archives, fichiers de travail, projets de retouche). */
export function isIgnoredDir(name: string): boolean {
  const n = name.trim().toUpperCase()
  return (
    n === '_OLD' ||
    n.startsWith('.') ||
    n.startsWith('RECOLORISATION') ||
    n.startsWith('PROJECT') ||
    n.startsWith('PROJET')
  )
}

/**
 * Réf SKU interne : KIT-000110 (portails), STW-000037 (portillons)…
 * Au moins 4 chiffres — les tailles (300, 160) n'en ont que 3, un nom de gamme
 * suivi d'une taille (« VOGEL 300C160 ») ne doit jamais passer pour une réf.
 */
export function parseSkuRef(text: string): string | null {
  const m = text.toUpperCase().match(/([A-Z]{2,5})[\s-]*(\d{4,})/)
  if (!m) return null
  return `${m[1]}-${m[2]}`
}

/**
 * Dossier coloris : « BLANC _ KIT-000110 », « BLANC_KIT-000545 », « GRIS _ 7016 ».
 * Gauche = nom du coloris ; droite = réf SKU (KIT-xxxxxx) ou code couleur fournisseur.
 */
export interface ColorisInfo {
  coloris: string
  kitRef: string | null
  colorCode: string | null
}

export function parseColorisDir(name: string): ColorisInfo | null {
  const m = name.match(/^(.+?)\s*_\s*(.+)$/)
  if (!m) return null
  const coloris = m[1].trim()
  const right = m[2].trim()
  if (!coloris) return null
  const ref = parseSkuRef(right)
  if (ref) return { coloris, kitRef: ref, colorCode: null }
  return { coloris, kitRef: null, colorCode: right || null }
}

/**
 * Coloris écrit DANS le nom du dossier taille (convention ATHOS : « ATHOS 300B140
 * - Gris », « … - Teck »), et non dans un sous-dossier. On ne le retient que si
 * un VRAI coloris connu apparaît — jamais une réf SKU (« … _ STW-000054 »).
 * Retourne un libellé canonique (Gris/Blanc/Noir/Teck) ou null.
 */
const COLORIS_WORDS: ReadonlyArray<{ rx: RegExp; label: string }> = [
  { rx: /\b(?:TECK|TEAK|BOIS)\b/, label: 'Teck' },
  { rx: /\b(?:BLANC|BLANCHE|WHITE)\b/, label: 'Blanc' },
  { rx: /\b(?:NOIR|NOIRE|BLACK)\b/, label: 'Noir' },
  { rx: /\b(?:GRIS|GRISE|GREY|GRAY|ANTHRACITE)\b/, label: 'Gris' },
]

export function parseColorisFromDirName(name: string): string | null {
  const n = name.toUpperCase()
  for (const w of COLORIS_WORDS) {
    if (w.rx.test(n)) return w.label
  }
  return null
}

/**
 * Vue d'un fichier image produit : on cherche FRONT/BACK dans le nom.
 * Pour les MES Contraintes portails, seule la face FERMÉE compte
 * (FRONT sans OPEN) — cadrage §6.
 */
export interface ViewInfo {
  view: 'front' | 'front-open' | 'back' | 'inconnue'
  isFaceView: boolean
}

export function detectView(fileName: string): ViewInfo {
  const n = fileName.toUpperCase()
  if (/FRONT/.test(n)) {
    if (/OPEN/.test(n)) return { view: 'front-open', isFaceView: false }
    return { view: 'front', isFaceView: true }
  }
  if (/BACK/.test(n)) return { view: 'back', isFaceView: false }
  return { view: 'inconnue', isFaceView: false }
}

/**
 * Type de vue pour le détourage (chantier 2). Plus fin que detectView :
 * distingue une vraie face d'une vue d'angle (« FRONT LEFT/RIGHT/3Q ») —
 * inutilisable pour une MES Contraintes posée de face.
 *  - face     : FRONT franc → détourable
 *  - presumed : aucun mot de vue → face présumée, à confirmer à l'œil
 *  - angle    : FRONT + LEFT/RIGHT/3Q/ANGLE/PERSP/SIDE → import du PNG de face
 *  - back     : vue de dos → import
 *  - open     : portail ouvert → import
 */
export type ViewKind = 'face' | 'presumed' | 'angle' | 'back' | 'open'

export function classifyView(fileName: string): ViewKind {
  const n = fileName.toUpperCase()
  if (/FRONT/.test(n)) {
    if (/OPEN/.test(n)) return 'open'
    if (/(LEFT|RIGHT|3Q|3-4|ANGLE|PERSP|SIDE)/.test(n)) return 'angle'
    return 'face'
  }
  if (/(BACK|ARRIERE|\bDOS\b)/.test(n)) return 'back'
  return 'presumed'
}

/** Une vue exploitable pour détourer une face (vraie face ou face présumée). */
export function isUsableFace(kind: ViewKind): boolean {
  return kind === 'face' || kind === 'presumed'
}

/** Extensions image reconnues par le scan. */
export function isJpg(name: string): boolean {
  return /\.jpe?g$/i.test(name)
}
export function isPng(name: string): boolean {
  return /\.png$/i.test(name)
}
export function isImage(name: string): boolean {
  return isJpg(name) || isPng(name) || /\.webp$/i.test(name)
}

/**
 * Dossier taille : « VOGEL 300B120 » → 300×120 via la nomenclature existante.
 * Retourne aussi le label brut pour l'affichage.
 */
export interface SizeDirInfo {
  label: string
  w: number
  h: number
}

export function parseSizeDir(name: string): SizeDirInfo | null {
  const size = parseSizeFromProductName(name)
  if (!size) return null
  return { label: name.trim(), w: size.w, h: size.h }
}

/**
 * Dossiers de rendu MES : « 2000x1330 », « 2000×2000 » (tolérant au séparateur),
 * mais aussi la convention plus ancienne « WEB » (format site 2000×1330) et
 * « MP » (marketplace 2000×2000) constatée sur VALIER.
 */
export function parseRenduFormat(name: string): string | null {
  const trimmed = name.trim()
  const m = trimmed.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i)
  if (m) return `${m[1]}x${m[2]}`
  // Le token peut être un MOT du nom de dossier (« Export WEB », « RENDU MP »).
  const n = ` ${trimmed.toUpperCase()} `
  if (/[\s_-](WEB|SITE)[\s_-]/.test(n)) return '2000x1330'
  if (/[\s_-](MP|MARKETPLACE)[\s_-]/.test(n)) return '2000x2000'
  return null
}

/**
 * Coloris d'une MES déduit de son nom de fichier (« VOGEL_White_300B120… » →
 * BLANC), en matchant les coloris CONNUS de la gamme et leurs synonymes
 * français/anglais. null si rien ne matche — la page produit rattache alors
 * la MES au coloris unique de la taille, ou l'affiche « non rattachée ».
 */
const COLORIS_SYNONYMS: Record<string, string[]> = {
  BLANC: ['BLANC', 'WHITE', 'BLANCHE'],
  GRIS: ['GRIS', 'GREY', 'GRAY', 'GRISE'],
  NOIR: ['NOIR', 'BLACK', 'NOIRE'],
  BEIGE: ['BEIGE'],
  BLEU: ['BLEU', 'BLUE'],
  VERT: ['VERT', 'GREEN'],
  ROUGE: ['ROUGE', 'RED'],
}

export function parseMesColoris(fileName: string, knownColoris: string[]): string | null {
  const n = fileName.toUpperCase()
  for (const coloris of knownColoris) {
    const key = coloris.trim().toUpperCase()
    const tokens = COLORIS_SYNONYMS[key] ?? [key]
    if (tokens.some((t) => n.includes(t))) return coloris
  }
  return null
}

/**
 * Format canonique d'une MES à partir de ses DIMENSIONS (règle Mathias
 * 12/07/2026) : ratio 1:1 = marketplace (2000x2000, 2048x2048…) ;
 * ratio ≈ 2000/1330 = site. Le reste garde ses dimensions brutes (affiché
 * en « non rattachées »).
 */
export function canonicalMesFormat(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'autre'
  }
  if (Math.abs(width - height) / Math.max(width, height) <= 0.02) return '2000x2000'
  const site = 2000 / 1330
  const ratio = width / height
  if (ratio > site * 0.96 && ratio < site * 1.04) return '2000x1330'
  return `${width}x${height}`
}

/**
 * Format d'une MES déduit de son NOM DE FICHIER quand le dossier ne dit rien :
 * « VALIER-300B140_MES-01_WEB_KIT-000814.jpg » → 2000x1330,
 * « …_MP_… » → 2000x2000, « …_2000x1330.jpg » → 2000x1330.
 */
export function parseMesFileFormat(fileName: string): string | null {
  const n = fileName.toUpperCase()
  const dims = n.match(/(\d{3,4})\s*[X×]\s*(\d{3,4})/)
  if (dims) return `${dims[1]}x${dims[2]}`
  if (/[_\-\s]WEB[_\-\s.]/.test(n)) return '2000x1330'
  if (/[_\-\s]MP[_\-\s.]/.test(n)) return '2000x2000'
  return null
}
