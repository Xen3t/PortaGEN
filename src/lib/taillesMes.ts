import type { MoteurDaCle } from '@/lib/cadrageDa'

/**
 * TABLEAU DES TAILLES proposées en MES (20/08/2026, demande Mathias : « on
 * setup des tailles nous-même et on en ajoute plus tard simplement ») — le
 * tableau croisé largeurs × hauteurs de chaque moteur décor autour, géré dans
 * Admin → Réglages → fiche moteur → « Tailles ».
 *
 * Une taille ABSENTE du tableau est REFUSÉE au lancement avec un message
 * clair : les tailles offertes sont choisies à la main, une taille exotique ne
 * passe jamais en douce (même philosophie que le garde-fou de débordement de
 * la règle ratio, [[controleCadrageRatio]]).
 *
 * Module PUR (aucun import serveur). Stockage : MoteurReglages.taillesMes —
 * seul le DELTA par rapport aux défauts est enregistré ; absent = les défauts.
 */

export interface TailleMes {
  w: number
  h: number
}

/** Défauts = les tailles du catalogue Casanoov Cazeboo 2027 (extraction PDF 20/08). */
export const TAILLES_MES_DEFAUTS: Record<MoteurDaCle, TailleMes[]> = {
  janus: [
    { w: 300, h: 120 }, { w: 300, h: 140 }, { w: 300, h: 160 }, { w: 300, h: 180 },
    { w: 350, h: 140 }, { w: 350, h: 160 }, { w: 350, h: 180 }, { w: 350, h: 190 }, { w: 350, h: 195 },
    { w: 400, h: 120 }, { w: 400, h: 140 }, { w: 400, h: 160 }, { w: 400, h: 180 }, { w: 400, h: 195 },
  ],
  terminus: [
    { w: 300, h: 120 }, { w: 300, h: 140 }, { w: 300, h: 160 }, { w: 300, h: 180 },
    { w: 350, h: 120 }, { w: 350, h: 140 }, { w: 350, h: 160 }, { w: 350, h: 180 }, { w: 350, h: 190 }, { w: 350, h: 195 },
    { w: 400, h: 120 }, { w: 400, h: 140 }, { w: 400, h: 160 }, { w: 400, h: 180 }, { w: 400, h: 195 },
    { w: 450, h: 195 },
    { w: 500, h: 140 }, { w: 500, h: 160 }, { w: 500, h: 180 }, { w: 500, h: 195 },
    { w: 600, h: 180 }, { w: 600, h: 195 },
  ],
  forculus: [
    { w: 100, h: 120 }, { w: 100, h: 140 }, { w: 100, h: 160 }, { w: 100, h: 180 },
    { w: 100, h: 190 }, { w: 100, h: 195 },
  ],
}

/** Tri stable largeur puis hauteur — l'ordre du tableau croisé. */
function trier(tailles: TailleMes[]): TailleMes[] {
  return [...tailles].sort((a, b) => a.w - b.w || a.h - b.h)
}

/**
 * Valide une liste de tailles (PATCH admin) : entiers plausibles, dédoublonnés,
 * triés. Liste vide ACCEPTÉE (= aucune taille offerte, tout lancement refusé —
 * état voulu s'il est choisi). Invalide = undefined (champ ignoré).
 */
export function sanitizeTaillesMes(input: unknown): TailleMes[] | undefined {
  if (!Array.isArray(input) || input.length > 500) return undefined
  const vues = new Set<string>()
  const out: TailleMes[] = []
  for (const t of input) {
    if (typeof t !== 'object' || t === null) return undefined
    const w = (t as Record<string, unknown>).w
    const h = (t as Record<string, unknown>).h
    if (typeof w !== 'number' || typeof h !== 'number') return undefined
    if (!Number.isFinite(w) || !Number.isFinite(h)) return undefined
    const wi = Math.round(w)
    const hi = Math.round(h)
    if (wi < 50 || wi > 1000 || hi < 50 || hi > 400) return undefined
    const cle = `${wi}x${hi}`
    if (vues.has(cle)) continue
    vues.add(cle)
    out.push({ w: wi, h: hi })
  }
  return trier(out)
}

/** Tailles effectives d'un moteur : défauts catalogue ou delta enregistré. */
export function taillesMesEffectives(
  moteur: MoteurDaCle,
  partiel?: TailleMes[]
): TailleMes[] {
  return trier(partiel ?? TAILLES_MES_DEFAUTS[moteur])
}

export function estTailleOfferte(tailles: TailleMes[], w: number, h: number): boolean {
  return tailles.some((t) => t.w === w && t.h === h)
}
