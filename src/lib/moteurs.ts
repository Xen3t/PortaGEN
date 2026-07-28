import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'
import { getSetting, setSetting } from '@/lib/db/settings'
import type { GabaritSetKey } from '@/lib/gabaritSets'
import { RALIFY_DEFAUTS, sanitizeRalify, type RalifyReglages } from '@/lib/ralify'

/**
 * Registre des MOTEURS (cadrage docs/CADRAGE-MOTEURS-2026-07-12.md, maquette
 * reglages-par-moteur-v9 validée le 13/07/2026).
 *
 * Un moteur = l'ensemble des technologies qui produisent les MES d'un TYPE de
 * produit (import & détourage, coloris, gabarits, CANNY, génération, livraison).
 * Les trois moteurs sont ACTIFS : Battant « JANUS » (13/07), Portillon
 * « FORCULUS » (13/07) et Coulissant « TERMINUS » (13/07). Le rattachement
 * produit → moteur est AUTOMATIQUE (famille du catalogue / typologie choisie).
 */

export type MoteurKey = 'battant' | 'coulissant' | 'portillon'
export type MoteurStatus = 'actif' | 'preparation'

export interface MoteurDef {
  key: MoteurKey
  label: string
  /** Nom de code du moteur (baptême du 13/07/2026 — chaque moteur reçoit le sien). */
  codeName?: string
  status: MoteurStatus
  /**
   * Famille d'affichage dans la colonne des moteurs (maquette
   * reglages-par-moteur-v10 validée le 13/07/2026) : purement visuelle, elle
   * groupe la liste quand les moteurs se multiplieront (« Clôtures &
   * occultation », « Ombrage & abris »…). Rien à voir avec la famille du
   * catalogue qui sert à l'aiguillage produit → moteur.
   */
  famille: string
}

export const MOTEURS: ReadonlyArray<MoteurDef> = [
  // « JANUS » : dieu romain des portails et des passages (janua = la porte),
  // aux DEUX visages — comme les deux vantaux d'un battant — et dieu des
  // commencements : le premier moteur de PortaGEN. Nom choisi par Claude le
  // 13/07/2026, récompense offerte par Mathias après le câblage du moteur.
  { key: 'battant', label: 'Battant', codeName: 'JANUS', status: 'actif', famille: 'Portails' },
  // « TERMINUS » : dieu romain des LIMITES et des bornes sacrées — la borne
  // qu'on ne déplace jamais (même Jupiter lui cédait la place au Capitole).
  // Le portail marque la frontière de la propriété, et la lame court sur son
  // rail jusqu'à son terminus derrière le pilier. Nom choisi par Mathias le
  // 13/07/2026 parmi les propositions de Claude (1ᵉʳ baptême LIMENTINUS, le
  // seuil, remplacé le jour même). Recherche : docs/MOTEUR-COULISSANT-prompt.md.
  { key: 'coulissant', label: 'Coulissant', codeName: 'TERMINUS', status: 'actif', famille: 'Portails' },
  // « FORCULUS » : dans la religion romaine, le dieu qui protège le VANTAIL de
  // la porte (forem = le battant de porte) — il forme avec Janus (le passage),
  // Cardea (les gonds) et Limentinus (le seuil) la petite famille divine de la
  // porte romaine. Le vantail unique du portillon, gardé par son propre dieu,
  // petit frère de JANUS. Baptisé par Claude à la construction du moteur (13/07/2026).
  { key: 'portillon', label: 'Portillon', codeName: 'FORCULUS', status: 'actif', famille: 'Portails' },
]

export function moteurDef(key: string): MoteurDef | undefined {
  return MOTEURS.find((m) => m.key === key)
}

/**
 * Aiguillage AUTOMATIQUE produit → moteur (décision cadrage 13/07/2026) :
 * la famille du catalogue (« PORTAIL BATTANT », « PORTILLON »…) désigne le moteur.
 * null si aucune famille reconnue — l'appelant refuse alors la génération.
 */
export function moteurForFamily(family: string): MoteurKey | null {
  const f = family.toUpperCase()
  if (f.includes('BATTANT')) return 'battant'
  if (f.includes('COULISSANT')) return 'coulissant'
  if (f.includes('PORTILLON')) return 'portillon'
  return null
}

/**
 * Nom du prompt système d'un moteur. RÈGLE (cadrage 13/07/2026) : les réglages —
 * prompts compris — ne sont JAMAIS partagés entre moteurs. Battant garde les noms
 * historiques (« piliers-murets »…) ; les autres moteurs préfixent
 * (« portillon-piliers-murets »…), chacun son jeu complet, éditable dans l'admin.
 */
