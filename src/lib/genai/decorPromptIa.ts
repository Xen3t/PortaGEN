import { getVisionModel } from '@/lib/db/settings'
import { generateText } from '@/lib/genai/client'

/**
 * AMÉLIORATION LLM du texte de décor (08/08/2026, exigence Mathias : « il faut
 * un LLM qui va améliorer, ramifier, corriger le prompt humain. C'est
 * obligatoire ») : l'utilisateur écrit son idée d'ambiance librement (français
 * ou anglais, télégraphique ou pas) — un modèle texte la corrige, l'enrichit de
 * détails cohérents et la met au format attendu par le prompt décor autour.
 * C'est la VERSION IA qui remplit {DECOR} ; le texte humain reste stocké et
 * affiché (c'est lui qu'on réédite).
 *
 * Modèle : celui du réglage « vision (descriptions) » d'Admin → Réglages —
 * un seul réglage de modèle imposant pour tout le rodage décor autour.
 */

const INSTRUCTION = `You are writing the SCENERY paragraph of an image-generation prompt. The image shows a driveway gate (or pedestrian gate) in strict front elevation; the scenery is painted around it. The user describes the scenery they want, in their own words (any language, possibly telegraphic or misspelled).

Rewrite their idea as ONE polished English paragraph:
- correct mistakes, translate to English, keep every explicit wish;
- enrich it with a few coherent concrete details (vegetation, ground materials, sky, light) in the same spirit — do not invent a different setting;
- scenery ONLY: never mention the gate, the product, pillars, walls, sidewalk, camera, framing, perspective or image edits — other parts of the prompt handle all of that;
- if a house or building belongs to the scene, describe it set back from the entrance and seen perfectly front-on (facade parallel to the image plane) — never at an angle;
- end with: "Realistic materials, fine detail, photorealistic."

Answer with the paragraph only — no title, no quotes, no commentary. Keep it under 120 words.

User's scenery idea:
`

export interface DecorPromptIaResult {
  prompt: string
  model: string
}

export async function ameliorerDecorPrompt(texteHumain: string): Promise<DecorPromptIaResult> {
  const model = getVisionModel()
  const { text } = await generateText({ prompt: INSTRUCTION + texteHumain.trim(), model })
  const prompt = text.trim()
  if (!prompt) throw new Error('Réécriture du décor vide (réponse du modèle)')
  return { prompt, model }
}
