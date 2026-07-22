import sharp from 'sharp'

/**
 * Outils d'analyse pour la calibration : détection des lignes du CANNY et des
 * bords horizontaux (trottoir) dans les images générées. Tout travaille en
 * coordonnées normalisées (0..1) pour comparer des images de tailles différentes.
 */

const ANALYSIS_WIDTH = 512

interface RawGrey {
  data: Buffer
  width: number
  height: number
}

async function toGreyRaw(input: Buffer | string): Promise<RawGrey> {
  const { data, info } = await sharp(input)
    .greyscale()
    .resize({ width: ANALYSIS_WIDTH })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

export interface LineBand {
  /** Centre de la bande, normalisé 0..1 (0 = haut de l'image) */
  yNorm: number
  /** Épaisseur en lignes d'analyse */
  thickness: number
}

/**
 * Détecte les bandes de lignes blanches d'un CANNY (contours blancs sur fond noir).
 * Retourne les bandes du haut vers le bas. Analyse à pleine résolution : les traits
 * de 1-2 px disparaîtraient dans un rétrécissement.
 */
export async function whiteLineBands(
  input: Buffer | string,
  opts: { luminanceThreshold?: number; minRowFraction?: number } = {}
): Promise<LineBand[]> {
  const { luminanceThreshold = 100, minRowFraction = 0.04 } = opts
  const { data, info } = await sharp(input).greyscale().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info

  const isLineRow: boolean[] = []
  for (let y = 0; y < height; y++) {
    let count = 0
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] > luminanceThreshold) count++
    }
    isLineRow.push(count / width >= minRowFraction)
  }

  const bands: LineBand[] = []
  let start = -1
  for (let y = 0; y <= height; y++) {
    const on = y < height && isLineRow[y]
    if (on && start === -1) start = y
    if (!on && start !== -1) {
      const end = y - 1
      bands.push({ yNorm: (start + end) / 2 / height, thickness: end - start + 1 })
      start = -1
    }
  }
  return bands
}

/**
 * Profil d'énergie de bord horizontal : pour chaque ligne, moyenne du gradient
 * vertical absolu. Les frontières nettes (bord de trottoir, bord de route)
 * ressortent comme des pics.
 */
export async function horizontalEdgeProfile(input: Buffer | string): Promise<number[]> {
  const { data, width, height } = await toGreyRaw(input)
  const profile: number[] = new Array(height).fill(0)
  for (let y = 0; y < height - 1; y++) {
    let sum = 0
    for (let x = 0; x < width; x++) {
      sum += Math.abs(data[(y + 1) * width + x] - data[y * width + x])
    }
    profile[y] = sum / width
  }
  return profile
}

/**
 * Trouve le pic de bord le plus fort autour d'une position attendue (fenêtre ± window).
 * Retourne la position normalisée du pic, ou null si aucun signal net.
 */
export function strongestEdgeNear(
  profile: number[],
  expectedYNorm: number,
  windowNorm = 0.08
): { yNorm: number; strength: number } | null {
  const h = profile.length
  const from = Math.max(0, Math.floor((expectedYNorm - windowNorm) * h))
  const to = Math.min(h - 1, Math.ceil((expectedYNorm + windowNorm) * h))
  let bestY = -1
  let bestV = -Infinity
  for (let y = from; y <= to; y++) {
    if (profile[y] > bestV) {
      bestV = profile[y]
      bestY = y
    }
  }
  if (bestY === -1) return null
  const mean = profile.reduce((a, b) => a + b, 0) / h
  if (bestV < mean * 1.5) return null // pas de pic net dans la fenêtre
  return { yNorm: bestY / h, strength: bestV }
}

/**
 * Bords intérieurs RÉELS des piliers rendus à l'étape Piliers. Le modèle peut rendre
 * le pilier stucco quelques centimètres plus large ou plus étroit que l'aplat
 * théorique (dans la marge du masque) : on cherche donc, dans une petite fenêtre
 * autour de la position théorique, la colonne au bord vertical le plus net —
 * l'énergie de gradient horizontal cumulée sur toute la hauteur du portail
 * (même principe que le « code-barres » du trottoir, à la verticale).
 * Retourne les x absolus (px) des bords intérieurs, ou null si aucun bord net.
 */
