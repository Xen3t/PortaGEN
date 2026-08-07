/**
 * Géométrie des gabarits MES Contraintes — issue du mockup historique
 * (Assets/mockup-gabarits.html), avec une évolution décidée le 11/07/2026 :
 * les hauteurs de pilier et de muret sont découplées. Chacune se règle pour la
 * plus petite et la plus grande taille de la gamme, les tailles intermédiaires
 * étant interpolées linéairement entre les deux (l'outil de réglage visuel est
 * la page Admin → Gabarits). Toutes les valeurs d'entrée sont en centimètres ;
 * la projection vers les pixels se fait en toute fin via projection()/projectRect().
 */

export type CapStyle = 'none' | 'flat' | 'gendarme'
export type ProjectionMode = 'stretch' | 'uniform'

export interface SizeCm {
  w: number
  h: number
}

export interface GabaritParams {
  /** Largeur d'un pilier (cm) */
  pillarWidth: number
  /** Hauteur du pilier (cm) pour la plus petite hauteur de portail de la gamme */
  pillarHMin: number
  /** Hauteur du pilier (cm) pour la plus grande hauteur de portail de la gamme */
  pillarHMax: number
  capStyle: CapStyle
  muretEnabled: boolean
  /** Hauteur du muret (cm) pour la plus petite hauteur de portail de la gamme */
  muretHMin: number
  /** Hauteur du muret (cm) pour la plus grande hauteur de portail de la gamme */
  muretHMax: number
  /** Bornes de hauteur de portail (cm) entre lesquelles pilier et muret sont interpolés */
  gateHMin: number
  gateHMax: number
  /** Dérogation par taille : hauteur de pilier imposée (cm), court-circuite l'interpolation */
  pillarH?: number
  /** Dérogation par taille : hauteur de muret imposée (cm), court-circuite l'interpolation */
  muretH?: number
  /**
   * Largeur de référence (cm) imposée pour TOUTE la géométrie horizontale
   * (centrage, écartement des piliers, ouverture, murets), à la place de la
   * largeur réelle de la taille. Découple le gabarit de la largeur : toutes les
   * largeurs d'une même hauteur partagent alors un gabarit identique — décision
   * Mathias 04/08/2026 (« la plus grande largeur de la gamme »). Absente ou ≤ 0 =
   * largeur réelle de la taille (comportement historique, non-régression).
   */
  refWidth?: number
  /** Hauteur de sol visible sous la ligne de sol (cm) */
  groundY: number
  /** Hauteur de la scène (cm) — pilote la proportion du portail à l'écran */
  sceneH: number
  /**
   * Zoom caméra en POURCENTAGE (option gabarits 07/08/2026, demande Mathias
   * pour les portillons) : 100 = neutre, 200 = caméra deux fois plus proche —
   * la scène (sceneH + groundY) est réduite d'autant, tout paraît plus gros,
   * les proportions internes ne bougent pas.
   */
  zoom: number
  /** Décalage horizontal du portail (cm) */
  offsetX: number
  /**
   * Décalage VERTICAL de la ligne de sol (cm, option gabarits 07/08/2026 avec
   * le zoom) : positif = tout descend (portail, piliers, murets, bandes de
   * sol), négatif = tout monte. 0 = historique.
   */
  offsetY: number
  /** Ratio largeur/hauteur du format MES — la largeur de scène en découle */
  mesAspect: number
}

// Défauts choisis pour reproduire le rendu historique (pilier = portail + 22 cm,
// muret = 70 % du pilier) aux deux extrémités de la gamme battants (100 → 200 cm).
export const DEFAULT_PARAMS: GabaritParams = {
  pillarWidth: 30,
  pillarHMin: 122,
  pillarHMax: 222,
  capStyle: 'flat',
  muretEnabled: true,
  muretHMin: 85,
  muretHMax: 155,
  gateHMin: 100,
  gateHMax: 200,
  groundY: 74,
  sceneH: 320,
  zoom: 100,
  offsetX: 0,
  offsetY: 0,
  mesAspect: 2000 / 1330,
}

/**
 * 2ᵉ gabarit du coulissant (04/08/2026) : le pilier droit peint PAR-DESSUS le
 * rendu fini pour passer devant la lame et en cacher le bout. Placé librement
 * (largeur/hauteur/décalage/recouvrement), indépendamment du gabarit général —
 * à l'étape 1 il n'existe pas (le muret file jusqu'au bord). Réglé dans
 * Admin → Réglages → Gabarits (coulissant), consommé par coulissant2etapes.
 */
