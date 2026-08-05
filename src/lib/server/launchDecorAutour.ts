import { enqueueNewJob } from '@/lib/server/runner'
import type { ImageSize } from '@/lib/genai/client'
import { getMoteurDaReglages, type MoteurDaKey } from '@/lib/moteursDa'

/**
 * Lancement d'un lot « DÉCOR AUTOUR » (bascule du 05/08/2026,
 * docs/CADRAGE-DECOR-AUTOUR-2026-08-05.md). COPIE COLLAPSÉE de launchGammeJobs
 * (jamais modifié chez lui — règle « on n'écrase jamais l'ancien ») :
 *
 *  - AUCUN décor : le plan gris est construit par le pipeline, Nano peint autour ;
 *  - AUCUN gabarit-scène : la géométrie (rectangle produit) se calcule dans le
 *    step depuis la taille — pas de réglages de jeu à fusionner ici ;
 *  - UN job « decor-autour » par image = une MES complète.
 *
 * Générations multiples (05/08/2026, demande Mathias : « 3 générations par
 * taille même pour les nouvelles MES contraintes ») : même mécanique que le
 * legacy (launchGamme) — N jobs par image (réglage generationsParTaille du
 * moteur), numéro dans payload.variant, l'utilisateur en CHOISIT une par taille.
 */

export interface DecorAutourLaunchItem {
  size: { w: number; h: number }
  /** Chemin ABSOLU du PNG produit (déjà validé par l'appelant). */
  productPath: string
  /** Champs de payload propres à cet item (ex. coloris). */
  extra?: Record<string, unknown>
}

export interface DecorAutourLaunchOptions {
  items: DecorAutourLaunchItem[]
  /** Moteur DÉCOR AUTOUR (janus/terminus/forculus) : ses réglages, SON prompt. */
  moteur: MoteurDaKey
  /** Qualité Nano choisie au lancement (2K/4K — décision Mathias 05/08). */
  imageSize: ImageSize
  slug: string
  createdBy?: string
  /** Réutilise un batch existant ; sinon un nouveau groupe est créé. */
  batchId?: string
  /** Champs de payload communs à tous les items (ex. autoMp). */
  extra?: Record<string, unknown>
}

export function launchDecorAutourJobs(opts: DecorAutourLaunchOptions): {
  jobIds: number[]
  batchId: string
} {
  const batchId =
    opts.batchId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  // Générations multiples (05/08/2026) : N MES par taille, réglage du moteur.
  const nGen = Math.max(1, Math.round(getMoteurDaReglages(opts.moteur).generationsParTaille ?? 1))
  // Marketplace automatique et générations multiples ne vont pas ensemble : tant
  // qu'aucune MES n'est CHOISIE, aucun MP ne doit partir (règle Mathias 29/07).
  const stripAutoMp = nGen > 1
  const cleanExtra = (e?: Record<string, unknown>) => {
    if (!stripAutoMp || !e || !('autoMp' in e)) return e
    const rest = { ...e }
    delete rest.autoMp
    return rest
  }
  const commonExtra = cleanExtra(opts.extra)
  const jobIds: number[] = []
  for (const { size, productPath, extra } of opts.items) {
    const itemExtra = cleanExtra(extra)
    // N générations indépendantes de la même image : mêmes réglages, numéro de
    // variante distinct (payload.variant). Une seule génération → pas de champ
    // variant (payload identique au comportement historique, non-régression).
    for (let v = 1; v <= nGen; v++) {
      jobIds.push(
        enqueueNewJob(
          'decor-autour',
          {
            size,
            productPath,
            imageSize: opts.imageSize,
            slug: opts.slug,
            // Moteur TOUJOURS explicite (janus/terminus/forculus) : la convention
            // legacy « battant omis » ne s'applique pas à la nouvelle génération.
            moteur: opts.moteur,
            variant: nGen > 1 ? v : undefined,
            ...commonExtra,
            ...itemExtra,
          },
          batchId,
          opts.createdBy
        )
      )
    }
  }
  return { jobIds, batchId }
}
