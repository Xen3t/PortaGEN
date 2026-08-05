/**
 * Générations multiples par taille (29/07/2026, demande Mathias « tripler les
 * générations »). Une taille lance N MES indépendantes — les VARIANTES. Elles
 * partagent le même lot (batch), la même taille et le même coloris ; leur numéro
 * est dans payload.variant (1..N). L'utilisateur en CHOISIT une (chosen = 1 en
 * base) : c'est la MES retenue de la taille, la seule qui passe en Marketplace.
 *
 * Ce module est PUR (aucun accès base) : partagé entre la couche serveur (API de
 * choix) et les grilles React (regroupement d'affichage). Il raisonne sur la
 * forme minimale d'un job MES telle que sérialisée pour l'interface.
 */

export interface MesVariantJob {
  id: number
  type: string
  /** Retenue de sa taille (colonne `chosen` en base) — absente sur les vieux jobs. */
  chosen?: boolean
  payload: {
    coloris?: string
    size?: { w: number; h: number }
    /** Numéro de génération (1..N) — absent = 1 (lancement à une seule génération). */
    variant?: number
  } | null
}

/**
 * Un job porte-t-il la MES finale ? Intégration classique ou « pose-fusion »
 * (chantier 17/07/2026, un seul job décor+aplats+produit). Les retouches
 * (`mes-fix`), piliers et Marketplace ne sont PAS des variantes.
 */
export function isMesRoot(type: string): boolean {
  return type === 'integration' || type === 'pose-fusion'
}

/** Numéro de génération d'un job (1 par défaut, lancement mono-génération). */
export function variantNo(j: MesVariantJob): number {
  const v = j.payload?.variant
  return typeof v === 'number' && v >= 1 ? v : 1
}

/**
 * Clé de la « case » d'une taille : coloris + taille. Toutes les variantes d'une
 * même taille/coloris partagent cette clé — c'est le regroupement d'une case de
 * la grille et l'unité du choix.
 */
export function slotKeyOf(j: MesVariantJob): string {
  const col = (j.payload?.coloris ?? '').toLowerCase()
  const w = j.payload?.size?.w
  const h = j.payload?.size?.h
  return `${col}|${w ?? '?'}x${h ?? '?'}`
}

/**
 * Regroupe les MES d'un lot par case (taille/coloris). Chaque valeur = les
 * variantes de la case, triées par numéro de génération (puis id). N'inclut que
 * les jobs MES racines (pas les retouches).
 */
export function groupMesSlots<T extends MesVariantJob>(jobs: T[]): Map<string, T[]> {
  const slots = new Map<string, T[]>()
  for (const j of jobs) {
    if (!isMesRoot(j.type)) continue
    const k = slotKeyOf(j)
    if (!slots.has(k)) slots.set(k, [])
    slots.get(k)!.push(j)
  }
  for (const list of slots.values()) {
    list.sort((a, b) => variantNo(a) - variantNo(b) || a.id - b.id)
  }
  return slots
}

/**
 * Variante à AFFICHER pour une case : la retenue (chosen), sinon la 1ʳᵉ
 * génération. `variants` est supposé trié (groupMesSlots le garantit).
 */
export function displayVariant<T extends MesVariantJob>(variants: T[]): T | undefined {
  return variants.find((v) => v.chosen) ?? variants[0]
}

/** Les sœurs d'une variante = les autres variantes de sa case (elle comprise). */
export function siblingVariants<T extends MesVariantJob>(jobs: T[], job: T): T[] {
  if (!isMesRoot(job.type)) return [job]
  const k = slotKeyOf(job)
  return jobs.filter((j) => isMesRoot(j.type) && slotKeyOf(j) === k)
}
