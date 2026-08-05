import { enqueueNewJob } from '@/lib/server/runner'
import { getGabaritGlobals, getSizeParamsOverride, type SizeParamsOverride } from '@/lib/db/sizeParams'
import { widestActiveWidth } from '@/lib/db'
import { GABARIT_SET_DEFAULTS, gabaritSetForSize, type GabaritSetKey } from '@/lib/gabaritSets'
import { getMoteurReglages, type MoteurKey } from '@/lib/moteurs'

/**
 * Cœur PARTAGÉ du lancement d'une gamme (factorisé le 12/07/2026, bloc 3.1).
 *
 * Un lancement = un GROUPE (batch_id) : un job Piliers par taille ; si l'item
 * porte une image produit, le runner enchaîne l'Intégration automatiquement.
 * Réglages de gabarit fusionnés dans l'ordre : défauts du code < défauts du jeu
 * de gabarits (scène élargie des coulissants XL) < globaux (page Gabarits) <
 * paramètres d'appel < dérogation par taille.
 *
 * Cette fonction ne fait AUCUNE validation de chemin : elle reçoit des chemins
 * ABSOLUS déjà résolus et autorisés par l'appelant (l'API /gamme borne à data/,
 * l'API catalogue résout facePng côté serveur depuis le résumé). Les deux
 * appelants produisent ainsi des jobs strictement identiques — un seul format.
 */

export interface GammeLaunchItem {
  size: { w: number; h: number }
  /** Chemin ABSOLU du PNG produit (facultatif). Déclenche l'Intégration chaînée. */
  productPath?: string
  /** Champs de payload propres à cet item (ex. coloris, format côté catalogue). */
  extra?: Record<string, unknown>
}

export interface GammeLaunchOptions {
  /** Chemin ABSOLU du décor (déjà validé par l'appelant). */
  decorPath: string
  items: GammeLaunchItem[]
  /**
   * Alignement de la ligne de sol. ABSENT = le réglage du moteur décide
   * (Admin → Réglages par moteur, câblage 13/07/2026). Un appelant qui précise
   * (réglage coloris du catalogue, essai Lab) garde la priorité.
   */
  align?: 'auto' | 'off' | number
  params?: SizeParamsOverride
  lab?: boolean
  /**
   * Moteur produit (13/07/2026) : sélectionne les réglages, gabarits et prompts —
   * JAMAIS partagés entre moteurs. Absent = battant (JANUS), comportement historique.
   */
  moteur?: MoteurKey
  slug: string
  createdBy?: string
  /** Réutilise un batch existant ; sinon un nouveau groupe est créé. */
  batchId?: string
  /** Champs de payload communs à tous les items (ex. catalogProductId). */
  extra?: Record<string, unknown>
}

export function launchGammeJobs(opts: GammeLaunchOptions): { jobIds: number[]; batchId: string } {
  const batchId =
    opts.batchId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const moteur = opts.moteur ?? 'battant'
  const reglages = getMoteurReglages(moteur)
  // Chantier pose + fusion (17/07/2026) : quand le réglage moteur le demande ET
  // que l'item porte un produit, UN job « pose-fusion » remplace le chaînage
  // pillars → integration. Sans produit, l'étape Piliers seule reste telle quelle.
  const poseFusion = reglages.integrationMethod === 'pose-fusion'
  // Générations multiples (29/07/2026) : N MES par taille (réglable par moteur).
  // Un essai Lab reste TOUJOURS à une seule génération (une image par essai).
  const nGen = opts.lab ? 1 : Math.max(1, Math.round(reglages.generationsParTaille ?? 1))
  // Marketplace automatique et générations multiples ne vont pas ensemble : tant
  // qu'aucune MES n'est CHOISIE, aucun MP ne doit partir (règle Mathias 29/07). On
  // retire donc autoMp du payload dès qu'une taille a plusieurs générations — le MP
  // se déclenche alors à la main, une fois la génération retenue.
  const stripAutoMp = nGen > 1
  const cleanExtra = (e?: Record<string, unknown>) => {
    if (!stripAutoMp || !e || !('autoMp' in e)) return e
    const rest = { ...e }
    delete rest.autoMp
    return rest
  }
  const commonExtra = cleanExtra(opts.extra)

  // Largeur de référence des gabarits (04/08/2026) : la plus grande largeur du
  // JEU. Le gabarit ne dépend plus que de la hauteur — un 300 et un 400 de même
  // hauteur ont le même gabarit. Calculée une fois par jeu (référentiel complet
  // en base, pas seulement les tailles sélectionnées).
  const refWidthByJeu = new Map<GabaritSetKey, number>()
  const refWidthFor = (jeu: GabaritSetKey): number => {
    let w = refWidthByJeu.get(jeu)
    if (w === undefined) {
      w = widestActiveWidth(jeu)
      refWidthByJeu.set(jeu, w)
    }
    return w
  }

  const jobIds: number[] = []
  for (const { size, productPath, extra } of opts.items) {
    // Coulissants XL (22/07/2026) : les largeurs ≥ 450 prennent le jeu de
    // gabarits « Gabarits XL » (référentiel + réglages + scène élargie propres) —
    // moteur TERMINUS inchangé pour prompts et réglages.
    const jeu = gabaritSetForSize(moteur, size.w)
    const override = getSizeParamsOverride(`${size.w}x${size.h}`, jeu)
    const refWidth = refWidthFor(jeu)
    const effective = {
      ...(GABARIT_SET_DEFAULTS[jeu] ?? {}),
      ...getGabaritGlobals(jeu),
      ...(opts.params ?? {}),
      ...(override ?? {}),
      // Imposée en dernier : le découplage largeur/hauteur n'est pas dérogeable
      // par taille (sinon on retrouverait un gabarit par largeur).
      ...(refWidth > 0 ? { refWidth } : {}),
    }
    const itemExtra = cleanExtra(extra)
    // N générations indépendantes de la même taille : mêmes réglages, numéro de
    // variante distinct (payload.variant). Une seule génération → pas de champ
    // variant (payload identique au comportement historique, non-régression).
    for (let v = 1; v <= nGen; v++) {
      jobIds.push(
        enqueueNewJob(
          poseFusion && productPath ? 'pose-fusion' : 'pillars',
          {
            decorPath: opts.decorPath,
            size,
            params: effective,
            align: opts.align,
            slug: opts.slug,
            productPath,
            lab: opts.lab || undefined,
            // 'battant' omis du payload (undefined) : les jobs battants restent
            // strictement identiques à avant — non-régression JANUS.
            moteur: moteur === 'battant' ? undefined : moteur,
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
