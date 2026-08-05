import sharp from 'sharp'
import { generateText } from '@/lib/genai/client'
import type { RectPx } from '@/lib/geometry'

/**
 * Mesure de l'OUVERTURE réelle entre piliers (30/07/2026) — moteur BATTANT,
 * circuit « intégration 2 étapes ».
 *
 * Problème : à l'étape 1 Nano peint la scène (piliers en stuc), mais leur largeur
 * et leur position ne collent pas toujours au gabarit. Posé à la largeur/position
 * géométrique, le portail laissait un jour ou débordait sur les piliers (constat
 * Mathias 30/07 sur la gamme 350).
 *
 * PARADE (validée Mathias 30/07) : on ne fait PLUS confiance au gabarit pour la
 * largeur — on lit les vrais piliers. UN appel vision `gemini-3.5-flash` mesure
 * sur la scène finie (portail encore absent) :
 *  - `gauche` : face intérieure du pilier gauche (fraction de largeur d'image) ;
 *  - `droite` : face intérieure du pilier droit ;
 *  - `centre` : centre de l'espace entre les piliers.
 * Flash s'est montré redoutablement précis là-dessus (gamme 350 : faces à ±40 px,
 * centre à ±3 px) — bien mieux que le flash-lite du juge pieds.
 *
 * La pose (voir `poserDeuxVantaux`) place le montant central du portail sur le
 * `centre` mesuré, et étire CHAQUE vantail jusqu'à sa face ± une marge de
 * recouvrement (MARGE_FRAC) qui fait mordre légèrement le portail sur les piliers
 * (aucun jour au raccord). Ainsi une ouverture décentrée ou de largeur inattendue
 * est absorbée automatiquement.
 *
 * SANS juge (demande Mathias). Toute erreur / mesure invraisemblable → repli sur
 * le gabarit (cible géométrique).
 */
const MODEL_OUVERTURE = 'gemini-3.5-flash'

/**
 * Marge de recouvrement sur les piliers, en fraction de la largeur d'image :
 * chaque bord du portail dépasse la face mesurée de MARGE_FRAC vers l'extérieur
 * (≈ 30 px sur une scène 4K de 5056 px de large) → jamais de jour au contact
 * portail/pilier. Réglable en Admin plus tard si besoin.
 */
const MARGE_FRAC = 30 / 5056

/**
 * Garde-fou anti-hallucination : chaque valeur mesurée (faces, centre) est bornée
 * à ±TOL_FRAC de sa position géométrique. Une mesure aberrante ne peut donc pas
 * envoyer le portail n'importe où.
 */
const TOL_FRAC = 0.1

const PROMPT_OUVERTURE = `You see a photo of a residential driveway entrance: two masonry pillars (rendered stucco posts) stand on the ground with an EMPTY opening between them, where a gate will later be installed. Low walls (murets) may extend sideways from the pillars — ignore them.

Report, as fractions of the IMAGE WIDTH (0.0 = far left edge of the image, 1.0 = far right edge):
- "gauche": the x position of the INNER (right-hand) face of the LEFT pillar — the LEFT boundary of the opening.
- "droite": the x position of the INNER (left-hand) face of the RIGHT pillar — the RIGHT boundary of the opening.
- "centre": the x position of the CENTRE of the empty gap between the two pillars.

Read the pillar faces at their BASE (ground level), where the gate will stand. "gauche" < "centre" < "droite".

Answer with STRICT JSON ONLY (no markdown):
{"gauche": 0.00, "droite": 0.00, "centre": 0.00}`

export interface Ouverture {
  /** Face intérieure du pilier gauche, fraction [0..1] de la largeur d'image */
  gauche: number
  /** Face intérieure du pilier droit, fraction [0..1] de la largeur d'image */
  droite: number
  /** Centre de l'espace entre les piliers, fraction [0..1] */
  centre: number
}

/**
 * Un appel vision : mesure les 2 faces + le centre sur la scène finie (fractions
 * de largeur). Image aplatie et réduite comme pour le juge pieds.
 */
export async function mesurerOuverture(scene: Buffer | string, jobId?: number): Promise<Ouverture> {
  const image = await sharp(scene, { limitInputPixels: false })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize({ width: 1024, withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer()
  const { text } = await generateText({
    prompt: PROMPT_OUVERTURE,
    images: [{ source: image, mimeType: 'image/jpeg' }],
    model: MODEL_OUVERTURE,
    jobId,
  })
  const v = JSON.parse(text.replace(/```json|```/g, '').trim()) as Ouverture
  if (typeof v.gauche !== 'number' || typeof v.droite !== 'number' || typeof v.centre !== 'number') {
    throw new Error(`Ouverture illisible : ${text.slice(0, 120)}`)
  }
  return v
}

export interface CibleOuverture {
  /** Bord GAUCHE de pose (px) : face gauche mesurée − marge de recouvrement */
  blueL: number
  /** Bord DROIT de pose (px) : face droite mesurée + marge de recouvrement */
  blueR: number
  /** Centre de pose (px) : montant central du portail posé ici */
  centre: number
  /** true si la mesure vision a été appliquée, false = repli géométrique */
  mesuree: boolean
  /** Mesure brute (fractions), null si repli/erreur */
  mesure: Ouverture | null
}

/**
 * Calcule la cible de pose « deux vantaux » à partir de la mesure flash et du
 * gabarit (pour le repli et le bornage). Bords = faces mesurées ± marge de
 * recouvrement ; centre = centre mesuré. Chaque valeur est bornée à ±TOL_FRAC de
 * sa position géométrique (garde-fou). Repli complet sur le gabarit si la mesure
 * est invraisemblable (ordre gauche<centre<droite non respecté) ou en cas d'erreur.
 */
export async function cibleOuverture(
  scene: Buffer | string,
  gate: Pick<RectPx, 'x' | 'y' | 'w' | 'h'>,
  width: number,
  jobId?: number
): Promise<CibleOuverture> {
  const geomL = gate.x
  const geomR = gate.x + gate.w
  const geomC = gate.x + gate.w / 2
  const repli: CibleOuverture = { blueL: geomL, blueR: geomR, centre: geomC, mesuree: false, mesure: null }
  try {
    const mesure = await mesurerOuverture(scene, jobId)
    const { gauche, droite, centre } = mesure
    if (!(gauche >= 0 && droite <= 1 && gauche < centre && centre < droite)) return { ...repli, mesure }
    const tol = TOL_FRAC * width
    const marge = MARGE_FRAC * width
    const clamp = (v: number, ref: number) => Math.min(Math.max(v, ref - tol), ref + tol)
    const faceL = clamp(gauche * width, geomL)
    const faceR = clamp(droite * width, geomR)
    const centreP = clamp(centre * width, geomC)
    const blueL = Math.round(faceL - marge)
    const blueR = Math.round(faceR + marge)
    // Cohérence : le centre doit rester strictement entre les deux bords.
    if (!(blueL < centreP && centreP < blueR)) return { ...repli, mesure }
    return { blueL, blueR, centre: Math.round(centreP), mesuree: true, mesure }
  } catch {
    return repli
  }
}