export function moteurPromptName(moteur: MoteurKey, base: string): string {
  return moteur === 'battant' ? base : `${moteur}-${base}`
}

/**
 * Réglages d'un moteur, persistés en base (clé app_settings `moteur.<key>.reglages`,
 * JSON). Écrits depuis Admin → Réglages par moteur. Lot 1 : persistés et servis par
 * l'API ; le câblage de lecture par le pipeline arrive au lot suivant (les défauts
 * ci-dessous sont les comportements ACTUELS du code — rien ne change tant qu'on ne
 * touche pas aux réglages).
 */
export interface MoteurReglages {
  /** Rattachement produit → moteur ('auto' = déduit au scan). */
  detectionType: 'auto' | 'manuel'
  /** Placement des piliers sur le CANNY (alignement de la ligne de sol). */
  cannyPlacement: 'auto' | 'manuel' | 'off'
  /** Décalage imposé quand cannyPlacement = 'manuel' (px natifs, positif = descendu). */
  cannyOffsetPx: number
  /** Largeur du corridor d'allée du CANNY ('auto' = plus grande taille active). */
  corridor: 'auto' | 'manuel'
  /** Largeur imposée quand corridor = 'manuel' (cm). */
  corridorWidthCm: number
  /** Masquage de la sortie Piliers ('off' = rendu brut, décision 11/07/2026). */
  masking: 'off' | 'pixel-lock'
  /**
   * Méthode d'intégration du portail. 'pose-fusion' (chantier du 17/07/2026,
   * docs/CADRAGE-POSE-FUSION-JANUS-2026-07-17.md) : le code pose le produit au
   * pixel près, un seul appel Nano fait stuc + lumière/ombres. 'simple' reste le
   * défaut tant que la migration JANUS n'est pas validée par Mathias.
   */
  integrationMethod: 'simple' | 'rectangle' | 'pose-directe' | 'pose-fusion'
  /** Pose-fusion : débordement du produit sur les piliers, % de la largeur PAR CÔTÉ. */
  poseDebordPct: number
  /** Pose-fusion : alpha minimal conservé au nettoyage du PNG produit (0-255). */
  poseSeuilAlpha: number
  /** Ombres portées à l'intégration (méthodes rectangle / pose-directe). */
  shadows: 'auto' | 'off'
  /**
   * Coulissant uniquement (28/07/2026) : opacité de l'ombre dégradée dessinée
   * sur la lame le long de la face gauche du pilier droit, en % (0 = pas
   * d'ombre). Indice de profondeur pour Nano : sans elle, le modèle terminait
   * la lame AVANT le pilier (joint sombre) au lieu de la faire disparaître
   * derrière (jobs #19-26 du 28/07). Enquête fiabilité du 28/07 après-midi
   * (jobs #37-38 ratés, tirages répétés sur l'entrée du #38) : 25 % = 2
   * réussites sur 4 tirages, 40 % = 3/3 — Nano est stochastique, un signal
   * faible est ignoré. Profil retenu par Mathias (2ᵉ itération 28/07 apm) :
   * dégradé TRÈS progressif sur 1,5 × la largeur du pilier, 0 → 25 % au
   * contact — jamais de bloc sombre (le 90 % de la 1ʳᵉ itération rendait
   * une ombre trop dure). Fiabilité à juger sur gamme complète.
   */
  ombrePilierPct: number
  /**
   * Déclinaison Marketplace (2000×2000) — décision Mathias 13/07/2026 :
   * 'choix' = case à cocher au lancement + bouton 1:1 sur le résultat ;
   * 'toujours' = automatique après chaque MES Site (pas de case) ;
   * 'jamais' = interdit et invisible (pas de case, pas de bouton, API refusée).
   */
  marketplace: 'choix' | 'toujours' | 'jamais'
  /** Modèle de nom du livrable final. */
  livraisonName: string
  /**
   * RALify (28/07/2026, maquette ralify-v2) : harmonisation colorimétrique du
   * PNG produit AVANT la génération — règle par coloris + exceptions par nom de
   * produit + intensité. Config et résolution : src/lib/ralify.ts.
   */
  ralify: RalifyReglages
}

export const MOTEUR_REGLAGES_DEFAUTS: MoteurReglages = {
  detectionType: 'auto',
  cannyPlacement: 'auto',
  cannyOffsetPx: 0,
  corridor: 'auto',
  corridorWidthCm: 400,
  masking: 'off',
  integrationMethod: 'simple',
  poseDebordPct: 2,
  poseSeuilAlpha: 200,
  shadows: 'auto',
  ombrePilierPct: 25,
  marketplace: 'choix',
  livraisonName: '{MARQUE}-{TAILLE}_{COLORIS}_{FORMAT}',
  ralify: RALIFY_DEFAUTS,
}

