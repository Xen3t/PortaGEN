/**
 * CADRAGE & SCÈNE des moteurs « décor autour » (07/08/2026, demande Mathias :
 * tout ce qui contrôlait le resizing/la scène était figé dans le code — ces
 * valeurs deviennent des RÉGLAGES par moteur, éditables dans Admin → Réglages
 * → fiche moteur → « Cadrage & scène »).
 *
 * Module PUR (aucun import serveur) : types, défauts par moteur (les valeurs
 * rodées au banc le 07/08), fusion réglages/défauts et validation. Le stockage
 * vit dans MoteurReglages.cadrageDa (moteur.<clé>.reglages) — seul le DELTA
 * par rapport aux défauts est enregistré.
 *
 * Largeur étalon et plafond piliers : FIGÉS ad vitam (décision Mathias 07/08
 * soir) — présents dans la recette, absents de l'UI.
 */

/** Clés des moteurs décor autour — dupliquées ici (module pur, zéro cycle). */
export type MoteurDaCle = 'janus' | 'terminus' | 'forculus'

/** Couleurs des aplats du plan gris (échafaudage dessiné, rodage 07/08). */
export interface CouleursPlan {
  /** Piliers (blanc cassé — Nano texture la teinte donnée). */
  pilier: string
  /** Chapeaux de pilier (même famille que les piliers, jamais gris). */
  chapeau: string
  /** Murets bas. */
  muret: string
  /** Bande trottoir. */
  trottoir: string
  /** Bordure. */
  bordure: string
  /** Route (asphalte). */
  route: string
  /** Rail de guidage au sol (coulissant). */
  rail: string
}

export interface CadrageDaReglages {
  /** Bandes de sol + échafaudage dessinés (structure anti-dérive, v3-v4). */
  bandesSol: boolean
  /** Largeur étalon du resizing (cm) — null = vraie largeur. FIGÉE (pas d'UI). */
  refWidthCm: number | null
  /** Zoom caméra (%, 100 = neutre). */
  zoom: number
  /** Décalage horizontal du portail (cm, + = vers la droite) — « axe X ». */
  offsetX: number
  /** Décalage vertical de la scène (cm, + = tout descend) — « axe Y ». */
  offsetY: number
  /** Échelle LARGEUR du produit (%, 100 = fidèle) — dilate le rectangle de pose,
   *  centré ; l'échafaudage ne bouge pas. */
  produitLargeurPct: number
  /** Échelle HAUTEUR du produit (%, 100 = fidèle) — ancrée à la ligne de sol. */
  produitHauteurPct: number
  /** Plafond de hauteur des piliers (cm) — null = aucun. FIGÉ (pas d'UI). */
  pillarHMax: number | null
  /** COULISSANT : largeur (cm) à partir de laquelle la scène XL s'applique. */
  xlMinW: number
  /** COULISSANT XL : largeur étalon du resizing (cm). FIGÉE (pas d'UI). */
  xlRefWidthCm: number
  /** COULISSANT XL : hauteur de scène (cm). */
  xlSceneH: number
  /** COULISSANT XL : hauteur de la ligne de sol (cm depuis le bas). */
  xlGroundY: number
  /** COULISSANT XL : zoom caméra (%, 100 = neutre). */
  xlZoom: number
  /** COULISSANT : engagement de la lame sous le pilier droit (cm). */
  recouvrementCm: number
  /** COULISSANT : couverture minimale d'une colonne « lame pleine » (%). */
  queueCouverturePct: number
  /** COULISSANT : sous ce ratio de lame pleine (%), une queue est détectée. */
  queueSeuilPct: number
  couleurs: CouleursPlan
}

export const COULEURS_PLAN_DEFAUT: CouleursPlan = {
  pilier: '#f0ece4',
  chapeau: '#ece8e0',
  muret: '#eae6de',
  trottoir: '#d0cfca',
  bordure: '#b5b3ae',
  route: '#8f9499',
  rail: '#4a4d52',
}

/** Valeurs rodées au banc le 07/08/2026 — la « recette » de chaque moteur. */
export const CADRAGE_DA_DEFAUTS: Record<MoteurDaCle, CadrageDaReglages> = {
  janus: {
    bandesSol: true,
    refWidthCm: 400,
    zoom: 100,
    offsetX: 0,
    offsetY: 0,
    produitLargeurPct: 100,
    produitHauteurPct: 100,
    pillarHMax: null,
    xlMinW: 450,
    xlRefWidthCm: 600,
    xlSceneH: 480,
    xlGroundY: 160,
    xlZoom: 100,
    recouvrementCm: 20,
    queueCouverturePct: 50,
    queueSeuilPct: 98,
    couleurs: COULEURS_PLAN_DEFAUT,
  },
  terminus: {
    bandesSol: true,
    refWidthCm: 400,
    // Dézoom du coulissant standard : dégage l'espace de refoulement à droite.
    zoom: 92,
    offsetX: 0,
    offsetY: 0,
    produitLargeurPct: 100,
    produitHauteurPct: 100,
    pillarHMax: null,
    xlMinW: 450,
    xlRefWidthCm: 600,
    xlSceneH: 480,
    xlGroundY: 160,
    xlZoom: 100,
    recouvrementCm: 20,
    queueCouverturePct: 50,
    queueSeuilPct: 98,
    couleurs: COULEURS_PLAN_DEFAUT,
  },
  forculus: {
    bandesSol: true,
    // Portillon : VRAIE largeur (pas d'étalon), recette zoom/décalage figée
    // extraite des réglages Mathias du 07/08 (validée sur les 4 tailles ARLBERG).
    refWidthCm: null,
    zoom: 134,
    offsetX: 0,
    offsetY: 20,
    produitLargeurPct: 100,
    produitHauteurPct: 100,
    pillarHMax: 202,
    xlMinW: 450,
    xlRefWidthCm: 600,
    xlSceneH: 480,
    xlGroundY: 160,
    xlZoom: 100,
    recouvrementCm: 20,
    queueCouverturePct: 50,
    queueSeuilPct: 98,
    couleurs: COULEURS_PLAN_DEFAUT,
  },
}