export interface PilierDroitParams {
  /** Largeur du pilier droit (cm) */
  largeur: number
  /** Décalage horizontal (cm) depuis le bord droit de l'ouverture */
  decalage: number
}

// Seuls largeur et décalage se règlent. La HAUTEUR suit toujours le pilier
// gauche (deux piliers identiques). Le RECOUVREMENT de la lame derrière le
// pilier n'est PAS un réglage : c'est une marge technique fixe côté pipeline
// (la lame est intégrée à l'étape 1, on n'y touche pas depuis la phase 2 ;
// le décalage du pilier suffit à choisir ce qu'il cache).
export const DEFAULT_PILIER_DROIT: PilierDroitParams = {
  largeur: 40,
  decalage: 0,
}

/**
 * Hauteurs effectives pilier/muret (cm) pour une hauteur de portail donnée :
 * interpolation linéaire entre la valeur réglée pour la plus petite taille de la
 * gamme et celle réglée pour la plus grande (bornée aux extrémités). Une hauteur
 * imposée (pillarH/muretH, dérogation par taille) court-circuite l'interpolation.
 */
export function effectiveHeights(
  gateH: number,
  params: Partial<GabaritParams> = {}
): { pillarH: number; muretH: number } {
  const eff: GabaritParams = { ...DEFAULT_PARAMS, ...params }
  const span = eff.gateHMax - eff.gateHMin
  const t = span > 0 ? Math.min(1, Math.max(0, (gateH - eff.gateHMin) / span)) : 0
  return {
    pillarH: eff.pillarH ?? eff.pillarHMin + t * (eff.pillarHMax - eff.pillarHMin),
    muretH: eff.muretH ?? eff.muretHMin + t * (eff.muretHMax - eff.muretHMin),
  }
}

// Chapeaux : dimensions fixes en cm, indépendantes des autres paramètres.
export const CAP_FLAT_H = 8
export const CAP_FLAT_OVERHANG = 4
export const CAP_GENDARME_H = 18
export const CAP_GENDARME_OVERHANG = 4
export const CAP_GENDARME_STRAIGHT_FRAC = 0.22

// Sous ce seuil (cm), un débordement hors cadre est jugé anecdotique — uniquement pour les portails 4 m.
export const CLAMP_TOLERANCE_CM = 5

// Chevauchement muret/pilier pour éviter les gaps sub-pixel à la rasterisation.
const MURET_OVERLAP_CM = 1

export interface RectCm {
  x: number
  y: number
  w: number
  h: number
}

export interface ClampedRect extends RectCm {
  clamped: boolean
  lossX: number
  lossY: number
}

export interface Cap {
  style: Exclude<CapStyle, 'none'>
  bbox: ClampedRect
}

export interface Layout {
  sceneW: number
  sceneH: number
  groundLine: number
  gateLeft: number
  gateW: number
  gateH: number
  gateTop: number
  pillarLeft: ClampedRect
  pillarRight: ClampedRect
  capLeft: Cap | null
  capRight: Cap | null
  muretLeft: ClampedRect | null
  muretRight: ClampedRect | null
  isClamped: boolean
}

/** Clampe un rect au cadre [0..sceneW]×[0..sceneH] ; loss = cm perdus par axe. */
export function clampRect(r: RectCm, sceneW: number, sceneH: number): ClampedRect {
  const x0 = Math.max(0, r.x)
  const y0 = Math.max(0, r.y)
  const x1 = Math.min(sceneW, r.x + r.w)
  const y1 = Math.min(sceneH, r.y + r.h)
  const clamped = x0 !== r.x || y0 !== r.y || x1 !== r.x + r.w || y1 !== r.y + r.h
  const lossX = (r.x < 0 ? -r.x : 0) + (r.x + r.w > sceneW ? r.x + r.w - sceneW : 0)
  const lossY = (r.y < 0 ? -r.y : 0) + (r.y + r.h > sceneH ? r.y + r.h - sceneH : 0)
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0), clamped, lossX, lossY }
}

export function computeCap(
  style: CapStyle,
  pillarX: number,
  pillarTop: number,
  pillarW: number,
  sceneW: number,
  sceneH: number
): Cap | null {
  if (style !== 'flat' && style !== 'gendarme') return null
  const h = style === 'flat' ? CAP_FLAT_H : CAP_GENDARME_H
  const overhang = style === 'flat' ? CAP_FLAT_OVERHANG : CAP_GENDARME_OVERHANG
  const bbox = clampRect(
    { x: pillarX - overhang, y: pillarTop - h, w: pillarW + 2 * overhang, h },
    sceneW,
    sceneH
  )
  return { style, bbox }
}

