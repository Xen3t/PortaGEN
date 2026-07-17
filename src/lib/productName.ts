/**
 * Nomenclature produit interne : la taille est encodée dans le nom de fichier
 * (ex. « VALIER-300B140_FRONT-BLACK_WEB_KIT-000814.png » → 300×140 cm,
 * « PRIEL 200H90 TECK … » → 200×90 cm). Module pur — utilisable côté client.
 */
export function parseSizeFromProductName(fileName: string): { w: number; h: number } | null {
  const match = fileName.toUpperCase().match(/(\d{3})\s*[A-Z]\s*(\d{2,3})/)
  if (!match) return null
  const w = Number(match[1])
  const h = Number(match[2])
  if (w < 80 || w > 500 || h < 60 || h > 250) return null
  return { w, h }
}

/**
 * Nom du produit depuis le nom de fichier (« VALIER-300B140_FRONT-BLACK… » →
 * VALIER) : premier mot alphabétique qui n'est ni un coloris ni un mot
 * technique. Détection CORRIGEABLE — nomme la session de génération directe
 * (sessions, 13/07/2026). Utilisé côté client (pré-remplissage du champ
 * Produit) ET côté serveur (filet si le champ arrive vide).
 */
const PRODUIT_NOISE =
  /^(FRONT|BACK|SIDE|WEB|MP|MES|IMAGE|IMG|PHOTO|STW|KIT|PORTAIL|PORTILLON|BATTANT|COULISSANT|BLANC|WHITE|NOIR|BLACK|GRIS|GREY|GRAY|TECK|TEAK|BOIS|RAL)$/
export function parseProduitFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '')
  for (const tok of base.toUpperCase().split(/[^A-ZÀ-Ÿ]+/)) {
    if (tok.length < 3 || PRODUIT_NOISE.test(tok)) continue
    return tok
  }
  return ''
}