/** Réglages effectifs d'un moteur : défauts de sa recette + delta enregistré. */
export function cadrageDaEffectif(
  moteur: MoteurDaCle,
  partiel?: Partial<CadrageDaReglages>
): CadrageDaReglages {
  const d = CADRAGE_DA_DEFAUTS[moteur]
  return {
    ...d,
    ...(partiel ?? {}),
    couleurs: { ...d.couleurs, ...(partiel?.couleurs ?? {}) },
  }
}

const HEX_RE = /^#[0-9a-f]{6}$/i

/**
 * Valide un delta de cadrage (PATCH admin) : seules les valeurs plausibles
 * passent, le reste est ignoré — jamais d'erreur, on garde ce qui est bon.
 */
export function sanitizeCadrageDa(input: unknown): Partial<CadrageDaReglages> | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const src = input as Record<string, unknown>
  const out: Partial<CadrageDaReglages> = {}
  const num = (v: unknown, min: number, max: number): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : undefined
  const numOuNull = (v: unknown, min: number, max: number): number | null | undefined =>
    v === null ? null : num(v, min, max)

  if (typeof src.bandesSol === 'boolean') out.bandesSol = src.bandesSol
  const refWidthCm = numOuNull(src.refWidthCm, 50, 1000)
  if (refWidthCm !== undefined) out.refWidthCm = refWidthCm
  const zoom = num(src.zoom, 25, 400)
  if (zoom !== undefined) out.zoom = zoom
  const offsetX = num(src.offsetX, -200, 200)
  if (offsetX !== undefined) out.offsetX = offsetX
  const offsetY = num(src.offsetY, -100, 100)
  if (offsetY !== undefined) out.offsetY = offsetY
  const produitLargeurPct = num(src.produitLargeurPct, 50, 200)
  if (produitLargeurPct !== undefined) out.produitLargeurPct = produitLargeurPct
  const produitHauteurPct = num(src.produitHauteurPct, 50, 200)
  if (produitHauteurPct !== undefined) out.produitHauteurPct = produitHauteurPct
  const pillarHMax = numOuNull(src.pillarHMax, 50, 400)
  if (pillarHMax !== undefined) out.pillarHMax = pillarHMax
  const xlMinW = num(src.xlMinW, 200, 1000)
  if (xlMinW !== undefined) out.xlMinW = xlMinW
  const xlRefWidthCm = num(src.xlRefWidthCm, 100, 1200)
  if (xlRefWidthCm !== undefined) out.xlRefWidthCm = xlRefWidthCm
  const xlSceneH = num(src.xlSceneH, 200, 900)
  if (xlSceneH !== undefined) out.xlSceneH = xlSceneH
  const xlGroundY = num(src.xlGroundY, 0, 500)
  if (xlGroundY !== undefined) out.xlGroundY = xlGroundY
  const xlZoom = num(src.xlZoom, 25, 400)
  if (xlZoom !== undefined) out.xlZoom = xlZoom
  const recouvrementCm = num(src.recouvrementCm, 0, 60)
  if (recouvrementCm !== undefined) out.recouvrementCm = recouvrementCm
  const queueCouverturePct = num(src.queueCouverturePct, 5, 95)
  if (queueCouverturePct !== undefined) out.queueCouverturePct = queueCouverturePct
  const queueSeuilPct = num(src.queueSeuilPct, 50, 100)
  if (queueSeuilPct !== undefined) out.queueSeuilPct = queueSeuilPct
  if (typeof src.couleurs === 'object' && src.couleurs !== null) {
    const c = src.couleurs as Record<string, unknown>
    const coul: Partial<CouleursPlan> = {}
    for (const k of Object.keys(COULEURS_PLAN_DEFAUT) as (keyof CouleursPlan)[]) {
      if (typeof c[k] === 'string' && HEX_RE.test(c[k] as string)) {
        coul[k] = (c[k] as string).toLowerCase()
      }
    }
    if (Object.keys(coul).length > 0) out.couleurs = coul as CouleursPlan
  }
  return Object.keys(out).length > 0 ? out : undefined
}
