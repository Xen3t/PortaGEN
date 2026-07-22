'use client'

import { computeLayout, gendarmePathD, type GabaritParams, type SizeCm } from '@/lib/geometry'

/**
 * Aperçu en direct des gabarits : la même géométrie (cm) que le pipeline, rendue en SVG
 * par-dessus le décor sélectionné — équivalent interactif du mockup historique.
 * `cannyUrl` (demande Mathias 22/07/2026) : le Canny du jeu en surimpression, traits
 * teintés en ROUGE pour l'aperçu (filtre d'affichage : blanc → rouge, fond noir
 * rendu transparent par mix-blend screen) — repère de réglage, le fichier Canny
 * lui-même reste blanc pour le pipeline.
 */
export default function GabaritPreview({
  decorUrl,
  size,
  params,
  cannyUrl,
}: {
  decorUrl: string | null
  size: SizeCm
  params: Partial<GabaritParams>
  cannyUrl?: string | null
}) {
  const L = computeLayout(size, params)
  const r = (rect: { x: number; y: number; w: number; h: number } | null, fill: string) =>
    rect && rect.w > 0 && rect.h > 0 ? (
      <rect key={`${fill}-${rect.x}-${rect.y}`} x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill={fill} />
    ) : null

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
        {r(L.muretRight, 'rgba(138,138,138,0.85)')}
        {r(L.pillarLeft, 'rgba(107,107,107,0.9)')}
        {r(L.pillarRight, 'rgba(107,107,107,0.9)')}
        {L.capLeft &&
          (L.capLeft.style === 'flat' ? (
            r(L.capLeft.bbox, 'rgba(90,90,90,0.9)')
          ) : (
            <path d={gendarmePathD(L.capLeft.bbox)} fill="rgba(90,90,90,0.9)" />
          ))}
        {L.capRight &&
          (L.capRight.style === 'flat' ? (
            r(L.capRight.bbox, 'rgba(90,90,90,0.9)')
          ) : (
            <path d={gendarmePathD(L.capRight.bbox)} fill="rgba(90,90,90,0.9)" />
          ))}
        <rect
          x={L.gateLeft}
          y={L.gateTop}
          width={L.gateW}
          height={L.gateH}
          fill="rgba(59,130,246,0.2)"
          stroke="#1d4ed8"
          strokeWidth={2}
          strokeDasharray="8 5"
        />
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
