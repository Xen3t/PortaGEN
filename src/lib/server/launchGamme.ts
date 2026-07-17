import { enqueueNewJob } from '@/lib/server/runner'
import { getGabaritGlobals, getSizeParamsOverride, type SizeParamsOverride } from '@/lib/db/sizeParams'
import type { MoteurKey } from '@/lib/moteurs'

/**
 * Cœur PARTAGÉ du lancement d'une gamme (factorisé le 12/07/2026, bloc 3.1).
 *
 * Un lancement = un GROUPE (batch_id) : un job Piliers par taille ; si l'item
 * porte une image produit, le runner enchaîne l'Intégration automatiquement.
 * Réglages de gabarit fusionnés dans l'ordre : défauts du code < globaux (page
 * Gabarits) < paramètres d'appel < dérogation par taille.
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
  const globals = getGabaritGlobals(moteur)
  const jobIds = opts.items.map(({ size, productPath, extra }) => {
    const override = getSizeParamsOverride(`${size.w}x${size.h}`, moteur)
    const effective = { ...globals, ...(opts.params ?? {}), ...(override ?? {}) }
    return enqueueNewJob(
      'pillars',
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
        ...opts.extra,
        ...extra,
      },
      batchId,
      opts.createdBy
    )
  })
  return { jobIds, batchId }
}
