import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/lib/config'
import {
  getMesDecor,
  mesDecorImagesDir,
  setMesDecorApercu,
  type MesDecorRow,
} from '@/lib/db/mesDecors'
import { generateImage, type ImageInput } from '@/lib/genai/client'

/**
 * APERÇU d'un décor de la bibliothèque (17/08/2026, maquette
 * bibliotheque-decors-v1) : une image Nano 1K du décor SEUL — pas de portail,
 * pas de pipeline MES, un appel direct. C'est le visuel de la carte dans la
 * page Décors. Fichier sous data/mes-decors/<id>/ : hors dossiers générés,
 * donc épargné par la remise à zéro (comme les images de référence).
 *
 * Qualité 1K imposée (décision Mathias 17/08 : « en petite qualité possible »).
 *
 * MODÈLE RAPIDE imposé (retour Mathias 17/08 : « la génération de l'aperçu est
 * lente ») : le réglage global Admin (Nano Banana Pro, 30-60 s) reste pour les
 * générations MES ; l'aperçu passe sur Nano Banana 2, mesuré à ~9 s en 1K
 * (appel réel vérifié le 17/08 — jamais de nom de modèle en dur sans vérifier).
 */
const MODELE_APERCU = 'gemini-3.1-flash-image'

/**
 * Prompt d'aperçu = LE DÉCOR SEUL (décision Mathias 17/08 soir, après
 * aller-retour : « faut pas de pilier et muret pour les prompts de décor et
 * les aperçus ») : la maçonnerie (muret, piliers) comme le produit sont
 * ajoutés par le prompt MOTEUR à la génération — l'aperçu ne montre que ce
 * que la bibliothèque contrôle. On GARDE l'ossature caméra du janus rodé
 * (front elevation orthographique, zéro perspective) et on INTERDIT
 * explicitement toute clôture inventée (leçon v1 : muret en pierre sorti de
 * nulle part). Avant-plan minéral uniforme (règle décors 29/07).
 *
 * Bloc RÉALISME ajouté le 17/08 soir (retour Mathias : « les maisons sont
 * dégueulasses », recherche web au lieu de bricoler) : langage photo pro
 * (matériel, rendu couleur naturel), lumière DICTÉE, et surtout imperfections
 * volontaires — variations de teinte, détails constructifs, végétation
 * irrégulière ; interdits anti-CGI (HDR, sursaturation, surfaces plastiques,
 * symétrie parfaite). Sources : guides prompts photoréalisme/architecture
 * Nano Banana + Gemini (renderai.app, aivideobootcamp, rundiffusion).
 */
const PROMPT_APERCU = (scenery: string) => `Professional exterior architectural photograph for a
real-estate catalogue — full-frame camera, natural colour grading, realistic dynamic range.

CAMERA (frozen): strict architectural FRONT ELEVATION, orthographic look — shot with a very long
telephoto lens from far away, camera dead-on and exactly perpendicular to the scene. ZERO
perspective: no vanishing point, no diagonal lines, no 3/4 angle, no foreshortening. Everything
stays parallel to the image plane.

REALISM — this must read as a real photograph of an existing property, never as a 3D render or
an illustration:
- real construction detail: window reveals and sills, gutters and downpipes, subtle tonal
  variation across roof tiles and wall render, discreet signs of normal life (a doormat, a wall
  light, a house number) — everything kept clean but believable;
- vegetation with natural irregular shapes and varied greens — no two identical trees, no
  perfectly spherical shrubs;
- lighting: unless the scenery below says otherwise, soft natural daylight with one clear sun
  direction and gentle believable shadows;
- FORBIDDEN: exaggerated HDR, oversaturated colours, glowing vegetation, plastic-smooth
  surfaces, perfect mirror symmetry, cartoon or CGI look.

THE VIEW: the scenery ALONE, wide open toward the viewer. NO driveway gate, NO pedestrian gate,
NO fence, NO boundary wall, NO masonry pillars anywhere in the foreground — in the final product
photo those elements are added separately; this image is ONLY the scenery that sits behind them.
The immediate foreground is a plain uniform mineral ground (smooth asphalt or concrete strip)
leading straight into the scene — no lawn strip, no separate pathway in front.

SCALE AND DISTANCE (critical — the most common failure is a house rendered far too big): this is
a WIDE establishing shot of a whole property seen from across the street. Any house is a MODEST
single-family home with realistic proportions — ALWAYS exactly two storeys, a ground floor plus
one upper floor (never a single-storey bungalow, never three or more) — standing FAR BACK, at
least 25 metres behind the street line. In the frame the house stays
SMALL: its facade covers roughly a QUARTER of the image width, never more than a third, and it
sits in the upper-middle background band; the middle ground is filled by the driveway and the
garden. NEVER a mansion, NEVER a facade that fills or dominates the frame, NEVER a house pressed
close to the viewer.

REAL DEPTH, matching this flat frontal geometry: first a driveway or path and some garden; the
house stands SET BACK, never pressed against the front; every building is seen perfectly
FRONT-ON, its facade parallel to the image plane — never at an angle, never in 3/4 view. If any
photos are attached, they are SCENERY REFERENCES only: draw inspiration from their style of
house, vegetation, materials and light — never copy their composition, never output them.

The scenery to paint:
${scenery}`

export async function genererApercuDecor(id: number): Promise<MesDecorRow> {
  const decor = getMesDecor(id)
  if (!decor) throw new Error('Décor introuvable')
  const scenery = (decor.promptIa ?? decor.prompt).trim()
  if (!scenery) throw new Error('Écris d’abord le texte du décor avant de générer un aperçu.')

  // Images de référence jointes comme inspiration d'ambiance (comme au run MES).
  const images: ImageInput[] = decor.images
    .map((rel) => path.resolve(config.rootDir, rel))
    .filter((p) => fs.existsSync(p))
    .map((p) => ({ source: p }))

  const res = await generateImage({
    prompt: PROMPT_APERCU(scenery),
    images,
    aspectRatio: '3:2',
    imageSize: '1K',
    model: MODELE_APERCU,
    artifactName: `apercu-decor-${id}`,
    artifactDir: 'mes-decors-apercus',
  })

  // Copie pérenne sous data/mes-decors/<id>/ — l'artefact de generateImage vit
  // dans data/artifacts (journal), lui est effacé par la remise à zéro.
  const dir = mesDecorImagesDir(id)
  fs.mkdirSync(dir, { recursive: true })
  const ext = res.mimeType.includes('jpeg') ? 'jpg' : 'png'
  const full = path.join(dir, `apercu-${Date.now().toString(36)}.${ext}`)
  fs.writeFileSync(full, res.buffer)
  const rel = path.relative(config.rootDir, full).split(path.sep).join('/')
  const maj = setMesDecorApercu(id, rel)
  if (!maj) throw new Error('Décor supprimé pendant la génération de l’aperçu')
  return maj
}
