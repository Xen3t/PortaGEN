/**
 * RALify — harmonisation colorimétrique des PNG produit (chantier 28/07/2026,
 * maquette ralify-v2 validée le 28/07/2026, d'après le space HF Xenet/RALify_7016
 * de Mathias). Les PNG fournisseur n'ont pas tous le même traitement couleur :
 * sur les MES, un même RAL ressort tantôt bleuté, tantôt délavé. RALify corrige
 * le PNG EN AMONT de la génération (avant l'envoi à Nano).
 *
 * Module PUR (pas de sharp) : types, palette de cibles RAL, validation de la
 * config et résolution de la règle applicable — importable côté client (encart
 * Admin) comme côté serveur. Le traitement d'image vit dans
 * src/lib/images/ralify.ts.
 *
 * Config PAR MOTEUR (portée par MoteurReglages.ralify, jamais partagée) :
 * - règle générale par coloris détecté (gris → RAL 7016, noir → 9005,
 *   blanc → 9016 — décision Mathias 28/07 —, teck = bois, jamais traité) ;
 * - exceptions par nom de produit (autre RAL, ou pas de traitement) ;
 * - intensité globale (100 % = teinte exactement au RAL cible).
 */

export interface RalifyRegle {
  traiter: boolean
  /** Couleur cible '#rrggbb' (null = pas de cible → pas de traitement). */
  cible: string | null
}

export interface RalifyException {
  /** Fragment recherché dans le nom du produit (insensible à la casse). */
  contient: string
  /** Clé de coloris concernée (null = tous les coloris). */
  coloris: string | null
  traiter: boolean
  cible: string | null
}

export interface RalifyReglages {
  actif: boolean
  /** Force de la correction, 0-100 (%). */
  intensite: number
  /** Règle générale, par clé de coloris ('gris', 'noir'…). */
  regles: Record<string, RalifyRegle>
  /** Les exceptions priment sur la règle générale (première qui matche gagne). */
  exceptions: RalifyException[]
}

/** Cibles RAL proposées dans l'encart (hex = teinte de référence du RAL). */
export const RAL_CIBLES: ReadonlyArray<{ ral: string; label: string; hex: string }> = [
  // RGB 67,74,80 : la valeur 7016 validée de longue date dans RALify_7016.
  { ral: 'RAL 7016', label: 'gris anthracite', hex: '#434a50' },
  { ral: 'RAL 7021', label: 'gris noir', hex: '#2e3238' },
  { ral: 'RAL 7035', label: 'gris clair', hex: '#c5c7c4' },
  { ral: 'RAL 9005', label: 'noir foncé', hex: '#0e0e10' },
  { ral: 'RAL 9011', label: 'noir graphite', hex: '#1c1c1c' },
  { ral: 'RAL 9016', label: 'blanc signalisation', hex: '#f1f0ea' },
  { ral: 'RAL 9010', label: 'blanc pur', hex: '#f1ece1' },
]

/** Libellé d'une cible ('RAL 7016 · gris anthracite', ou l'hex si hors palette). */
export function ralCibleLabel(hex: string | null): string {
  if (!hex) return 'Ne pas toucher'
  const known = RAL_CIBLES.find((c) => c.hex.toLowerCase() === hex.toLowerCase())
  return known ? `${known.ral} · ${known.label}` : hex.toLowerCase()
}

export const RALIFY_DEFAUTS: RalifyReglages = {
  // ACTIVÉ par défaut — validation Mathias du 28/07/2026 (démos ARLBERG/EIGER).
  actif: true,
  intensite: 100,
  regles: {
    gris: { traiter: true, cible: '#434a50' }, // RAL 7016
    noir: { traiter: true, cible: '#0e0e10' }, // RAL 9005
    blanc: { traiter: true, cible: '#f1f0ea' }, // RAL 9016
    teck: { traiter: false, cible: null }, // bois : pas de RAL
  },
  exceptions: [],
}

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
}

/**
 * Clé canonique de coloris pour RALify — mêmes tolérances que le reste de l'app
 * (colorisPromptDescription, swatchFor) : le coloris arrive parfois en clé
 * ('gris'), parfois en libellé libre lu dans un nom de fichier ('Gris anthracite
 * RAL 7016'). Coloris personnalisé : sa clé/son libellé en minuscules.
 */
