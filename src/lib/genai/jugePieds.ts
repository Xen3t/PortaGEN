import sharp from 'sharp'
import { getDb } from '@/lib/db'
import { generateText } from '@/lib/genai/client'

/**
 * Juge vision « pieds » (29/07/2026) : certains produits n'ont PAS de pieds de
 * soutien sous leurs montants (VALIER : gonds seulement) — pour eux, la
 * réparation de bande basse de `nettoyerProduit` reboucherait le sol studio en
 * matière (tas de pixels clairs sous le produit) et le prompt pose-fusion
 * ordonnerait de préserver des pieds inexistants.
 *
 * Un modèle vision regarde le PNG détouré SEUL (une image, un appel « texte »)
 * et tranche. Validé le 29/07 sur ATHOS (oui) et VALIER (non), 3/3 dès le
 * modèle le moins cher — on reste dessus.
 */
const JUGE_PIEDS_MODEL = 'gemini-3.5-flash-lite'

const PROMPT_JUGE_PIEDS = `You see the isolated product photo of an aluminium gate (swing gate), cut out on a white background.

Question: does this gate have SUPPORT FEET — small plates, blocks or adjustable pads placed UNDER the gate's outer vertical posts, on which the posts REST on the ground?

Careful distinctions:
- Hinges or hinge brackets mounted on the SIDE of the posts (to attach the gate to pillars) are NOT support feet.
- A small central ground stop between the two leaves is NOT a support foot.
- Only elements UNDER the outer posts, acting as a base/foot, count.

Answer with STRICT JSON ONLY (no markdown):
{"pieds": true|false, "justification": "one short sentence in French"}`

export interface VerdictPieds {
  pieds: boolean
  justification: string
}

/**
 * Juge le PNG détouré fourni (chemin ou buffer). Une seule image envoyée,
 * aplatie sur fond blanc et réduite — coût ≈ 1 250 tokens d'entrée.
 * Toute erreur remonte à l'appelant (qui choisit son repli).
 */
export async function jugerPiedsProduit(
  produit: Buffer | string,
  jobId?: number
): Promise<VerdictPieds> {
  const image = await sharp(produit, { limitInputPixels: false })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize({ width: 1024, withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer()
  const { text } = await generateText({
    prompt: PROMPT_JUGE_PIEDS,
    images: [{ source: image, mimeType: 'image/jpeg' }],
    model: JUGE_PIEDS_MODEL,
    jobId,
  })
  const v = JSON.parse(text.replace(/```json|```/g, '').trim()) as VerdictPieds
  if (typeof v.pieds !== 'boolean') throw new Error(`Verdict pieds illisible : ${text.slice(0, 120)}`)
  return v
}

/**
 * Drapeau pieds d'un produit du CATALOGUE : lit la base, et au premier besoin
 * (NULL) fait juger le PNG fourni puis enregistre le verdict — une fois pour
 * toutes. En cas d'erreur du juge : true (comportement historique), sans
 * enregistrement (on rejugera la prochaine fois).
 */
export async function piedsProduitCatalogue(
  productId: number,
  produit: Buffer | string,
  jobId?: number
): Promise<boolean> {
  const db = getDb()
  const row = db.prepare('SELECT pieds FROM catalog_products WHERE id = ?').get(productId) as
    | { pieds: number | null }
    | undefined
  if (!row) return piedsProduitLibre(produit, jobId)
  if (row.pieds !== null) return row.pieds === 1
  try {
    const verdict = await jugerPiedsProduit(produit, jobId)
    db.prepare('UPDATE catalog_products SET pieds = ? WHERE id = ?').run(
      verdict.pieds ? 1 : 0,
      productId
    )
    return verdict.pieds
  } catch {
    return true
  }
}

/**
 * Drapeau pieds d'une image LIBRE (pas de fiche catalogue) : jugée à chaque
 * rendu, rien n'est enregistré. Erreur du juge → true (comportement historique).
 */
export async function piedsProduitLibre(produit: Buffer | string, jobId?: number): Promise<boolean> {
  try {
    return (await jugerPiedsProduit(produit, jobId)).pieds
  } catch {
    return true
  }
}
