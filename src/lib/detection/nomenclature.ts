/**
 * Nomenclature média HOORTRADE (document « NOMENCLATURE MEDIA — GUIDELINE »,
 * transmis par Mathias le 24/07/2026). Format officiel d'un nom de fichier :
 *
 *   GAMME-TAILLE _ IDENTIFICATION-VISUELLE _ DESTINATION _ REF
 *   ex. ARLBERG-100P120_FRONT-OPEN_MP_KIT-000145.jpeg
 *
 * Ce module PUR (importable client et serveur) sait :
 *  - LIRE l'identification visuelle d'un nom (conforme OU ancien nommage) ;
 *  - CONSTRUIRE un mot-clé canonique et un nom de fichier conforme.
 *
 * Le mot-clé appris par la détection est TOUJOURS canonique et SANS numéro :
 * la numérotation (MES-01, ZOOM-02…) est un choix éditorial posé à l'export,
 * pas une propriété visible de l'image.
 */

/** Bases du listing officiel (l'ordre est celui du document). */
export const VISUAL_BASES = [
  'FRONT',
  'BACK',
  'ABOVE',
  'BELOW',
  'LEFT',
  'RIGHT',
  'ZOOM',
  'MATERIAL',
  'ST',
  'IT',
  'MES',
  'CONTENT',
  'NOTICE',
] as const
export type VisualBase = (typeof VISUAL_BASES)[number]

/** Bases acceptant un numéro (ZOOM-01, IT-02, MES-03, CONTENT-01). */
const NUMBERED_BASES: ReadonlySet<VisualBase> = new Set(['ZOOM', 'IT', 'MES', 'CONTENT'])

export interface VisualIdent {
  base: VisualBase
  /** Position ouverte (FRONT-OPEN, BACK-OPEN, BELOW-OPEN). */
  open: boolean
  /** Vue 3/4 (FRONT et BACK uniquement). */
  q3: 'LEFT' | 'RIGHT' | null
  /** Plongée / contre-plongée (FRONT uniquement) : ABOVE = plongée, BELOW = contre-plongée. */
  tilt: 'ABOVE' | 'BELOW' | null
  /** Numéro lu dans le nom (MES-02 → 2), jamais inclus dans le mot-clé canonique. */
  num: number | null
}

/** Étiquette « vue » d'une image écartée à la main (zoom de chantier, planche…). */
export const VUE_AUTRE = 'AUTRE'
/** Étiquette interne app (hors nomenclature) : planches d'ambiance. */
export const VUE_MOODBOARD = 'MOODBOARD'

/**
 * Mot-clé canonique, ordre du document (FRONT-ABOVE-OPEN-3Q-RIGHT) :
 * base, puis plongée, puis OPEN, puis 3/4.
 */
export function canonicalKeyword(ident: Omit<VisualIdent, 'num'>): string {
  let k: string = ident.base
  if (ident.base === 'FRONT' && ident.tilt) k += `-${ident.tilt}`
  if (ident.open) k += '-OPEN'
  if (ident.q3) k += `-3Q-${ident.q3}`
  return k
}

function emptyIdent(base: VisualBase): VisualIdent {
  return { base, open: false, q3: null, tilt: null, num: null }
}

/**
 * Lit un BLOC d'identification visuelle conforme (« FRONT-ABOVE-OPEN-3Q-RIGHT »,
 * « MES-02 », « ST »…). Strict : un jeton inconnu invalide le bloc (c'est le
 * garde-fou qui évite de prendre un bloc gamme ou réf pour une vue).
 */
export function parseVisualBlock(block: string): VisualIdent | null {
  const tokens = block.trim().toUpperCase().split('-').filter(Boolean)
  if (tokens.length === 0) return null
  const base = tokens[0] as VisualBase
  if (!VISUAL_BASES.includes(base)) return null
  const ident = emptyIdent(base)
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]
    if (/^\d+$/.test(t) && NUMBERED_BASES.has(base) && ident.num === null) {
      ident.num = Number(t)
      continue
    }
    if (t === 'OPEN' && (base === 'FRONT' || base === 'BACK' || base === 'BELOW') && !ident.open) {
      ident.open = true
      continue
    }
    if (t === '3Q' && (base === 'FRONT' || base === 'BACK') && ident.q3 === null) {
      const dir = tokens[i + 1]
      if (dir !== 'LEFT' && dir !== 'RIGHT') return null
      ident.q3 = dir
      i++
      continue
    }
    if ((t === 'ABOVE' || t === 'BELOW') && base === 'FRONT' && ident.tilt === null) {
      ident.tilt = t
      continue
    }
    return null
  }
  return ident
}

/**
 * Lit l'identification visuelle d'un NOM DE FICHIER.
 *  - Nom conforme (blocs séparés par « _ ») : le 2ᵉ bloc est la vue — sauf pour
 *    les packs (PAC-nnnn_MP) qui n'en ont pas.
 *  - Ancien nommage : recherche tolérante des mots-clés dans le nom
 *    (« VOGEL-300-FRONT.jpg », « NALI 350 BACK OPEN.png »…).
 * Retourne aussi `conforming` : le nom suit-il déjà la nomenclature ?
 */