// La clé accepte aussi un JEU DE GABARITS (22/07/2026) : « coulissant-xl »
// porte SES réglages Canny (alignement des piliers, largeur du corridor —
// section « Canny XL » de la fiche TERMINUS). Les autres champs de ce jeu ne
// sont jamais consultés : les pipelines lisent tout le reste sur le moteur.
const reglagesKey = (jeu: GabaritSetKey) => `moteur.${jeu}.reglages`

export function getMoteurReglages(
  moteur: GabaritSetKey,
  db: Database.Database = getDb()
): MoteurReglages {
  const raw = getSetting(reglagesKey(moteur), db)
  if (!raw) return { ...MOTEUR_REGLAGES_DEFAUTS }
  try {
    const parsed = JSON.parse(raw) as Partial<MoteurReglages>
    return { ...MOTEUR_REGLAGES_DEFAUTS, ...sanitizeMoteurReglages(parsed) }
  } catch {
    return { ...MOTEUR_REGLAGES_DEFAUTS }
  }
}

/** Ne garde que les champs connus, avec des valeurs autorisées. */
export function sanitizeMoteurReglages(input: unknown): Partial<MoteurReglages> {
  if (typeof input !== 'object' || input === null) return {}
  const src = input as Record<string, unknown>
  const out: Partial<MoteurReglages> = {}
  const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
    typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined

  const detectionType = pick(src.detectionType, ['auto', 'manuel'] as const)
  if (detectionType) out.detectionType = detectionType
  const cannyPlacement = pick(src.cannyPlacement, ['auto', 'manuel', 'off'] as const)
  if (cannyPlacement) out.cannyPlacement = cannyPlacement
  const corridor = pick(src.corridor, ['auto', 'manuel'] as const)
  if (corridor) out.corridor = corridor
  const num = (v: unknown, min: number, max: number): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
      ? Math.round(v)
      : undefined
  const cannyOffsetPx = num(src.cannyOffsetPx, -300, 300)
  if (cannyOffsetPx !== undefined) out.cannyOffsetPx = cannyOffsetPx
  const corridorWidthCm = num(src.corridorWidthCm, 100, 800)
  if (corridorWidthCm !== undefined) out.corridorWidthCm = corridorWidthCm
  const masking = pick(src.masking, ['off', 'pixel-lock'] as const)
  if (masking) out.masking = masking
  const integrationMethod = pick(src.integrationMethod, [
    'simple',
    'rectangle',
    'pose-directe',
    'pose-fusion',
  ] as const)
  if (integrationMethod) out.integrationMethod = integrationMethod
  // Débordement en % avec décimales (mesuré à 3,5 %, ramené à 2 % par Mathias le 17/07).
  if (
    typeof src.poseDebordPct === 'number' &&
    Number.isFinite(src.poseDebordPct) &&
    src.poseDebordPct >= 0 &&
    src.poseDebordPct <= 10
  ) {
    out.poseDebordPct = Math.round(src.poseDebordPct * 10) / 10
  }
  const poseSeuilAlpha = num(src.poseSeuilAlpha, 1, 255)
  if (poseSeuilAlpha !== undefined) out.poseSeuilAlpha = poseSeuilAlpha
  const shadows = pick(src.shadows, ['auto', 'off'] as const)
  if (shadows) out.shadows = shadows
  const ombrePilierPct = num(src.ombrePilierPct, 0, 100)
  if (ombrePilierPct !== undefined) out.ombrePilierPct = ombrePilierPct
  const marketplace = pick(src.marketplace, ['choix', 'toujours', 'jamais'] as const)
  if (marketplace) out.marketplace = marketplace
  if (src.ralify !== undefined) {
    const ralify = sanitizeRalify(src.ralify)
    if (ralify) out.ralify = ralify
  }
  if (typeof src.livraisonName === 'string') {
    // Modèle de NOM DE FICHIER : on refuse dès maintenant les caractères invalides
    // sous Windows et toute traversée de chemin (avant même le câblage pipeline).
    const v = src.livraisonName.trim()
    if (v && v.length <= 200 && !/[\\/:*?"<>|]/.test(v) && !v.includes('..')) {
      out.livraisonName = v
    }
  }
  return out
}

/** Fusionne les champs fournis dans les réglages existants, puis persiste. */
export function patchMoteurReglages(
  moteur: GabaritSetKey,
  patch: Partial<MoteurReglages>,
  db: Database.Database = getDb()
): MoteurReglages {
  const next = { ...getMoteurReglages(moteur, db), ...sanitizeMoteurReglages(patch) }
  setSetting(reglagesKey(moteur), JSON.stringify(next), db)
  return next
}
