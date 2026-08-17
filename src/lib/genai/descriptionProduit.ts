import { getVisionModel, getVisionTemplate } from '@/lib/db/settings'
import { generateText } from '@/lib/genai/client'

/**
 * Description PRODUIT par vision (rodage décor autour 07/08/2026) : un modèle
 * vision IMPOSANT (choix Mathias — pas le flash-lite du juge pieds) regarde le
 * PNG détouré et rédige le brief factuel injecté dans le prompt ({PRODUIT}).
 * Appelé UNE fois par (produit, coloris, moteur) — le résultat vit dans la
 * bibliothèque produit_descriptions et est réutilisé ensuite.
 *
 * Modèle ET gabarit du prompt : réglables dans Admin → Réglages → Générations
 * & modèle (07/08 soir) — les valeurs ci-dessous sont les défauts d'usine.
 */

export const PROMPT_DESCRIPTION_DEFAUT = `You are preparing a factual product brief for an image-generation pipeline. The attached image is a cut-out product photo of a driveway gate (or pedestrian gate), seen flat and front-on.

Describe ONLY what is visible, in English, using EXACTLY this structure (one line each, no extra text, no marketing language):
STRUCTURE: [one leaf or two leaves; solid, openwork (describe bars/gaps pattern), or mixed (which zones are solid, which are open)]
FRAME: [material family and colour of the outer frame and posts, e.g. "matte anthracite grey aluminium"]
INFILL: [material family and colour of the panels/slats, e.g. "horizontal slats in warm teak wood-effect finish" — if identical to the frame, say so]
HARDWARE: [handle, lock, hinges, visible accessories and their colour]

Rules: never guess materials you cannot see; if the gate mixes several materials or colours, describe each zone precisely; keep the whole answer under 90 words.`

export interface DescriptionProduitResult {
  description: string
  model: string
}

/** Complément COULISSANT (18/08/2026, chaos EIGER 300×160 jobs 149-153) : le
 *  gabarit d'usine impose « one leaf or two leaves » — un coulissant à montant
 *  central devenait « Two leaves », en contradiction frontale avec le prompt
 *  terminus (« ONE panel, never two leaves ») : Nano tranchait au hasard
 *  (moitié de portail supprimée, deux portails, montant gommé). La fiche ATHOS
 *  TECK renforcée à la main (« structural member of this same single panel »)
 *  prouvait déjà le bon format. Ajouté APRÈS le gabarit (réglé ou d'usine) :
 *  la règle produit vaut quel que soit le texte édité dans l'Admin. */
const ADDENDUM_COULISSANT = `

ADDENDUM — this product is a SLIDING gate: it is ALWAYS "One leaf" — ONE single continuous sliding panel, whatever the photo suggests. If a vertical frame bar divides the panel, describe it as a structural member of this same single panel and state its position PRECISELY as seen in the photo (e.g. "a vertical frame bar slightly right of centre, part of the same single panel") — NEVER as a second leaf, NEVER as a junction between two doors. Never write "two leaves".`

export async function decrireProduit(
  png: Buffer,
  moteur?: string
): Promise<DescriptionProduitResult> {
  const model = getVisionModel()
  const base = getVisionTemplate() ?? PROMPT_DESCRIPTION_DEFAUT
  const prompt = moteur === 'terminus' ? base + ADDENDUM_COULISSANT : base
  const { text } = await generateText({
    prompt,
    images: [{ source: png, mimeType: 'image/png' }],
    model,
  })
  const description = text.trim()
  if (!description) throw new Error('Description produit vide (réponse vision)')
  return { description, model }
}