export function colorisKeyRalify(coloris?: string | null): string | null {
  const c = (coloris ?? '').trim()
  if (!c) return null
  const u = c.toUpperCase()
  if (u.includes('TECK') || u.includes('BOIS')) return 'teck'
  if (u.includes('GRIS') || u.includes('ANTHRACITE') || u.includes('7016')) return 'gris'
  if (u.includes('NOIR') || u.includes('9005')) return 'noir'
  if (u.includes('BLANC')) return 'blanc'
  return c.toLowerCase()
}

/** Valide et normalise une config RALify (undefined = pas un objet → rejet). */
export function sanitizeRalify(input: unknown): RalifyReglages | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const src = input as Record<string, unknown>
  const out: RalifyReglages = { actif: false, intensite: 100, regles: {}, exceptions: [] }
  out.actif = src.actif === true
  if (typeof src.intensite === 'number' && Number.isFinite(src.intensite)) {
    out.intensite = Math.min(100, Math.max(0, Math.round(src.intensite)))
  }
  if (typeof src.regles === 'object' && src.regles !== null) {
    for (const [key, val] of Object.entries(src.regles as Record<string, unknown>)) {
      if (Object.keys(out.regles).length >= 50) break
      const k = key.trim().toLowerCase()
      if (!k || k.length > 40 || typeof val !== 'object' || val === null) continue
      const r = val as Record<string, unknown>
      const cible = isHexColor(r.cible) ? r.cible.toLowerCase() : null
      out.regles[k] = { traiter: r.traiter === true && cible !== null, cible }
    }
  }
  if (Array.isArray(src.exceptions)) {
    for (const val of src.exceptions.slice(0, 100)) {
      if (typeof val !== 'object' || val === null) continue
      const e = val as Record<string, unknown>
      const contient = typeof e.contient === 'string' ? e.contient.trim() : ''
      if (!contient || contient.length > 80) continue
      const coloris =
        typeof e.coloris === 'string' && e.coloris.trim()
          ? e.coloris.trim().toLowerCase().slice(0, 40)
          : null
      const cible = isHexColor(e.cible) ? e.cible.toLowerCase() : null
      out.exceptions.push({ contient, coloris, traiter: e.traiter === true && cible !== null, cible })
    }
  }
  return out
}

export interface RalifyDecision {
  /** Hex '#rrggbb', ou null = ne pas toucher. */
  cible: string | null
  /** La règle qui a tranché, en clair (affichée par le testeur de l'encart). */
  raison: string
}

/**
 * Cible applicable à un produit, avec la règle qui a tranché. Ordre : désactivé
 * → null ; première exception qui matche (nom + coloris) ; sinon règle générale
 * du coloris détecté.
 */
export function resolveRalifyDecision(
  reglages: RalifyReglages,
  productName: string,
  coloris?: string | null
): RalifyDecision {
  if (!reglages.actif) return { cible: null, raison: 'RALify désactivé' }
  const key = colorisKeyRalify(coloris)
  const name = productName.toLowerCase()
  for (const ex of reglages.exceptions) {
    if (!name.includes(ex.contient.toLowerCase())) continue
    if (ex.coloris && ex.coloris !== key) continue
    const raison = `Exception « ${ex.contient} »${ex.coloris ? ` · ${ex.coloris}` : ' · tous coloris'}`
    return ex.traiter && ex.cible ? { cible: ex.cible, raison } : { cible: null, raison }
  }
  if (!key) return { cible: null, raison: 'Coloris non reconnu' }
  const regle = reglages.regles[key]
  if (regle && regle.traiter && regle.cible) {
    return { cible: regle.cible, raison: `Règle générale · ${key}` }
  }
  return { cible: null, raison: `Règle générale · ${key} : ne pas toucher` }
}

/** Raccourci : la cible seule (pipeline). */
export function resolveRalifyCible(
  reglages: RalifyReglages,
  productName: string,
  coloris?: string | null
): string | null {
  return resolveRalifyDecision(reglages, productName, coloris).cible
}