export async function measureInnerPillarEdges(
  composite: Buffer | string,
  zone: { x: number; y: number; w: number; h: number },
  maxAdjustPx = 48
): Promise<{ left: number | null; right: number | null }> {
  const { data, info } = await sharp(composite)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  const y0 = Math.max(1, Math.round(zone.y + zone.h * 0.1))
  const y1 = Math.min(H - 2, Math.round(zone.y + zone.h * 0.9))

  const energy = (x: number) => {
    let sum = 0
    for (let y = y0; y <= y1; y++) {
      sum += Math.abs(data[y * W + (x + 1)] - data[y * W + (x - 1)])
    }
    return sum
  }
  const findEdge = (center: number): number | null => {
    const from = Math.max(1, center - maxAdjustPx)
    const to = Math.min(W - 2, center + maxAdjustPx)
    let bestX = -1
    let bestV = -Infinity
    let total = 0
    for (let x = from; x <= to; x++) {
      const e = energy(x)
      total += e
      if (e > bestV) {
        bestV = e
        bestX = x
      }
    }
    const mean = total / (to - from + 1)
    // Bord net exigé : nettement au-dessus de la texture ambiante (relatif) ET
    // au-dessus du bruit (absolu : gradient moyen ≥ 2 par ligne balayée).
    if (bestX === -1 || bestV < mean * 1.8 || bestV < (y1 - y0 + 1) * 2) return null
    return bestX
  }

  return { left: findEdge(zone.x), right: findEdge(zone.x + zone.w) }
}

/**
 * Fraction de pixels « végétation » (dominante verte) dans une zone rectangulaire.
 * Sert au contrôle qualité du couloir d'allée : de l'herbe entre les futurs piliers
 * signale un décor à régénérer avant d'y poser quoi que ce soit.
 */
export async function greenFraction(
  input: Buffer | string,
  rect: { x: number; y: number; w: number; h: number },
  opts: {
    /**
     * Largeur relative de la zone en HAUT du rectangle (perspective : un couloir de
     * largeur constante au sol rétrécit vers l'horizon). 1 = rectangle plein.
     */
    topWidthFactor?: number
  } = {}
): Promise<number> {
  const topWidthFactor = opts.topWidthFactor ?? 1
  const { data, info } = await sharp(input).raw().toBuffer({ resolveWithObject: true })
  const ch = info.channels
  const y0 = Math.max(0, rect.y)
  const y1 = Math.min(info.height - 1, rect.y + rect.h - 1)
  const cx = rect.x + rect.w / 2
  let green = 0
  let total = 0
  for (let y = y0; y <= y1; y++) {
    const t = y1 === y0 ? 1 : (y - y0) / (y1 - y0) // 0 en haut → 1 en bas
    const halfW = (rect.w / 2) * (topWidthFactor + (1 - topWidthFactor) * t)
    const x0 = Math.max(0, Math.round(cx - halfW))
    const x1 = Math.min(info.width - 1, Math.round(cx + halfW))
    for (let x = x0; x <= x1; x++) {
      const o = (y * info.width + x) * ch
      total++
      if (isVegetation(data[o], data[o + 1], data[o + 2])) green++
    }
  }
  return total === 0 ? 0 : green / total
}

/**
 * Pixel « végétation » : vert nettement au-dessus du bleu, et au moins au niveau du
 * rouge. (L'herbe ensoleillée est jaune-vert : r ≈ g — un critère « g > r + 12 »
 * la rate presque entièrement, mesuré sur décors réels.)
 */
export function isVegetation(r: number, g: number, b: number): boolean {
  return g > b + 18 && g + 5 >= r
}

/**
 * Mesure de référence de l'herbe dans le couloir d'allée : bande BASSE du couloir
 * (60 % près de la ligne du portail — la pelouse en fond de perspective est légitime),
 * en trapèze de perspective. C'est CETTE mesure qui décide de la réparation.
 */
