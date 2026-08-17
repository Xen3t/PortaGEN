import sharp from 'sharp'
import { config } from '@/lib/config'
import { generateText } from '@/lib/genai/client'
import { appliquerRalify } from '@/lib/images/ralify'

/**
 * RALify POST-MES (validé Mathias 17/08/2026 sur la gamme EIGER full anthracite,
 * job msx7j6vv) : harmonise l'aluminium du produit VERS son RAL cible directement
 * SUR la MES générée — Nano dérive la teinte différemment à chaque génération,
 * cette passe réaligne toute la gamme sans nouvel appel image.
 *
 * Méthode (essai outils/essai-ralify-post-mes.ts, planches du 17/08) :
 *  1. détection du produit dans la scène par le modèle texte (box_2d normalisée
 *     0-1000 — les modèles actuels n'émettent PLUS de masque de segmentation
 *     fiable, la boîte seule est stable) ;
 *  2. la boîte, bords fondus, sert d'alpha externe à appliquerRalify : sa
 *     protection par dominante fait la segmentation fine à l'intérieur
 *     (quincaillerie, décor visible entre les pièces → intacts) ;
 *  3. recomposition sur la scène d'origine.
 *
 * JAMAIS bloquant : le moindre pépin (détection illisible, boîte absente…)
 * renvoie null et la MES reste telle quelle — la correction est un bonus.
 */

export interface RalifyPostMesResult {
  /** Scène recolorée (PNG, à réencoder par l'appelant). */
  image: Buffer
  /** Boîte détectée, en ‰ de l'image [ymin, xmin, ymax, xmax]. */
  boxPct: [number, number, number, number]
  /** Modèle qui a fait la détection (traçabilité, demande Mathias 17/08). */
  model: string
  avantHex: string
  apresHex: string
  pixelsTraites: number
  pixelsProteges: number
}

interface DetectionEntry {
  box_2d?: unknown
  label?: unknown
}

/** JSON de la réponse détection (fences ``` tolérées) — null si illisible. */
function parseDetection(text: string): DetectionEntry[] | null {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  try {
    const parsed = JSON.parse((m ? m[1] : text).trim())
    return Array.isArray(parsed) ? (parsed as DetectionEntry[]) : null
  } catch {
    return null
  }
}

function boxValide(b: unknown): b is [number, number, number, number] {
  return (
    Array.isArray(b) &&
    b.length === 4 &&
    b.every((v) => typeof v === 'number' && v >= 0 && v <= 1000) &&
    b[2] > b[0] &&
    b[3] > b[1]
  )
}

export async function appliquerRalifyPostMes(opts: {
  /** Scène MES (buffer JPEG/PNG, pleine résolution livraison). */
  scene: Buffer
  cibleHex: string
  intensitePct: number
  /** Désignation anglaise du produit pour la détection (« the aluminum double swing gate »…). */
  produitEn: string
  jobId?: number
}): Promise<RalifyPostMesResult | null> {
  try {
    // 1. Détection — même modèle texte que le reste de l'app (flash), boîte seule.
    const { text } = await generateText({
      prompt:
        `Detect ${opts.produitEn} between the two pillars (only the gate itself, ` +
        'not the pillars, not the walls). Output a JSON list where each entry contains ' +
        'the 2D bounding box in the key "box_2d" (format [ymin, xmin, ymax, xmax], ' +
        'normalized 0-1000) and the text label in the key "label". No masks.',
      images: [{ source: opts.scene }],
      jobId: opts.jobId,
    })
    const entries = parseDetection(text)?.filter((e) => boxValide(e.box_2d))
    if (!entries?.length) return null
    // La plus grande boîte = le produit (une MES n'a qu'un produit).
    const aire = (b: [number, number, number, number]) => (b[2] - b[0]) * (b[3] - b[1])
    const box = entries
      .map((e) => e.box_2d as [number, number, number, number])
      .reduce((a, b) => (aire(b) > aire(a) ? b : a))

    // 2. Alpha externe : rectangle de la boîte, bords fondus (léger flou).
    const meta = await sharp(opts.scene).metadata()
    const W = meta.width!
    const H = meta.height!
    const bx = Math.round((box[1] / 1000) * W)
    const by = Math.round((box[0] / 1000) * H)
    const bw = Math.max(1, Math.round(((box[3] - box[1]) / 1000) * W))
    const bh = Math.max(1, Math.round(((box[2] - box[0]) / 1000) * H))
    const rect = await sharp({
      create: { width: bw, height: bh, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer()
    const pose = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite([{ input: rect, left: bx, top: by }])
      .png()
      .toBuffer()
    const masque = await sharp(pose).greyscale().blur(1.2).toColourspace('b-w').png().toBuffer()

    // 3. RALify (protection par dominante inchangée) puis recomposition.
    // (passes séparées OBLIGATOIRES : chaînés, removeAlpha s'applique après le
    // joinChannel dans l'ordre interne de sharp et efface le masque)
    const rgb = await sharp(opts.scene).removeAlpha().toBuffer()
    const rgba = await sharp(rgb).joinChannel(masque).png().toBuffer()
    const res = await appliquerRalify(rgba, opts.cibleHex, opts.intensitePct)
    if (res.pixelsTraites === 0) return null
    const image = await sharp(opts.scene)
      .composite([{ input: res.image, blend: 'over' }])
      .png()
      .toBuffer()
    return {
      image,
      boxPct: box,
      model: config.textModel,
      avantHex: res.avantHex,
      apresHex: res.apresHex,
      pixelsTraites: res.pixelsTraites,
      pixelsProteges: res.pixelsProteges,
    }
  } catch {
    // Détection ou traitement en échec : la MES part sans harmonisation.
    return null
  }
}
