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

/**
 * Moments d'application, PAR RÈGLE (demande Mathias 17/08/2026 : « sur chaque
 * RAL, pas un réglage général ») :
 * - avant : correction du PNG produit AVANT l'envoi à Nano (comportement
 *   historique, seul mode jusqu'au 17/08) ;
 * - apres : harmonisation de l'aluminium SUR la MES générée (détection du
 *   produit dans la scène + RALify à masque externe) — validé sur la gamme
 *   EIGER full anthracite, moteurs décor autour uniquement.
 */
export interface RalifyApplication {
  avant: boolean
  apres: boolean
}

/** Avant seul : le comportement historique, défaut de toute règle. */
export const RALIFY_APPLICATION_DEFAUT: RalifyApplication = { avant: true, apres: false }

export interface RalifyRegle {
  traiter: boolean
  /** Couleur cible '#rrggbb' (null = pas de cible → pas de traitement). */
  cible: string | null
  /** Quand corriger CE coloris (avant Nano / après sur la MES). */
  application: RalifyApplication
}

export interface RalifyException {
  /** Fragment recherché dans le nom du produit (insensible à la casse). */
  contient: string
  /** Clé de coloris concernée (null = tous les coloris). */
  coloris: string | null
  traiter: boolean
  cible: string | null
  /** Quand corriger, comme sur les règles (l'exception porte SA décision). */
  application: RalifyApplication
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
  if (known) return `${known.ral} · ${known.label}`
  const code = ralCodeDepuisHex(hex)
  return code ? `RAL ${code}` : hex.toLowerCase()
}

/**
 * Table RAL Classic → hex (07/08 soir, demande Mathias : « j'indique le RAL,
 * ça met la bonne couleur en pastille et basta »). Valeurs = approximations
 * sRGB usuelles, SAUF les codes déjà validés en production (7016 = 67,74,80
 * de RALify_7016, etc.) qui gardent leur teinte éprouvée. Familles couvertes :
 * celles des portails (jaunes/beiges, rouges, bleus, verts, gris, bruns,
 * blancs/noirs, alu).
 */