/**
 * Calcule tous les rects (en cm) d'une taille de portail : piliers, chapeaux, murets,
 * zone portail. Source de vérité unique, consommée par le rendu des aplats ET l'export metadata.
 */
export function computeLayout(size: SizeCm, params: Partial<GabaritParams> = {}): Layout {
  const eff: GabaritParams = { ...DEFAULT_PARAMS, ...params }
  // Zoom caméra (07/08/2026) : réduire la scène de z grossit tout d'autant —
  // sceneH ET groundY suivent (proportions du cadre inchangées). 100 = neutre.
  const z = eff.zoom > 0 ? eff.zoom / 100 : 1
  const sceneH = eff.sceneH / z
  const sceneW = Math.round(sceneH * eff.mesAspect)
  // Décalage Y (07/08) : la ligne de sol porte tout — la déplacer déplace
  // portail, piliers, murets et bandes de sol d'un bloc.
  const groundLine = sceneH - eff.groundY / z + eff.offsetY

  // Hauteurs découplées : pilier et muret interpolés chacun entre leurs réglages
  // petite/grande taille (voir effectiveHeights).
  const { pillarH, muretH } = effectiveHeights(size.h, eff)

  // Découplage largeur/hauteur (04/08/2026) : toute la géométrie horizontale
  // s'appuie sur la largeur de référence (refWidth = plus grande largeur de la
  // gamme) plutôt que sur la largeur réelle — un 300 et un 400 de même hauteur
  // ont ainsi EXACTEMENT le même gabarit. Absente/≤ 0 : largeur réelle (histo).
  const gateWidth = eff.refWidth && eff.refWidth > 0 ? eff.refWidth : size.w

  const gateLeft = (sceneW - gateWidth) / 2 + eff.offsetX
  const lpX = gateLeft - eff.pillarWidth
  const rpX = gateLeft + gateWidth
  const pTop = groundLine - pillarH

  const pillarLeft = clampRect({ x: lpX, y: pTop, w: eff.pillarWidth, h: pillarH }, sceneW, sceneH)
  const pillarRight = clampRect({ x: rpX, y: pTop, w: eff.pillarWidth, h: pillarH }, sceneW, sceneH)

  const capLeft = computeCap(eff.capStyle, lpX, pTop, eff.pillarWidth, sceneW, sceneH)
  const capRight = computeCap(eff.capStyle, rpX, pTop, eff.pillarWidth, sceneW, sceneH)

  let muretLeft: ClampedRect | null = null
  let muretRight: ClampedRect | null = null
  if (eff.muretEnabled) {
    const muretTop = groundLine - muretH
    const leftW = lpX
    const rightL = rpX + eff.pillarWidth
    const rightW = sceneW - rightL
    if (leftW > 0) {
      muretLeft = clampRect(
        { x: 0, y: muretTop, w: leftW + MURET_OVERLAP_CM, h: muretH },
        sceneW,
        sceneH
      )
    }
    if (rightW > 0) {
      muretRight = clampRect(
        { x: rightL - MURET_OVERLAP_CM, y: muretTop, w: rightW + MURET_OVERLAP_CM, h: muretH },
        sceneW,
        sceneH
      )
    }
  }

  // Tolérance de débordement appliquée uniquement aux portails 4 m (comportement assumé du mockup).
  const tolerance = gateWidth === 400 ? CLAMP_TOLERANCE_CM : 0
  const losses = [pillarLeft, pillarRight, capLeft?.bbox, capRight?.bbox, muretLeft, muretRight]
    .filter((r): r is ClampedRect => Boolean(r))
    .map((r) => Math.max(r.lossX, r.lossY))
  const isClamped = losses.some((l) => l > tolerance)

  return {
    sceneW,
    sceneH,
    groundLine,
    gateLeft,
    gateW: gateWidth,
    gateH: size.h,
    gateTop: groundLine - size.h,
    pillarLeft,
    pillarRight,
    capLeft,
    capRight,
    muretLeft,
    muretRight,
    isClamped,
  }
}