export function parseVisualFromFileName(
  fileName: string
): { ident: VisualIdent; conforming: boolean } | null {
  const stem = fileName.replace(/\.[a-z0-9]+$/i, '')
  const blocks = stem.split('_').map((b) => b.trim()).filter(Boolean)
  if (blocks.length >= 2) {
    const ident = parseVisualBlock(blocks[1])
    if (ident) return { ident, conforming: true }
  }

  // Ancien nommage : jetons alphanumériques, « 3-4 » ⇒ 3Q.
  const norm = stem.toUpperCase().replace(/3\s*[-/]\s*4/g, '3Q')
  const tokens = norm.split(/[^A-Z0-9]+/).filter(Boolean)
  const has = (t: string) => tokens.includes(t)

  // Jetons courts (ST, IT…) trop risqués en ancien nommage : jamais déduits là.
  let base: VisualBase | null = null
  if (has('FRONT')) base = 'FRONT'
  else if (has('BACK')) base = 'BACK'
  else if (has('MES')) base = 'MES'
  else if (has('ZOOM')) base = 'ZOOM'
  else if (has('MATERIAL')) base = 'MATERIAL'
  else if (has('NOTICE')) base = 'NOTICE'
  if (!base) return null

  const ident = emptyIdent(base)
  if (base === 'FRONT' || base === 'BACK') {
    if (has('OPEN')) ident.open = true
    const left = has('LEFT')
    const right = has('RIGHT')
    if (left !== right) ident.q3 = left ? 'LEFT' : 'RIGHT'
    else if (has('3Q')) return null // 3/4 sans direction lisible : on ne devine pas
    if (base === 'FRONT') {
      if (has('ABOVE')) ident.tilt = 'ABOVE'
      else if (has('BELOW')) ident.tilt = 'BELOW'
    }
  }
  return { ident, conforming: false }
}

/** Libellés français du listing (atelier + fiches), dans l'ordre du document. */
export const VISUAL_LABELS: ReadonlyArray<{ keyword: string; label: string }> = [
  { keyword: 'FRONT', label: 'Face' },
  { keyword: 'FRONT-3Q-RIGHT', label: 'Face 3/4 droite' },
  { keyword: 'FRONT-3Q-LEFT', label: 'Face 3/4 gauche' },
  { keyword: 'FRONT-OPEN', label: 'Face ouverte' },
  { keyword: 'FRONT-BELOW', label: 'Face contre-plongée' },
  { keyword: 'FRONT-ABOVE', label: 'Face plongée' },
  { keyword: 'BACK', label: 'Dos' },
  { keyword: 'BACK-OPEN', label: 'Dos ouvert' },
  { keyword: 'ABOVE', label: 'Dessus' },
  { keyword: 'BELOW', label: 'Dessous' },
  { keyword: 'LEFT', label: 'Profil gauche' },
  { keyword: 'RIGHT', label: 'Profil droit' },
  { keyword: 'ZOOM', label: 'Zoom détail' },
  { keyword: 'MATERIAL', label: 'Matière' },
  { keyword: 'ST', label: 'Schéma technique' },
  { keyword: 'IT', label: 'Image technique' },
  { keyword: 'MES', label: 'MES' },
  { keyword: 'CONTENT', label: 'Contenu A+' },
  { keyword: 'NOTICE', label: 'Notice' },
  { keyword: VUE_MOODBOARD, label: 'Moodboard' },
  { keyword: VUE_AUTRE, label: 'Autre / inutilisable' },
]

/** Libellé français d'un mot-clé (les combinaisons rares se lisent telles quelles). */
export function labelForKeyword(keyword: string): string {
  return VISUAL_LABELS.find((v) => v.keyword === keyword)?.label ?? keyword
}

/**
 * Jeton taille du bloc produit (« 300B140 » vu sur le serveur, « 100P120 » dans
 * le document). Lettre du milieu = famille — convention DÉDUITE des exemples
 * (B ↔ battant sur le serveur, P ↔ ARLBERG portillon dans le document), à faire
 * confirmer avant tout export massif.
 */
export function sizeToken(w: number, h: number, family: string): string {
  const f = family.toUpperCase()
  const letter = f.includes('COULISSANT') ? 'C' : f.includes('PORTILLON') ? 'P' : 'B'
  return `${w}${letter}${h}`
}

/** Destination déduite des dimensions : site 2000×1330, marketplace carré. */
export function destFromDims(w: number, h: number): 'WEB' | 'MP' | null {
  if (!w || !h) return null
  const r = w / h
  if (Math.abs(r - 2000 / 1330) < 0.05) return 'WEB'
  if (Math.abs(r - 1) < 0.03) return 'MP'
  return null
}

export const REF_PLACEHOLDER = 'KIT-??????'

/**
 * Nom de fichier conforme. `num` est ajouté au mot-clé pour les bases
 * numérotées (MES → MES-01). `ref` absente ⇒ marqueur « à compléter » (on
 * n'invente JAMAIS une réf).
 */
export function buildFileName(input: {
  gamme: string
  sizeToken: string
  keyword: string
  num?: number | null
  dest: string
  ref?: string | null
  ext?: string
}): string {
  const gamme = input.gamme.trim().toUpperCase().replace(/\s+/g, '-')
  const base = input.keyword.split('-')[0] as VisualBase
  const num =
    input.num && NUMBERED_BASES.has(base) ? `-${String(input.num).padStart(2, '0')}` : ''
  const ref = input.ref?.trim() ? input.ref.trim().toUpperCase() : REF_PLACEHOLDER
  return `${gamme}-${input.sizeToken}_${input.keyword}${num}_${input.dest}_${ref}.${input.ext ?? 'jpeg'}`
}