export const RAL_HEX: Record<string, string> = {
  // — 1000 jaunes / beiges —
  '1000': '#cdba88', '1001': '#d0b084', '1002': '#d2aa6d', '1003': '#f9a800',
  '1004': '#e49e00', '1005': '#cb8e00', '1006': '#e29000', '1007': '#e88c00',
  '1011': '#af8a54', '1013': '#e3d9c6', '1014': '#ddc49a', '1015': '#e6d2b5',
  '1016': '#f1dd38', '1017': '#f6a950', '1018': '#faca30', '1019': '#a48f7a',
  '1020': '#a08f65', '1021': '#f6b600', '1023': '#f7b500', '1024': '#ba8f4c',
  '1027': '#a77f0e', '1028': '#ff9b00', '1032': '#e2a300', '1033': '#f99a1c',
  '1034': '#eb9c52', '1035': '#908370', '1036': '#80643f', '1037': '#f09200',
  // — 3000 rouges —
  '3000': '#af2b1e', '3001': '#a52019', '3002': '#a2231d', '3003': '#9b111e',
  '3004': '#75151e', '3005': '#5e2129', '3007': '#412227', '3009': '#642424',
  '3011': '#781f19', '3012': '#c1876b', '3013': '#a12312', '3014': '#d36e70',
  '3015': '#ea899a', '3016': '#b32821', '3017': '#e63244', '3018': '#d53032',
  '3020': '#cc0605', '3022': '#d95030', '3027': '#c51d34', '3031': '#b32428',
  // — 5000 bleus —
  '5000': '#354d73', '5001': '#1f3438', '5002': '#20214f', '5003': '#1d1e33',
  '5004': '#18171c', '5005': '#1e2460', '5007': '#3e5f8a', '5008': '#26252d',
  '5009': '#025669', '5010': '#0e294b', '5011': '#231a24', '5012': '#3b83bd',
  '5013': '#1e213d', '5014': '#606e8c', '5015': '#2271b3', '5017': '#063971',
  '5018': '#3f888f', '5019': '#1b5583', '5020': '#1d334a', '5021': '#256d7b',
  '5022': '#252850', '5023': '#49678d', '5024': '#5d9b9b',
  // — 6000 verts —
  '6000': '#316650', '6001': '#287233', '6002': '#2d572c', '6003': '#424632',
  '6004': '#1f3a3d', '6005': '#2f4538', '6006': '#3e3b32', '6007': '#343b29',
  '6009': '#31372b', '6011': '#587246', '6012': '#343e40', '6013': '#6c7156',
  '6015': '#3b3c36', '6016': '#1e5945', '6017': '#4c9141', '6018': '#57a639',
  '6019': '#bdecb6', '6020': '#2e3a23', '6021': '#89ac76', '6024': '#308446',
  '6025': '#3d642d', '6026': '#015d52', '6028': '#20603d', '6029': '#005f38',
  '6032': '#237f52', '6033': '#45877f', '6034': '#7aacac', '6035': '#194d25',
  '6036': '#04574b', '6037': '#008f39', '6038': '#00bb2d',
  // — 7000 gris —
  '7000': '#78858b', '7001': '#8a9597', '7002': '#7e7b52', '7003': '#6c7059',
  '7004': '#969992', '7005': '#646b63', '7006': '#6d6552', '7008': '#6a5f31',
  '7009': '#4d5645', '7010': '#4c514a', '7011': '#434b4d', '7012': '#4e5754',
  '7013': '#464531', '7015': '#434750', '7016': '#434a50', '7021': '#2e3238',
  '7022': '#4b4d46', '7023': '#818479', '7024': '#474a51', '7026': '#374447',
  '7030': '#939388', '7031': '#5d6970', '7032': '#b9b9a8', '7033': '#818979',
  '7034': '#939176', '7035': '#c5c7c4', '7036': '#7d8471', '7037': '#7f7679',
  '7038': '#b5b8b1', '7039': '#6c6960', '7040': '#9da1aa', '7042': '#8d948d',
  '7043': '#4e5452', '7044': '#cac4b0', '7045': '#909090', '7046': '#82898f',
  '7047': '#d0d0d0', '7048': '#898176',
  // — 8000 bruns —
  '8000': '#826c34', '8001': '#955f20', '8002': '#6c3b2a', '8003': '#734222',
  '8004': '#8e402a', '8007': '#59351f', '8008': '#6f4f28', '8011': '#5b3a29',
  '8012': '#592321', '8014': '#382c1e', '8015': '#633a34', '8016': '#4c2f27',
  '8017': '#45322e', '8019': '#403a3a', '8022': '#212121', '8023': '#a65e2e',
  '8024': '#79553d', '8025': '#755c48', '8028': '#4e3b31',
  // — 9000 blancs / noirs / alu —
  '9001': '#fdf4e3', '9002': '#e7ebda', '9003': '#f4f4f4', '9004': '#282828',
  '9005': '#0e0e10', '9006': '#a5a5a5', '9007': '#8f8f8f', '9010': '#f1ece1',
  '9011': '#1c1c1c', '9016': '#f1f0ea', '9017': '#1e1e1e', '9018': '#d7d7d7',
  '9022': '#9c9c9c', '9023': '#828282',
}

/** Hex d'un code RAL saisi (« 7016 », « RAL 7016 ») — null si inconnu. */
export function ralHexDepuisCode(code: string): string | null {
  const m = code.trim().match(/^(?:RAL\s*)?(\d{4})$/i)
  return m ? (RAL_HEX[m[1]] ?? null) : null
}

/** Code RAL correspondant à un hex de la table — null si hors table. */
export function ralCodeDepuisHex(hex: string | null): string | null {
  if (!hex) return null
  const h = hex.toLowerCase()
  for (const [code, v] of Object.entries(RAL_HEX)) if (v === h) return code
  return null
}