/**
 * Rect (cm) du pilier droit du coulissant (2ᵉ gabarit), posé depuis le bord
 * droit de l'ouverture (+ décalage). La HAUTEUR est celle du pilier GAUCHE
 * (gabarit général) : les deux piliers d'un coulissant sont identiques — seuls
 * largeur et décalage se règlent. Source UNIQUE partagée par le pipeline
 * (coulissant2etapes) et l'aperçu Réglages (GabaritPreview).
 */
export function pilierDroitRectCm(layout: Layout, pd: PilierDroitParams): RectCm {
  return {
    x: layout.gateLeft + layout.gateW + pd.decalage,
    y: layout.pillarLeft.y,
    w: pd.largeur,
    h: layout.pillarLeft.h,
  }
}

export interface Projection {
  sx: number
  sy: number
  ox: number
  oy: number
}

/** Échelle cm→px. 'stretch' remplit le cadre ; 'uniform' préserve le ratio, sol ancré en bas. */
export function projection(
  mesW: number,
  mesH: number,
  sceneW: number,
  sceneH: number,
  mode: ProjectionMode = 'stretch'
): Projection {
  if (mode === 'uniform') {
    const s = Math.min(mesW / sceneW, mesH / sceneH)
    return { sx: s, sy: s, ox: (mesW - sceneW * s) / 2, oy: mesH - sceneH * s }
  }
  return { sx: mesW / sceneW, sy: mesH / sceneH, ox: 0, oy: 0 }
}

export interface RectPx {
  x: number
  y: number
  w: number
  h: number
  clamped: boolean
}

export function projectRect(r: ClampedRect | RectCm, p: Projection): RectPx {
  return {
    x: Math.round(r.x * p.sx + p.ox),
    y: Math.round(r.y * p.sy + p.oy),
    w: Math.round(r.w * p.sx),
    h: Math.round(r.h * p.sy),
    clamped: 'clamped' in r ? r.clamped : false,
  }
}

export interface CapPx {
  style: Exclude<CapStyle, 'none'>
  x: number
  y: number
  w: number
  h: number
  clamped: boolean
}

export interface SizeMetadata {
  size: string
  sceneW: number
  sceneH: number
  scaleX: number
  scaleY: number
  elements: {
    portal: RectPx
    pillarLeft: RectPx
    pillarRight: RectPx
    capLeft: CapPx | null
    capRight: CapPx | null
    muretLeft: RectPx | null
    muretRight: RectPx | null
  }
}

/** Équivalent du metadata.json exporté par le mockup, pour une taille donnée. */
export function sizeMetadata(
  size: SizeCm,
  params: Partial<GabaritParams>,
  mesW: number,
  mesH: number,
  mode: ProjectionMode = 'stretch'
): SizeMetadata {
  const layout = computeLayout(size, params)
  const p = projection(mesW, mesH, layout.sceneW, layout.sceneH, mode)
  const capInfo = (cap: Cap | null): CapPx | null => {
    if (!cap) return null
    const b = projectRect(cap.bbox, p)
    return { style: cap.style, ...b }
  }
  return {
    size: `${size.w}x${size.h}`,
    sceneW: layout.sceneW,
    sceneH: layout.sceneH,
    scaleX: p.sx,
    scaleY: p.sy,
    elements: {
      portal: projectRect(
        { x: layout.gateLeft, y: layout.gateTop, w: layout.gateW, h: layout.gateH },
        p
      ),
      pillarLeft: projectRect(layout.pillarLeft, p),
      pillarRight: projectRect(layout.pillarRight, p),
      capLeft: capInfo(layout.capLeft),
      capRight: capInfo(layout.capRight),
      muretLeft: layout.muretLeft ? projectRect(layout.muretLeft, p) : null,
      muretRight: layout.muretRight ? projectRect(layout.muretRight, p) : null,
    },
  }
}

/**
 * Path SVG d'un chapeau gendarme (base droite + dôme en arc elliptique), dans un repère pixel.
 * Utilisé pour rasteriser les aplats via sharp.
 */
export function gendarmePathD(b: { x: number; y: number; w: number; h: number }): string {
  const yBottom = b.y + b.h
  const straightH = b.h * CAP_GENDARME_STRAIGHT_FRAC
  const yShoulder = yBottom - straightH
  const xL = b.x
  const xR = b.x + b.w
  const rx = b.w / 2
  const ry = b.h - straightH
  return `M ${xL} ${yBottom} L ${xL} ${yShoulder} A ${rx} ${ry} 0 0 0 ${xR} ${yShoulder} L ${xR} ${yBottom} Z`
}
