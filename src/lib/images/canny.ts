import path from 'node:path'
import { config } from '@/lib/config'
import { DEFAULT_PARAMS, projection, type GabaritParams } from '@/lib/geometry'
import { whiteLineBands } from '@/lib/images/analyze'
import { resizeExact } from '@/lib/images/resize'

/**
 * Construction du CANNY envoyé à Nano Banana : trottoir de référence redimensionné
 * au format natif. Le corridor d'allée n'est PLUS dessiné dans le CANNY (décision
 * Mathias 09/07/2026 : le modèle recopiait les traits de guidage en « piquets »
 * parasites) — sa géométrie est calculée pour la MESURE (herbe/piquets dans le
 * couloir) et la contrainte passe uniquement par le prompt (moodboard-llm v3 +
 * addendum corridor).
 */

export interface CannyBuildOptions {
  width: number
  height: number
  /** CANNY de base (défaut : trottoir historique 2000×1330) */
  basePath?: string
  /** Largeur du corridor en cm (ouverture max de la gamme) ; null = pas de corridor */
  corridorWidthCm?: number | null
  params?: Partial<GabaritParams>
}

export interface CorridorInfo {
  widthCm: number
  x1Px: number
  x2Px: number
  yTopPx: number
  yBottomPx: number
}

export async function buildCanny(
  opts: CannyBuildOptions
): Promise<{ image: Buffer; corridor: CorridorInfo | null }> {
  const basePath =
    opts.basePath ?? path.join(config.assetsDir, 'Trottoir Canny', 'Trottoir 2000x1330.png')
  const base = await resizeExact(basePath, opts.width, opts.height)
  if (!opts.corridorWidthCm) {
    return { image: base, corridor: null }
  }

  // Le corridor part du bord supérieur du trottoir et remonte vers la maison.
  const bands = (await whiteLineBands(base)).filter((b) => b.yNorm > 0.5)
  const sidewalkTop = bands[0]?.yNorm ?? 0.77
  const yBottomPx = Math.round(sidewalkTop * opts.height)
  const yTopPx = Math.round((sidewalkTop - 0.16) * opts.height)

  // Positions horizontales : mêmes conventions que les gabarits (cm → px, mode stretch).
  const eff: GabaritParams = { ...DEFAULT_PARAMS, ...opts.params }
  const sceneW = Math.round(eff.sceneH * eff.mesAspect)
  const p = projection(opts.width, opts.height, sceneW, eff.sceneH)
  const center = sceneW / 2 + eff.offsetX
  const x1Px = Math.round((center - opts.corridorWidthCm / 2) * p.sx)
  const x2Px = Math.round((center + opts.corridorWidthCm / 2) * p.sx)

  // Le CANNY part TEL QUEL (aucun trait ajouté) — seule la zone de contrôle est retournée.
  return {
    image: base,
    corridor: { widthCm: opts.corridorWidthCm, x1Px, x2Px, yTopPx, yBottomPx },
  }
}

// L'addendum couloir n'est plus construit ici : depuis la refonte du 11/07/2026,
// c'est le prompt versionné « decor-couloir » (Admin → Prompts), rempli par
// buildCorridorAddendum (src/lib/pipeline/decor.ts) avec la largeur asservie aux
// tailles actives et l'ancre visuelle « % de la largeur d'image » issue de la
// zone couloir calculée ci-dessus.
