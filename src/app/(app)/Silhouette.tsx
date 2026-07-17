/**
 * Silhouettes produit (maquette choix-mode-typologie-v1, variante A validée le
 * 13/07/2026) : le visuel EST le produit — piliers gris, produit aux couleurs de
 * la marque active. Deux vantaux = battant, lame filant derrière le pilier =
 * coulissant, vantail piéton = portillon. Utilisées par la page Génération
 * (choix de typologie) et l'accueil du Catalogue.
 */

export type Typo = 'battant' | 'coulissant' | 'portillon'

/** Typologie d'une famille du serveur (« PORTAIL BATTANT »…) — null si inconnue. */
export function familyTypo(family: string): Typo | null {
  const f = family.toLowerCase()
  if (f.includes('coulissant')) return 'coulissant'
  if (f.includes('portillon')) return 'portillon'
  if (f.includes('battant')) return 'battant'
  return null
}

export default function Silhouette({ typo }: { typo: Typo }) {
  const pilier = { fill: '#dfe3e8', stroke: '#b6bdc6', strokeWidth: 1.5 }
  const produit = {
    fill: 'var(--color-brand-green-light)',
    stroke: 'var(--color-brand-green)',
    strokeWidth: 2.5,
  }
  const lame = { stroke: 'var(--color-brand-green)', strokeWidth: 2 }
  const sol = { stroke: '#c3c9d1', strokeWidth: 2 }
  return (
    <svg viewBox="0 0 220 112" className="block w-full h-auto" aria-hidden>
      <line x1={0} y1={104} x2={220} y2={104} {...sol} />
      {typo === 'battant' && (
        <>
          <rect x={8} y={30} width={20} height={74} rx={2} {...pilier} />
          <rect x={192} y={30} width={20} height={74} rx={2} {...pilier} />
          <rect x={32} y={42} width={76} height={62} rx={2} {...produit} />
          {[44, 57, 70, 83, 96].map((x) => (
            <line key={x} x1={x} y1={48} x2={x} y2={98} {...lame} />
          ))}
          <rect x={112} y={42} width={76} height={62} rx={2} {...produit} />
          {[124, 137, 150, 163, 176].map((x) => (
            <line key={x} x1={x} y1={48} x2={x} y2={98} {...lame} />
          ))}
        </>
      )}
      {typo === 'coulissant' && (
        <>
          <rect x={8} y={30} width={20} height={74} rx={2} {...pilier} />
          <rect x={32} y={42} width={172} height={62} rx={2} {...produit} />
          {[54, 67, 80, 93].map((y) => (
            <line key={y} x1={40} y1={y} x2={196} y2={y} {...lame} />
          ))}
          <rect x={192} y={30} width={20} height={74} rx={2} {...pilier} />
        </>
      )}
      {typo === 'portillon' && (
        <>
          <rect x={62} y={30} width={20} height={74} rx={2} {...pilier} />
          <rect x={138} y={30} width={20} height={74} rx={2} {...pilier} />
          <rect x={86} y={42} width={48} height={62} rx={2} {...produit} />
          {[96, 107, 118].map((x) => (
            <line key={x} x1={x} y1={48} x2={x} y2={98} {...lame} />
          ))}
        </>
      )}
    </svg>
  )
}
