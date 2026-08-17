import sharp from 'sharp'
import { getActivePrompt } from '@/lib/db/prompts'
import { generateText } from '@/lib/genai/client'

/**
 * Juge vision des MES décor autour (17/08/2026, demande Mathias : « déléguer la
 * boucle de regénération »). Un modèle vision reçoit DEUX images — le PNG
 * produit détouré (la référence) et le rendu final — et accepte ou refuse.
 *
 * Le prompt (`juge-mes`, Prompt System) est volontairement CONSERVATEUR : refus
 * uniquement sur défauts flagrants (produit altéré, échelle absurde, scène
 * incohérente, image inachevée) — dans le doute, il accepte. Un humain revoit
 * toutes les images de toute façon : le juge n'est là que pour relancer sans
 * attendre quand c'est manifestement raté.
 *
 * Modèle : gemini-3.5-flash — stable, vérifié le 17/08 (le flash-lite validé
 * pour le juge « pieds » répond à une question binaire sur UNE image ; juger
 * une scène complète demande le cran au-dessus, coût toujours négligeable
 * devant un appel Nano).
 */
const JUGE_MES_MODEL = 'gemini-3.5-flash'

export interface VerdictMes {
  acceptee: boolean
  motif: string
  model: string
  promptVersion: number
}

/** Aplatit et réduit une image pour l'appel vision (~1 500 tokens d'entrée). */
async function versJpeg(source: Buffer | string, largeur: number): Promise<Buffer> {
  return sharp(source, { limitInputPixels: false })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize({ width: largeur, withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer()
}

/**
 * SUPERPOSITION gabarit (méthode Mathias 17/08, rodée 9/9 sur le lot
 * banc-msx9zzj0 + lot du matin) : le ciel du plan gris devient transparent,
 * toutes les formes du gabarit (portail posé, piliers, murets, bandes) sont
 * teintées MAGENTA semi-transparent et posées sur le rendu. Le juge gabarit
 * reçoit cette image + un agrandissement de la moitié haute (sommets de
 * piliers) et dit si la photo est encore équivalente au gabarit.
 */
async function construireSuperposition(
  plan: Buffer | string,
  rendu: Buffer | string
): Promise<{ pleine: Buffer; haut: Buffer }> {
  const planRaw = await sharp(plan, { limitInputPixels: false })
    .flatten({ background: '#ffffff' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = planRaw.info
  const i0 = (5 * W + 5) * C
  const ciel = [planRaw.data[i0], planRaw.data[i0 + 1], planRaw.data[i0 + 2]]
  const rgba = Buffer.alloc(W * H * 4)
  for (let i = 0, p = 0; i < W * H; i++, p += C) {
    const delta =
      Math.abs(planRaw.data[p] - ciel[0]) +
      Math.abs(planRaw.data[p + 1] - ciel[1]) +
      Math.abs(planRaw.data[p + 2] - ciel[2])
    const o = i * 4
    rgba[o] = 255
    rgba[o + 1] = 0
    rgba[o + 2] = 255
    rgba[o + 3] = delta > 30 ? 130 : 0
  }
  const calque = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer()
  const pleine = await sharp(rendu, { limitInputPixels: false })
    .resize({ width: W, height: H, fit: 'fill' })
    .composite([{ input: calque }])
    .png()
    .toBuffer()
  const haut = await sharp(pleine)
    .extract({ left: 0, top: 0, width: W, height: Math.round(H * 0.5) })
    .png()
    .toBuffer()
  return { pleine, haut }
}


/** JSON du modèle, débarrassé d'une éventuelle clôture markdown. */
function parseJson(text: string): Record<string, unknown> {
  return JSON.parse(text.replace(/```json|```/g, '').trim()) as Record<string, unknown>
}

/**
 * Juge un rendu MES en DEUX appels vision (config rodée 9/9 ×2 le 17/08 —
 * groupés en un seul appel, la superposition se diluait et les verdicts
 * devenaient instables) :
 *  A) produit + photo (`juge-mes`) : produit altéré, échelle absurde, scène
 *     cassée, image inachevée — dans le doute, il accepte ;
 *  B) superposition + agrandissement du haut (`juge-mes-gabarit`) : la photo
 *     est-elle encore équivalente au gabarit ? — réponse par élément
 *     (portail / pilier gauche / pilier droit), pas de bénéfice du doute.
 * Refus si l'un des deux refuse. Erreur de l'appel B (API, JSON) = contrôle
 * gabarit sauté, l'appel A tranche seul ; erreur de l'appel A = erreur du
 * juge (la boucle rend la main sans relance).
 */
export async function jugerMes(
  produit: Buffer | string,
  plan: Buffer | string,
  rendu: Buffer | string,
  jobId?: number
): Promise<VerdictMes> {
  const promptRow = getActivePrompt('juge-mes')
  const promptGabarit = getActivePrompt('juge-mes-gabarit')
  const superpo = await construireSuperposition(plan, rendu)
  const [refJpeg, photoJpeg, superpoJpeg, hautJpeg] = await Promise.all([
    versJpeg(produit, 768),
    versJpeg(rendu, 1280),
    versJpeg(superpo.pleine, 1280),
    versJpeg(superpo.haut, 1280),
  ])

  const appelScene = generateText({
    prompt: promptRow.content,
    images: [
      { source: refJpeg, mimeType: 'image/jpeg' },
      { source: photoJpeg, mimeType: 'image/jpeg' },
    ],
    model: JUGE_MES_MODEL,
    jobId,
  })
  const appelGabarit = generateText({
    prompt: promptGabarit.content,
    images: [
      { source: superpoJpeg, mimeType: 'image/jpeg' },
      { source: hautJpeg, mimeType: 'image/jpeg' },
    ],
    model: JUGE_MES_MODEL,
    jobId,
  })
  const [scene, gabarit] = await Promise.allSettled([appelScene, appelGabarit])

  // L'appel produit/scène est le socle : son échec = erreur du juge.
  if (scene.status === 'rejected') throw scene.reason
  const vScene = parseJson(scene.value.text)
  if (typeof vScene.acceptee !== 'boolean') {
    throw new Error(`Verdict juge MES illisible : ${scene.value.text.slice(0, 120)}`)
  }
  if (vScene.acceptee === false) {
    return {
      acceptee: false,
      motif: typeof vScene.motif === 'string' ? vScene.motif : 'Produit ou scène non conforme.',
      model: JUGE_MES_MODEL,
      promptVersion: promptRow.version,
    }
  }

  // Contrôle gabarit : refus UNIQUEMENT sur un `conforme: false` lisible.
  if (gabarit.status === 'fulfilled') {
    try {
      const vGab = parseJson(gabarit.value.text)
      if (vGab.conforme === false) {
        return {
          acceptee: false,
          motif: `Gabarit non respecté : ${typeof vGab.motif === 'string' && vGab.motif ? vGab.motif : 'portail ou piliers hors gabarit.'}`,
          model: JUGE_MES_MODEL,
          promptVersion: promptRow.version,
        }
      }
    } catch {
      // JSON gabarit illisible : contrôle sauté, l'appel scène a déjà accepté.
    }
  }

  return { acceptee: true, motif: '', model: JUGE_MES_MODEL, promptVersion: promptRow.version }
}