export async function corridorVegetationFraction(
  input: Buffer | string,
  corridor: { x1Px: number; x2Px: number; yTopPx: number; yBottomPx: number }
): Promise<number> {
  const bandH = corridor.yBottomPx - corridor.yTopPx
  const y = Math.round(corridor.yTopPx + bandH * 0.4)
  // Cohérent avec le trapèze pleine bande (0,6 en haut → 1 en bas) : à 40 % de
  // profondeur, la largeur vaut 0,6 + 0,4 × 0,4 = 0,76 de la pleine largeur.
  return greenFraction(
    input,
    { x: corridor.x1Px, y, w: corridor.x2Px - corridor.x1Px, h: corridor.yBottomPx - y },
    { topWidthFactor: 0.76 }
  )
}

/** Facteur de perspective standard du couloir d'allée (mesuré sur décors réels). */
export const CORRIDOR_TOP_WIDTH_FACTOR = 0.6

/**
 * Décalage vertical du trottoir par corrélation du MOTIF complet des bandes du CANNY
 * (bord supérieur + lignes de bordure) avec le profil de bords de l'image générée.
 * Bien plus robuste qu'un pic isolé : un seul bord peut être faiblement contrasté
 * (pavés clairs → béton clair), mais le motif des 3 bandes à espacement fixe est unique.
 * Retourne le décalage normalisé (positif = trottoir plus bas que prévu), ou null.
 */
export function bandPatternShift(
  profile: number[],
  bandsYNorm: number[],
  // ±5 % de la hauteur : la dérive réelle d'un décor au format natif est de
  // quelques px à ±20 px livraison (mesures du 08/07). Une fenêtre de ±10 %
  // laissait la corrélation s'accrocher à d'autres lignes de la scène — bug du
  // 11/07 : sur un décor v4, bordures de jardin + frontière allée/trottoir ont
  // « mieux scoré » à −10 % que le vrai trottoir → piliers posés en pleine allée.
  windowNorm = 0.05
): { shiftNorm: number; score: number } | null {
  if (bandsYNorm.length === 0) return null
  const h = profile.length
  const window = Math.round(windowNorm * h)

  // Le trottoir est TOUJOURS dans le bas de l'image (c'est le plan de base du
  // CANNY — décision Mathias 11/07/2026) : la référence de bruit se calcule sur
  // la moitié inférieure uniquement, pour que végétation/façade du haut ne
  // gonflent pas le seuil et ne fassent pas échouer la mesure à tort.
  const lower = profile.slice(Math.floor(h / 2))
  const noiseMean = lower.reduce((a, b) => a + b, 0) / Math.max(1, lower.length)
  if (noiseMean <= 0) return null

  // Valeur d'une bande : le pic au centre, ou un voisin à ±1 ligne légèrement
  // décoté (tolérance au jitter d'arrondi, sans créer d'ex æquo en plateau).
  const bandValue = (y: number): number => {
    const at = (i: number) => (i >= 0 && i < h ? profile[i] : 0)
    return Math.max(at(y), 0.9 * Math.max(at(y - 1), at(y + 1)))
  }

  let bestShift: number | null = null
  let bestScore = -Infinity
  for (let s = -window; s <= window; s++) {
    let score = 0
    let ok = true
    for (const b of bandsYNorm) {
      const y = Math.round(b * h) + s
      if (y < 0 || y >= h) {
        ok = false
        break
      }
      const v = bandValue(y)
      // CHAQUE bande doit répondre nettement : un unique pic parasite dans la
      // fenêtre ne peut plus porter le score à lui seul (leçon du 11/07).
      if (v < noiseMean * 1.1) {
        ok = false
        break
      }
      score += v
    }
    if (!ok) continue
    // Ex æquo : préférer le plus petit décalage — le CANNY ancre déjà la position.
    if (
      score > bestScore ||
      (score === bestScore && bestShift !== null && Math.abs(s) < Math.abs(bestShift))
    ) {
      bestScore = score
      bestShift = s
    }
  }
  if (bestShift === null) return null
  if (bestScore < noiseMean * bandsYNorm.length * 1.3) return null // motif non retrouvé
  // Meilleur score collé à la borne de recherche : le vrai décalage est
  // probablement HORS plage → mieux vaut « non mesuré » qu'un chiffre faux.
  if (Math.abs(bestShift) === window) return null
  return { shiftNorm: bestShift / h, score: bestScore }
}