export const RALIFY_DEFAUTS: RalifyReglages = {
  // ACTIVÉ par défaut — validation Mathias du 28/07/2026 (démos ARLBERG/EIGER).
  // Application : avant seul par défaut — l'« après » (post-MES) s'active RAL
  // par RAL dans l'admin (décision Mathias 17/08).
  actif: true,
  intensite: 100,
  regles: {
    gris: { traiter: true, cible: '#434a50', application: { ...RALIFY_APPLICATION_DEFAUT } }, // RAL 7016
    noir: { traiter: true, cible: '#0e0e10', application: { ...RALIFY_APPLICATION_DEFAUT } }, // RAL 9005
    blanc: { traiter: true, cible: '#f1f0ea', application: { ...RALIFY_APPLICATION_DEFAUT } }, // RAL 9016
    teck: { traiter: false, cible: null, application: { ...RALIFY_APPLICATION_DEFAUT } }, // bois : pas de RAL
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
  // Application d'une règle/exception : absent (config d'avant le 17/08) =
  // avant seul, le comportement historique ; l'après doit être explicite.
  const application = (raw: unknown): RalifyApplication => {
    if (typeof raw !== 'object' || raw === null) return { ...RALIFY_APPLICATION_DEFAUT }
    const a = raw as Record<string, unknown>
    return { avant: a.avant !== false, apres: a.apres === true }
  }
  if (typeof src.regles === 'object' && src.regles !== null) {
    for (const [key, val] of Object.entries(src.regles as Record<string, unknown>)) {
      if (Object.keys(out.regles).length >= 50) break
      const k = key.trim().toLowerCase()
      if (!k || k.length > 40 || typeof val !== 'object' || val === null) continue
      const r = val as Record<string, unknown>
      const cible = isHexColor(r.cible) ? r.cible.toLowerCase() : null
      out.regles[k] = {
        traiter: r.traiter === true && cible !== null,
        cible,
        application: application(r.application),
      }
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
      out.exceptions.push({
        contient,
        coloris,
        traiter: e.traiter === true && cible !== null,
        cible,
        application: application(e.application),
      })
    }
  }
  return out
}

export interface RalifyDecision {
  /** Hex '#rrggbb', ou null = ne pas toucher. */
  cible: string | null
  /** La règle qui a tranché, en clair (affichée par le testeur de l'encart). */
  raison: string
  /** Moments d'application de la règle qui a tranché (avant / après). */
  application: RalifyApplication
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
  const aucun = { ...RALIFY_APPLICATION_DEFAUT }
  if (!reglages.actif) return { cible: null, raison: 'RALify désactivé', application: aucun }
  const key = colorisKeyRalify(coloris)
  const name = productName.toLowerCase()
  for (const ex of reglages.exceptions) {
    if (!name.includes(ex.contient.toLowerCase())) continue
    if (ex.coloris && ex.coloris !== key) continue
    const raison = `Exception « ${ex.contient} »${ex.coloris ? ` · ${ex.coloris}` : ' · tous coloris'}`
    return ex.traiter && ex.cible
      ? { cible: ex.cible, raison, application: ex.application ?? aucun }
      : { cible: null, raison, application: aucun }
  }
  if (!key) return { cible: null, raison: 'Coloris non reconnu', application: aucun }
  const regle = reglages.regles[key]
  if (regle && regle.traiter && regle.cible) {
    return {
      cible: regle.cible,
      raison: `Règle générale · ${key}`,
      application: regle.application ?? aucun,
    }
  }
  return { cible: null, raison: `Règle générale · ${key} : ne pas toucher`, application: aucun }
}

/** Raccourci : la cible seule (pipeline). */
export function resolveRalifyCible(
  reglages: RalifyReglages,
  productName: string,
  coloris?: string | null
): string | null {
  return resolveRalifyDecision(reglages, productName, coloris).cible
}
