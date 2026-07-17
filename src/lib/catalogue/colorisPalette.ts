/**
 * Palette de coloris CASANOOV (donnée par Mathias 12/07/2026) — module PUR,
 * sans dépendance serveur (sharp), pour être importable côté client (menu
 * déroulant du titre de coloris sur la fiche) comme côté serveur (détection).
 *
 * Gris = RAL 7016, Noir = RAL 9005, Blanc, plus le Teck (bois composite, ATHOS).
 */

export interface ColorisDef {
  key: string
  label: string
  ral: string | null
  /** Pastille d'affichage (proche du rendu réel, pas le RAL brut). */
  swatch: string
}

export const CANONICAL_COLORIS: ReadonlyArray<ColorisDef> = [
  { key: 'gris', label: 'Gris', ral: 'RAL 7016', swatch: '#4a4d52' },
  { key: 'blanc', label: 'Blanc', ral: null, swatch: '#fdfdfd' },
  { key: 'noir', label: 'Noir', ral: 'RAL 9005', swatch: '#1f2937' },
  { key: 'teck', label: 'Teck', ral: null, swatch: '#a37c62' },
]

/** Retrouve un coloris par sa clé OU son libellé (insensible à la casse). */
export function colorisDef(keyOrLabel: string): ColorisDef | undefined {
  const q = keyOrLabel.trim().toLowerCase()
  return CANONICAL_COLORIS.find((c) => c.key === q || c.label.toLowerCase() === q)
}

/** Pastille couleur d'un libellé de coloris quelconque (tolérant aux variantes). */
export function swatchFor(coloris: string): string {
  const n = coloris.toUpperCase()
  if (n.includes('TECK') || n.includes('BOIS')) return '#a37c62'
  if (n.includes('GRIS') || n.includes('ANTHRACITE')) return '#4a4d52'
  if (n.includes('BLANC')) return '#fdfdfd'
  if (n.includes('NOIR')) return '#1f2937'
  if (n.includes('BEIGE')) return '#d8c9a3'
  return '#9ca3af'
}
