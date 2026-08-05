'use client'

import { useId } from 'react'
import {
  computeLayout,
  computeCap,
  gendarmePathD,
  pilierDroitRectCm,
  type GabaritParams,
  type PilierDroitParams,
  type SizeCm,
} from '@/lib/geometry'

/**
 * Aperçu en direct des gabarits : la même géométrie (cm) que le pipeline, rendue en SVG
 * par-dessus le décor sélectionné — équivalent interactif du mockup historique.
 * `cannyUrl` (demande Mathias 22/07/2026) : le Canny du jeu en surimpression, traits
 * teintés en ROUGE pour l'aperçu (filtre d'affichage : blanc → rouge, fond noir
 * rendu transparent par mix-blend screen) — repère de réglage, le fichier Canny
 * lui-même reste blanc pour le pipeline.
 *
 * COULISSANT en 2 phases (04/08/2026) :
 *  - `rightPillar={false}` (phase 1) : pas de pilier droit, le muret file jusqu'au
 *    bord — reflet fidèle de l'étape 1 du pipeline (coulissant2etapes).
 *  - `pilierDroit` fourni (phase 2) : dessine le pilier droit à son placement réglé
 *    et la zone de recouvrement de la lame derrière lui.
 */
export default function GabaritPreview({
  decorUrl,
  size,
  params,
  cannyUrl,
  rightPillar = true,
  pilierDroit = null,
}: {
  decorUrl: string | null
  size: SizeCm
  params: Partial<GabaritParams>
  cannyUrl?: string | null
  rightPillar?: boolean
  pilierDroit?: PilierDroitParams | null
}) {
  // Id unique par vignette pour le clip du contour rouge (plusieurs aperçus par page).
  const clipId = `pd-clip-${useId().replace(/:/g, '')}`
  const L = computeLayout(size, params)
  const r = (rect: { x: number; y: number; w: number; h: number } | null, fill: string) =>
    rect && rect.w > 0 && rect.h > 0 ? (
      <rect key={`${fill}-${rect.x}-${rect.y}`} x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill={fill} />
    ) : null

  // Coulissant : à l'étape 1, le muret droit continue jusqu'au bord de scène (le
  // pilier droit n'existe pas encore). On le recalcule depuis le bord d'ouverture.
  const muretDroitH = L.muretRight?.h ?? 0
  const muretDroitEtendu =
    !rightPillar && L.muretRight
      ? {
          x: L.gateLeft + L.gateW,
          y: L.groundLine - muretDroitH,
          w: L.sceneW - (L.gateLeft + L.gateW),
          h: muretDroitH,
        }
      : null

  // Phase 2 : pilier droit à son placement réglé + cap selon le style du gabarit.
  const pilierCm = pilierDroit ? pilierDroitRectCm(L, pilierDroit) : null
  const pilierCapCm =
    pilierCm && params.capStyle
      ? computeCap(params.capStyle, pilierCm.x, pilierCm.y, pilierCm.w, L.sceneW, L.sceneH)
      : null
  return (
    <div className="relative w-full overflow-hidden rounded-[8px] border border-border bg-background" style={{ aspectRatio: '2528 / 1696' }}>
      {decorUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={decorUrl} alt="Décor" className="absolute inset-0 w-full h-full object-fill" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-text-secondary">
          Sélectionnez un décor pour l’aperçu
        </div>
      )}
      <svg
        viewBox={`0 0 ${L.sceneW} ${L.sceneH}`}
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
      >
        {/* Filtre de teinte du Canny (aperçu seulement) : garde le canal rouge,
            éteint vert et bleu — les traits blancs deviennent rouge pur. */}
        <defs>
          <filter id="canny-rouge" colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            />
          </filter>
        </defs>
        {r(L.muretLeft, 'rgba(138,138,138,0.85)')}
        {/* Muret droit : étendu jusqu'au bord en phase 1 coulissant, sinon normal. */}
        {r(muretDroitEtendu ?? L.muretRight, 'rgba(138,138,138,0.85)')}
        {r(L.pillarLeft, 'rgba(107,107,107,0.9)')}
        {rightPillar && r(L.pillarRight, 'rgba(107,107,107,0.9)')}
        {L.capLeft &&
          (L.capLeft.style === 'flat' ? (
            r(L.capLeft.bbox, 'rgba(90,90,90,0.9)')
          ) : (
            <path d={gendarmePathD(L.capLeft.bbox)} fill="rgba(90,90,90,0.9)" />
          ))}
        {rightPillar &&
          L.capRight &&
          (L.capRight.style === 'flat' ? (
            r(L.capRight.bbox, 'rgba(90,90,90,0.9)')
          ) : (
            <path d={gendarmePathD(L.capRight.bbox)} fill="rgba(90,90,90,0.9)" />
          ))}
        {/* Pilier droit (phase 2), peint PAR-DESSUS pour matérialiser l'occlusion. */}
        {pilierCm && r(pilierCm, 'rgba(107,107,107,0.95)')}
        {pilierCapCm &&
          (pilierCapCm.style === 'flat' ? (
            r(pilierCapCm.bbox, 'rgba(90,90,90,0.95)')
          ) : (
            <path d={gendarmePathD(pilierCapCm.bbox)} fill="rgba(90,90,90,0.95)" />
          ))}
        {/* Contour de l'ouverture (bleu) — dessiné PAR-DESSUS le pilier pour
            rester visible. Fill seulement quand pas de pilier (sinon on masque). */}
        <rect
          x={L.gateLeft}
          y={L.gateTop}
          width={L.gateW}
          height={L.gateH}
          fill={pilierCm ? 'none' : 'rgba(59,130,246,0.2)'}
          stroke="#1d4ed8"
          strokeWidth={2}
          strokeDasharray="8 5"
        />
        {/* Purement esthétique : la portion du contour qui passe DEVANT le pilier
            devient rouge (copie du contour découpée au rectangle du pilier). */}
        {pilierCm && (
          <>
            <defs>
              <clipPath id={clipId}>
                <rect x={pilierCm.x} y={pilierCm.y} width={pilierCm.w} height={pilierCm.h} />
              </clipPath>
            </defs>
            <rect
              x={L.gateLeft}
              y={L.gateTop}
              width={L.gateW}
              height={L.gateH}
              fill="none"
              stroke="#dc2626"
              strokeWidth={2}
              strokeDasharray="8 5"
              clipPath={`url(#${clipId})`}
            />
          </>
        )}
      </svg>
      {cannyUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cannyUrl}
          alt="Canny du jeu en surimpression"
          className="absolute inset-0 w-full h-full object-fill pointer-events-none"
          style={{ mixBlendMode: 'screen', filter: 'url(#canny-rouge)' }}
        />
      )}
      {L.isClamped && (
        <div className="absolute top-2 right-2 bg-brand-red text-white text-xs px-2 py-1 rounded-[8px]">
          Hors cadre
        </div>
      )}
    </div>
  )
}
