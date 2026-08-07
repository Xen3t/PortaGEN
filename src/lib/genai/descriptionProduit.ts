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

export async function decrireProduit(png: Buffer): Promise<DescriptionProduitResult> {
  const model = getVisionModel()
  const prompt = getVisionTemplate() ?? PROMPT_DESCRIPTION_DEFAUT
  const { text } = await generateText({
    prompt,
    images: [{ source: png, mimeType: 'image/png' }],
    model,
  })
  const description = text.trim()
  if (!description) throw new Error('Description produit vide (réponse vision)')
  return { description, model }
}
