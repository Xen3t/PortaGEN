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

/** Règles COMMUNES du paragraphe d'ambiance — partagées par la réécriture
 *  simple, la création « en une phrase » et la modification par consigne
 *  (bibliothèque 17/08). Le « vu de face » est verrouillé ICI : un décor
 *  custom ne peut pas introduire de perspective.
 *  Règle Mathias 17/08 soir (« voyons simple ») : on ne décrit que CE QUI
 *  DÉPASSE du portail/muret — jamais le sol (jardin, pelouse, allée). Décrire
 *  un monde complet invisible poussait Nano à altérer le produit pour le
 *  montrer (perçage puis rétrécissement, sessions banc-msxgayzw/msxmzlbt). */
const REGLES_SCENERY = `Rules for the scenery paragraph (ONE short polished English paragraph):
- correct mistakes, translate to English, keep every explicit wish;
- the gate and its boundary wall hide almost everything behind them: describe only what shows ABOVE them — typically the upper part of a house peeking from behind the gate, some treetops, the sky and its light. NEVER describe gardens, lawns, driveways, paths or anything at ground level: it is hidden anyway, and describing it pushes the image model to alter the product to show it;
- scenery ONLY: never mention the gate, the product, pillars, walls, sidewalk, camera, framing, perspective or image edits — other parts of the prompt handle all of that;
- if a house or building belongs to the scene, it PEEKS FROM BEHIND the gate, set back, seen perfectly front-on (facade parallel to the image plane) — never at an angle; every scenery element faces the viewer head-on;
- any house is ALWAYS a two-storey home — a ground floor plus one upper floor — say it explicitly (e.g. "a two-storey house"); never a single-storey bungalow, never three storeys or more, even if the user implies otherwise;
- if the user asks for an angled, three-quarter or side view, IGNORE that part — everything stays strictly front-on;
- end with: "Realistic materials, fine detail, photorealistic."
- keep it under 80 words.`

const CONTEXTE = `You are writing the SCENERY paragraph of an image-generation prompt. The image shows a driveway gate (or pedestrian gate) in strict front elevation; the scenery is painted around it. The user describes the scenery they want, in their own words (any language, possibly telegraphic or misspelled).`

const INSTRUCTION = `${CONTEXTE}

${REGLES_SCENERY}

Answer with the paragraph only — no title, no quotes, no commentary.

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

/** Réponse JSON du modèle, avec ou sans clôture \`\`\`json. */
function parseJson<T>(text: string): T {
  const brut = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  return JSON.parse(brut) as T
}

const INSTRUCTION_CREATION = `${CONTEXTE}

From the user's idea below, produce:
1. "nom" — a short display name for this scenery, in FRENCH, max 40 characters, no quotes (e.g. "Mas provençal", "Pavillon contemporain");
2. "scenery" — the scenery paragraph.

${REGLES_SCENERY}

Answer with STRICT JSON only: {"nom": "...", "scenery": "..."} — no commentary.

User's scenery idea:
`

export interface DecorCreationIaResult {
  nom: string
  prompt: string
  model: string
}

/** Création « en une phrase » (bibliothèque 17/08) : une idée → nom + prompt. */
export async function creerDecorDepuisIdee(idee: string): Promise<DecorCreationIaResult> {
  const model = getVisionModel()
  const { text } = await generateText({ prompt: INSTRUCTION_CREATION + idee.trim(), model })
  const data = parseJson<{ nom?: string; scenery?: string }>(text)
  const nom = (data.nom ?? '').trim().slice(0, 60)
  const prompt = (data.scenery ?? '').trim()
  if (!nom || !prompt) throw new Error('Réponse de création de décor incomplète (nom ou texte vide)')
  return { nom, prompt, model }
}

const INSTRUCTION_CONSIGNE = `${CONTEXTE}

The user already has a scenery. They now give an ADJUSTMENT instruction (any language). Apply it and produce:
1. "texte" — the updated scenery description in FRENCH, compact, faithful to what the scenery now contains (this is the text the user will read and edit later);
2. "scenery" — the updated scenery paragraph.

${REGLES_SCENERY}

Answer with STRICT JSON only: {"texte": "...", "scenery": "..."} — no commentary.

Current scenery description:
`

export interface DecorConsigneIaResult {
  texte: string
  prompt: string
  model: string
}

/** Modification par consigne (bibliothèque 17/08) : texte actuel + consigne →
 *  texte humain mis à jour + prompt réécrit, cohérents entre eux. */
export async function modifierDecorParConsigne(
  texteActuel: string,
  consigne: string
): Promise<DecorConsigneIaResult> {
  const model = getVisionModel()
  const { text } = await generateText({
    prompt: `${INSTRUCTION_CONSIGNE}${texteActuel.trim()}\n\nAdjustment instruction:\n${consigne.trim()}`,
    model,
  })
  const data = parseJson<{ texte?: string; scenery?: string }>(text)
  const texte = (data.texte ?? '').trim().slice(0, 4000)
  const prompt = (data.scenery ?? '').trim()
  if (!texte || !prompt) throw new Error('Réponse de modification de décor incomplète')
  return { texte, prompt, model }
}
