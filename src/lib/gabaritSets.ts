import type { GabaritParams } from '@/lib/geometry'
import type { MoteurKey } from '@/lib/moteurs'

/**
 * Jeux de gabarits (chantier coulissants XL, 22/07/2026). Un moteur porte en
 * général UN jeu de gabarits ; le coulissant « TERMINUS » en a DEUX : le jeu
 * standard (largeurs 300-400) et le jeu « Gabarits XL » (450-600), dont la
 * scène est élargie pour contenir les grandes lames — la scène standard
 * (~480 cm de large) clampait tout au-delà de 4 m. Tout le reste (prompts,
 * réglages moteur, pipeline) reste celui du moteur : un jeu de gabarits n'est
 * PAS un moteur, juste un second référentiel tailles + réglages de gabarit.
 *
 * Module PUR (aucun accès base) : importable côté client comme côté serveur.
 */

export const GABARIT_SETS = ['battant', 'coulissant', 'portillon', 'coulissant-xl'] as const
export type GabaritSetKey = (typeof GABARIT_SETS)[number]

export function isGabaritSetKey(v: unknown): v is GabaritSetKey {
  return typeof v === 'string' && (GABARIT_SETS as readonly string[]).includes(v)
}

/**
 * Largeur (cm) à partir de laquelle un coulissant passe sur le jeu XL.
 * Décision Mathias 22/07/2026 : le 400 RESTE dans le jeu standard (rendus
 * validés inchangés) — le jeu XL couvre 450/500/550/600.
 */
export const COULISSANT_XL_MIN_W = 450

/** Jeu de gabarits d'une taille : XL pour les coulissants larges, sinon le moteur. */
export function gabaritSetForSize(moteur: MoteurKey, widthCm: number): GabaritSetKey {
  return moteur === 'coulissant' && widthCm >= COULISSANT_XL_MIN_W ? 'coulissant-xl' : moteur
}

/**
 * Défauts PAR JEU, appliqués par-dessus les défauts du code (DEFAULT_PARAMS) et
 * SOUS les réglages admin (globaux puis dérogations). XL : scène de 480 cm de
 * haut ≈ 722 cm de large au ratio MES — une lame de 6 m + ses piliers y tient.
 * groundY 184 : la ligne de sol tombe sur le trottoir du Canny XL (caméra
 * reculée = trottoir remonté à ~61,6 % de la hauteur, ×0,8 du standard à 77 % —
 * même invariant que le standard, où groundY 74 / scène 320 aligne la ligne de
 * sol sur le trottoir du Canny historique).
 */
export const GABARIT_SET_DEFAULTS: Partial<Record<GabaritSetKey, Partial<GabaritParams>>> = {
  'coulissant-xl': { sceneH: 480, groundY: 184 },
}