/**
 * Décalage vertical calé sur la BANDE D'ANCRAGE (la première = bord haut du
 * trottoir, celle où pose la ligne de sol des gabarits), les bandes suivantes
 * ne servant que de contrôle de cohérence avec une tolérance.
 *
 * Pourquoi (1re gamme XL, 22/07/2026, jobs #136-148) : le décor généré peut
 * dessiner un trottoir un peu plus FIN que le CANNY de référence — bord haut
 * descendu, bordure route en place. Le motif étant déformé, aucun décalage ne
 * fait répondre les 3 bandes ensemble : `bandPatternShift` choisit alors le
 * compromis qui colle aux bords les plus contrastés (la bordure route) et pose
 * les piliers EN L'AIR, ~75 px au-dessus du trottoir.
 *
 * Garde-fous conservés de la leçon du 11/07 (piliers en pleine allée) :
 * l'ancrage exige un bord NET (1,5 × bruit, comme `strongestEdgeNear`), chaque
 * bande basse doit répondre près de sa position attendue (± tolérance), et un
 * calage collé à la borne de recherche est rejeté. Retourne null si le bord
 * d'ancrage est introuvable — le repli « position du CANNY » reste le plan de base.
 */
export function groundBandShift(
  profile: number[],
  bandsYNorm: number[],
  windowNorm = 0.05,
  // ±2 % de la hauteur : la déformation mesurée le 22/07 (bord haut décalé de
  // 1,6 % pendant que la bordure ne bouge pas) tient dans cette tolérance.
  toleranceNorm = 0.02
): { shiftNorm: number; score: number } | null {
  if (bandsYNorm.length === 0) return null
  const bands = [...bandsYNorm].sort((a, b) => a - b)
  const anchor = bands[0]
  const others = bands.slice(1)
  const h = profile.length
  const window = Math.round(windowNorm * h)
  const tolerance = Math.round(toleranceNorm * h)

  // Même référence de bruit que bandPatternShift : moitié inférieure uniquement.
  const lower = profile.slice(Math.floor(h / 2))
  const noiseMean = lower.reduce((a, b) => a + b, 0) / Math.max(1, lower.length)
  if (noiseMean <= 0) return null

  const at = (i: number) => (i >= 0 && i < h ? profile[i] : 0)
  const bandValue = (y: number): number => Math.max(at(y), 0.9 * Math.max(at(y - 1), at(y + 1)))

  let bestShift: number | null = null
  let bestScore = -Infinity
  for (let s = -window; s <= window; s++) {
    const anchorY = Math.round(anchor * h) + s
    if (anchorY < 0 || anchorY >= h) continue
    const anchorV = bandValue(anchorY)
    if (anchorV < noiseMean * 1.5) continue // pas de bord net à l'ancrage
    // Cohérence : chaque bande basse doit répondre PRÈS de sa position attendue.
    let ok = true
    for (const b of others) {
      const center = Math.round(b * h) + s
      let found = false
      for (let t = -tolerance; t <= tolerance && !found; t++) {
        if (bandValue(center + t) >= noiseMean * 1.1) found = true
      }
      if (!found) {
        ok = false
        break
      }
    }
    if (!ok) continue
    // Le score est la force du bord d'ancrage : c'est LUI qu'on cale.
    // Ex æquo : préférer le plus petit décalage, comme bandPatternShift.
    if (
      anchorV > bestScore ||
      (anchorV === bestScore && bestShift !== null && Math.abs(s) < Math.abs(bestShift))
    ) {
      bestScore = anchorV
      bestShift = s
    }
  }
  if (bestShift === null) return null
  // Calage collé à la borne : le vrai décalage est probablement hors plage.
  if (Math.abs(bestShift) === window) return null
  return { shiftNorm: bestShift / h, score: bestScore }
}
