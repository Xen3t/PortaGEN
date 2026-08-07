/**
 * Silhouettes produit (maquette choix-mode-typologie-v1, variante A validée le
 * 13/07/2026) : le visuel EST le produit — piliers gris, produit aux couleurs de
 * la marque active. Deux vantaux = battant, lame filant derrière le pilier =
 * coulissant, vantail piéton = portillon. Utilisées par la page Génération
 * (choix de typologie) et l'accueil du Catalogue. SilhouetteMode décline le
 * même langage pour les panneaux Contrainte / Libre / Décors (22/07/2026),
 * SilhouetteModeIcone en version carrée compacte pour l'Accueil.
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

const pilier = { fill: '#dfe3e8', stroke: '#b6bdc6', strokeWidth: 1.5 }
const produit = {
  fill: 'var(--color-brand-green-light)',
  stroke: 'var(--color-brand-green)',
  strokeWidth: 2.5,
}
const lame = { stroke: 'var(--color-brand-green)', strokeWidth: 2 }
const sol = { stroke: '#c3c9d1', strokeWidth: 2 }

/** Les deux vantaux du battant — partagés entre typologie et modes. */
function Vantaux() {
  return (
    <>
      <rect x={32} y={42} width={76} height={62} rx={2} {...produit} />
      {[44, 57, 70, 83, 96].map((x) => (
        <line key={x} x1={x} y1={48} x2={x} y2={98} {...lame} />
      ))}
      <rect x={112} y={42} width={76} height={62} rx={2} {...produit} />
      {[124, 137, 150, 163, 176].map((x) => (
        <line key={x} x1={x} y1={48} x2={x} y2={98} {...lame} />
      ))}
    </>
  )
}

export default function Silhouette({ typo }: { typo: Typo }) {
  return (
    <svg viewBox="0 0 220 112" className="block w-full h-auto" aria-hidden>
      <line x1={0} y1={104} x2={220} y2={104} {...sol} />
      {typo === 'battant' && (
        <>
          <rect x={8} y={30} width={20} height={74} rx={2} {...pilier} />
          <rect x={192} y={30} width={20} height={74} rx={2} {...pilier} />
          <Vantaux />
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

export type Mode = 'contrainte' | 'decor-autour' | 'libre' | 'decors'

/**
 * Illustrations des panneaux de la page Générer, même langage que les
 * silhouettes typologie : Contrainte = produit coté (gabarits, pose précise),
 * Décor autour = le portail seul au centre puis le décor se construit autour
 * (trottoir, maison, murs, piliers — retour Mathias 05/08), Libre = scène
 * d'ambiance autour du produit, Décors = arrière-plan seul (maison, haies —
 * sans produit ni piliers).
 */
/** Soleil + nuage — le ciel de l'illustration Libre, animé à l'affichage. */
function Ciel() {
  const rayon = { stroke: '#b6bdc6', strokeWidth: 2, strokeLinecap: 'round' as const }
  return (
    <>
      <g className="anim-soleil">
        <line x1={54} y1={15} x2={58} y2={15} {...rayon} />
        <line x1={30} y1={15} x2={34} y2={15} {...rayon} />
        <line x1={44} y1={1} x2={44} y2={5} {...rayon} />
        <line x1={44} y1={25} x2={44} y2={29} {...rayon} />
        <line x1={51} y1={8} x2={54} y2={5} {...rayon} />
        <line x1={34} y1={5} x2={37} y2={8} {...rayon} />
        <line x1={51} y1={22} x2={54} y2={25} {...rayon} />
        <line x1={34} y1={25} x2={37} y2={22} {...rayon} />
        <circle cx={44} cy={15} r={7} {...pilier} />
      </g>
      <g className="anim-nuage">
        <ellipse cx={155} cy={14} rx={15} ry={7} {...pilier} />
        <ellipse cx={172} cy={18} rx={10} ry={5} {...pilier} />
      </g>
    </>
  )
}

export function SilhouetteMode({ mode }: { mode: Mode }) {
  const cote = { stroke: 'var(--color-brand-green)', strokeWidth: 2 }
  const guide = {
    stroke: 'var(--color-brand-green)',
    strokeWidth: 1.5,
    strokeDasharray: '4 3',
  }
  const rayon = { stroke: '#b6bdc6', strokeWidth: 2, strokeLinecap: 'round' as const }
  return (
    <svg viewBox="0 0 220 112" className="block w-full h-auto" aria-hidden>
      {/* decor-autour : pas de sol statique, c'est le trottoir animé qui l'apporte */}
      {mode !== 'decor-autour' && <line x1={0} y1={104} x2={220} y2={104} {...sol} />}
      {mode === 'contrainte' && (
        <>
          <rect x={8} y={30} width={20} height={74} rx={2} {...pilier} />
          <rect x={192} y={30} width={20} height={74} rx={2} {...pilier} />
          <Vantaux />
          {/* cote de gabarit : le produit est posé au millimètre ; la grande
              barre se déploie, les traits pleins apparaissent à son arrivée,
              puis les hachurés (classes anim-* de globals.css) */}
          <g className="anim-cote">
            <line x1={32} y1={16} x2={188} y2={16} {...cote} />
          </g>
          <g className="anim-cote-fin">
            <line x1={32} y1={11} x2={32} y2={21} {...cote} />
            <line x1={188} y1={11} x2={188} y2={21} {...cote} />
          </g>
          <g className="anim-cote-hachures">
            <line x1={32} y1={23} x2={32} y2={39} {...guide} />
            <line x1={188} y1={23} x2={188} y2={39} {...guide} />
          </g>
        </>
      )}
      {mode === 'decor-autour' && (
        <>
          {/* le portail est déjà là, au centre — EXACTEMENT à la même place
              et à la même taille que sur Contrainte et Libre (même Vantaux,
              mêmes piliers ; demande Mathias 05/08) — puis Nano construit le
              décor autour : le trottoir glisse, la maison se pose derrière,
              les piliers se montent, le ciel apparaît en touche finale */}
          <g className="anim-soleil-autour">
            <line x1={29.1} y1={12} x2={32} y2={12} {...rayon} />
            <line x1={12} y1={12} x2={14.9} y2={12} {...rayon} />
            <line x1={22} y1={2} x2={22} y2={4.9} {...rayon} />
            <line x1={22} y1={19.1} x2={22} y2={22} {...rayon} />
            <line x1={27} y1={7} x2={29.1} y2={4.9} {...rayon} />
            <line x1={14.9} y1={4.9} x2={17} y2={7} {...rayon} />
            <line x1={27} y1={17} x2={29.1} y2={19.1} {...rayon} />
            <line x1={14.9} y1={19.1} x2={17} y2={17} {...rayon} />
            <circle cx={22} cy={12} r={5} {...pilier} />
          </g>
          <g className="anim-nuage-autour">
            <ellipse cx={190} cy={10} rx={12} ry={6} {...pilier} />
            <ellipse cx={203} cy={14} rx={8} ry={4} {...pilier} />
          </g>
          <g className="anim-maison-autour">
            <polygon points="64,42 110,12 156,42" {...pilier} />
            <rect x={68} y={42} width={84} height={62} {...pilier} />
            <rect x={103} y={22} width={14} height={9} fill="#fff" stroke="#b6bdc6" strokeWidth={1.5} />
          </g>
          {/* le bord haut du trottoir arrive PILE à la base des piliers
              (y=104), derrière le portail */}
          <g className="anim-trottoir">
            <rect x={0} y={104} width={220} height={7} {...pilier} />
          </g>
          <rect className="anim-pilier anim-pilier-1" x={8} y={30} width={20} height={74} rx={2} {...pilier} />
          <rect className="anim-pilier anim-pilier-2" x={192} y={30} width={20} height={74} rx={2} {...pilier} />
          <Vantaux />
        </>
      )}
      {mode === 'libre' && (
        <>
          {/* la scène (soleil, nuage) est libre, le produit reste verrouillé */}
          <Ciel />
          <rect x={8} y={30} width={20} height={74} rx={2} {...pilier} />
          <rect x={192} y={30} width={20} height={74} rx={2} {...pilier} />
          <Vantaux />
        </>
      )}
      {mode === 'decors' && (
        <>
          {/* l'arrière-plan seul, sans produit ni piliers (retouche Mathias
              22/07) ; la maison se pose puis les haies poussent */}
          <g className="anim-maison">
            <polygon points="82,58 110,38 138,58" {...pilier} />
            <rect x={86} y={58} width={48} height={46} {...pilier} />
            <rect x={102} y={68} width={16} height={12} fill="#fff" stroke="#b6bdc6" strokeWidth={1.5} />
          </g>
          <ellipse className="anim-haie anim-haie-1" cx={163} cy={98} rx={13} ry={7} {...pilier} />
          <ellipse className="anim-haie anim-haie-2" cx={52} cy={99} rx={10} ry={5} {...pilier} />
        </>
      )}
    </svg>
  )
}

/**
 * Version carrée compacte des illustrations de mode, à la place des pictos PNG
 * sur les cartes raccourcis de l'Accueil (demande Mathias 22/07/2026). Mêmes
 * ingrédients condensés dans un carré 64×64, mêmes animations que les grandes.
 */
export function SilhouetteModeIcone({ mode, className }: { mode: Mode; className?: string }) {
  const cote = { stroke: 'var(--color-brand-green)', strokeWidth: 2.5 }
  const rayon = { stroke: '#b6bdc6', strokeWidth: 2, strokeLinecap: 'round' as const }
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <line x1={1} y1={57} x2={63} y2={57} {...sol} />
      {mode === 'contrainte' && (
        <>
          <rect x={2} y={27} width={7} height={30} rx={1} {...pilier} />
          <rect x={55} y={27} width={7} height={30} rx={1} {...pilier} />
          <rect x={12} y={31} width={18} height={26} rx={1} {...produit} />
          <line x1={17} y1={35} x2={17} y2={53} {...lame} />
          <line x1={25} y1={35} x2={25} y2={53} {...lame} />
          <rect x={34} y={31} width={18} height={26} rx={1} {...produit} />
          <line x1={39} y1={35} x2={39} y2={53} {...lame} />
          <line x1={47} y1={35} x2={47} y2={53} {...lame} />
          <g className="anim-cote">
            <line x1={12} y1={12} x2={52} y2={12} {...cote} />
          </g>
          <g className="anim-cote-fin">
            <line x1={12} y1={7} x2={12} y2={17} {...cote} />
            <line x1={52} y1={7} x2={52} y2={17} {...cote} />
          </g>
        </>
      )}
      {mode === 'libre' && (
        <>
          {/* le soleil de Ciel réduit à l'échelle 5/7 autour de (13,12) */}
          <g className="anim-soleil">
            <line x1={20.1} y1={12} x2={23} y2={12} {...rayon} />
            <line x1={3} y1={12} x2={5.9} y2={12} {...rayon} />
            <line x1={13} y1={2} x2={13} y2={4.9} {...rayon} />
            <line x1={13} y1={19.1} x2={13} y2={22} {...rayon} />
            <line x1={18} y1={7} x2={20.1} y2={4.9} {...rayon} />
            <line x1={5.9} y1={4.9} x2={8} y2={7} {...rayon} />
            <line x1={18} y1={17} x2={20.1} y2={19.1} {...rayon} />
            <line x1={5.9} y1={19.1} x2={8} y2={17} {...rayon} />
            <circle cx={13} cy={12} r={5} {...pilier} />
          </g>
          <g className="anim-nuage">
            <ellipse cx={46} cy={11} rx={10} ry={5} {...pilier} />
            <ellipse cx={56} cy={14} rx={6} ry={3.5} {...pilier} />
          </g>
          <rect x={2} y={27} width={7} height={30} rx={1} {...pilier} />
          <rect x={55} y={27} width={7} height={30} rx={1} {...pilier} />
          <rect x={12} y={31} width={18} height={26} rx={1} {...produit} />
          <line x1={17} y1={35} x2={17} y2={53} {...lame} />
          <line x1={25} y1={35} x2={25} y2={53} {...lame} />
          <rect x={34} y={31} width={18} height={26} rx={1} {...produit} />
          <line x1={39} y1={35} x2={39} y2={53} {...lame} />
          <line x1={47} y1={35} x2={47} y2={53} {...lame} />
        </>
      )}
      {mode === 'decors' && (
        <>
          <g className="anim-maison">
            <polygon points="14,32 32,16 50,32" {...pilier} />
            <rect x={18} y={32} width={28} height={25} {...pilier} />
            <rect x={27} y={38} width={10} height={8} fill="#fff" stroke="#b6bdc6" strokeWidth={1.5} />
          </g>
          <ellipse className="anim-haie anim-haie-1" cx={55} cy={54} rx={8} ry={4} {...pilier} />
          <ellipse className="anim-haie anim-haie-2" cx={9} cy={55} rx={6} ry={3} {...pilier} />
        </>
      )}
    </svg>
  )
}

export type Origine = 'catalogue' | 'images'

/**
 * Icônes carrées de l'écran « Le point de départ » du mode Contrainte
 * (demande Mathias 22/07/2026) : Depuis le catalogue = le produit sous la
 * loupe, Depuis mes images = photos du produit déposées. Même langage et
 * mêmes animations que les autres icônes.
 */
const produitMini = {
  fill: 'var(--color-brand-green-light)',
  stroke: 'var(--color-brand-green)',
  strokeWidth: 2,
}

/** Pile de photos du produit — « Depuis mes images » et la zone de dépôt. */
function PilePhotos() {
  return (
    <g className="anim-photos">
      <rect x={9} y={9} width={38} height={30} {...pilier} />
      <rect x={17} y={19} width={38} height={30} fill="#fff" stroke="#b6bdc6" strokeWidth={1.5} />
      <line x1={21} y1={43} x2={51} y2={43} stroke="#c3c9d1" strokeWidth={1.5} />
      <rect x={23} y={30} width={12} height={13} rx={1} {...produitMini} />
      <line x1={29} y1={33} x2={29} y2={40} {...lame} strokeWidth={1.5} />
      <rect x={37} y={30} width={12} height={13} rx={1} {...produitMini} />
      <line x1={43} y1={33} x2={43} y2={40} {...lame} strokeWidth={1.5} />
    </g>
  )
}

export function SilhouetteOrigineIcone({
  origine,
  className,
}: {
  origine: Origine
  className?: string
}) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <line x1={1} y1={57} x2={63} y2={57} {...sol} />
      {origine === 'catalogue' && (
        <>
          <rect x={2} y={27} width={7} height={30} rx={1} {...pilier} />
          <rect x={55} y={27} width={7} height={30} rx={1} {...pilier} />
          <rect x={12} y={31} width={18} height={26} rx={1} {...produit} />
          <line x1={17} y1={35} x2={17} y2={53} {...lame} />
          <line x1={25} y1={35} x2={25} y2={53} {...lame} />
          <rect x={34} y={31} width={18} height={26} rx={1} {...produit} />
          <line x1={39} y1={35} x2={39} y2={53} {...lame} />
          <line x1={47} y1={35} x2={47} y2={53} {...lame} />
          <g className="anim-loupe">
            <circle cx={40} cy={14} r={9} fill="#fff" stroke="#b6bdc6" strokeWidth={2.5} />
            <line x1={46.4} y1={20.4} x2={52} y2={26} stroke="#b6bdc6" strokeWidth={3.5} strokeLinecap="round" />
          </g>
        </>
      )}
      {origine === 'images' && <PilePhotos />}
    </svg>
  )
}

export type Picto =
  | 'battant'
  | 'coulissant'
  | 'portillon'
  | 'loupe'
  | 'photos'
  | 'site'
  | 'mp'
  | 'generer'
  | 'wip'
  | 'biblio'
  | 'vision'
  | 'telecharger'
  | 'relancer'
  | 'ouvrir'

/**
 * Petits pictos SVG en remplacement des PNG Fluent Emoji (demande Mathias
 * 22/07/2026) : mêmes couleurs que les illustrations, `size` en pixels comme
 * l'ancien composant Pic. `loupe` et `generer` sont en currentColor (posés
 * sur fond sombre ou sur le bouton vert). Chacun a sa petite animation.
 */
export function PictoIllu({
  name,
  size,
  className,
}: {
  name: Picto
  size: number
  className?: string
}) {
  const rouge = 'var(--color-brand-red)'
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`inline-block align-[-0.18em] ${className ?? ''}`}
      aria-hidden
    >
      {name === 'battant' && (
        <g className="anim-picto">
          <line x1={1} y1={57} x2={63} y2={57} {...sol} />
          <rect x={8} y={20} width={22} height={37} rx={1} {...produit} />
          <line x1={15} y1={25} x2={15} y2={52} {...lame} />
          <line x1={23} y1={25} x2={23} y2={52} {...lame} />
          <rect x={34} y={20} width={22} height={37} rx={1} {...produit} />
          <line x1={41} y1={25} x2={41} y2={52} {...lame} />
          <line x1={49} y1={25} x2={49} y2={52} {...lame} />
        </g>
      )}
      {name === 'coulissant' && (
        <g className="anim-picto">
          <line x1={1} y1={57} x2={63} y2={57} {...sol} />
          <rect x={6} y={22} width={52} height={35} rx={1} {...produit} />
          <line x1={11} y1={31} x2={53} y2={31} {...lame} />
          <line x1={11} y1={39} x2={53} y2={39} {...lame} />
          <line x1={11} y1={47} x2={53} y2={47} {...lame} />
        </g>
      )}
      {name === 'portillon' && (
        <g className="anim-picto">
          <line x1={1} y1={57} x2={63} y2={57} {...sol} />
          <rect x={22} y={18} width={20} height={39} rx={1} {...produit} />
          <line x1={28} y1={23} x2={28} y2={52} {...lame} />
          <line x1={36} y1={23} x2={36} y2={52} {...lame} />
        </g>
      )}
      {name === 'loupe' && (
        <g className="anim-picto">
          <circle cx={28} cy={26} r={16} fill="none" stroke="currentColor" strokeWidth={4.5} />
          <line x1={39.5} y1={37.5} x2={52} y2={50} stroke="currentColor" strokeWidth={6} strokeLinecap="round" />
        </g>
      )}
      {name === 'photos' && (
        <>
          <line x1={1} y1={57} x2={63} y2={57} {...sol} />
          <PilePhotos />
        </>
      )}
      {name === 'site' && (
        <g className="anim-picto">
          <rect x={4} y={15} width={56} height={34} fill="#fff" stroke="#b6bdc6" strokeWidth={2.5} />
          <line x1={9} y1={42} x2={55} y2={42} stroke="#c3c9d1" strokeWidth={2} />
          <rect x={14} y={26} width={16} height={16} rx={1} {...produitMini} />
          <line x1={22} y1={30} x2={22} y2={38} {...lame} strokeWidth={1.5} />
          <rect x={34} y={26} width={16} height={16} rx={1} {...produitMini} />
          <line x1={42} y1={30} x2={42} y2={38} {...lame} strokeWidth={1.5} />
        </g>
      )}
      {name === 'mp' && (
        <>
          <g className="anim-picto">
            <rect x={12} y={12} width={40} height={40} rx={3} fill="#fff" stroke="#b6bdc6" strokeWidth={2.5} />
          </g>
          <text
            className="anim-picto-suite"
            x={32}
            y={33}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={19}
            fontWeight={700}
            fill="var(--color-brand-green)"
          >
            1:1
          </text>
        </>
      )}
      {name === 'generer' && (
        <>
          {/* étincelles pleines (v2 : le portail en traits lisait mal à 16 px) ;
              l'anim se joue au survol du bouton porteur de la classe group */}
          <polygon
            className="anim-etincelle-1"
            points="26,12 31,31 50,36 31,41 26,60 21,41 2,36 21,31"
            fill="currentColor"
          />
          <polygon
            className="anim-etincelle-2"
            points="50,4 53,11 60,14 53,17 50,24 47,17 40,14 47,11"
            fill="currentColor"
          />
        </>
      )}
      {/* Bibliothèque (livre ouvert) & vision (œil) — banc de test 07/08/2026 :
          origine de la description produit (réutilisée / fraîchement décrite).
          En currentColor : la couleur vient du porteur. */}
      {name === 'biblio' && (
        <g
          className="anim-picto"
          fill="none"
          stroke="currentColor"
          strokeWidth={4.5}
          strokeLinejoin="round"
        >
          <path d="M32 17 C26 12, 12 12, 7 15 V49 C12 46, 26 46, 32 51 C38 46, 52 46, 57 49 V15 C52 12, 38 12, 32 17 Z" />
          <line x1={32} y1={17} x2={32} y2={51} />
        </g>
      )}
      {name === 'vision' && (
        <g className="anim-picto" fill="none" stroke="currentColor" strokeWidth={4.5}>
          <path d="M4 32 C14 17, 50 17, 60 32 C50 47, 14 47, 4 32 Z" />
          <circle cx={32} cy={32} r={7} fill="currentColor" stroke="none" />
        </g>
      )}
      {/* Téléchargement (plateau + flèche rentrante) & relance (flèche
          circulaire) — boutons de case du banc 07/08/2026, en currentColor. */}
      {name === 'telecharger' && (
        <g
          className="anim-picto"
          fill="none"
          stroke="currentColor"
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M56 40 v8 a5 5 0 0 1 -5 5 H13 a5 5 0 0 1 -5 -5 v-8" />
          <polyline points="18.7,25 32,38.5 45.3,25" />
          <line x1={32} y1={38.5} x2={32} y2={8} />
        </g>
      )}
      {name === 'relancer' && (
        <g
          className="anim-picto"
          fill="none"
          stroke="currentColor"
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="61,11 61,27 45,27" />
          <path d="M54.6 40 A24 24 0 1 1 49 15 L61 27" />
        </g>
      )}
      {/* Flèche « ouvrir » (cartes de session 07/08) — remplace le « → » texte. */}
      {name === 'ouvrir' && (
        <g
          className="anim-picto"
          fill="none"
          stroke="currentColor"
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1={8} y1={32} x2={52} y2={32} />
          <polyline points="38,18 52,32 38,46" />
        </g>
      )}
      {name === 'wip' && (
        <>
          <line x1={1} y1={57} x2={63} y2={57} {...sol} />
          <rect x={14} y={26} width={6} height={31} {...pilier} />
          <rect x={44} y={26} width={6} height={31} {...pilier} />
          <g className="anim-picto">
            <rect x={8} y={20} width={48} height={14} fill="#fff" stroke={rouge} strokeWidth={2.5} />
            <line x1={14} y1={34} x2={22} y2={20} stroke={rouge} strokeWidth={2.5} />
            <line x1={26} y1={34} x2={34} y2={20} stroke={rouge} strokeWidth={2.5} />
            <line x1={38} y1={34} x2={46} y2={20} stroke={rouge} strokeWidth={2.5} />
          </g>
        </>
      )}
    </svg>
  )
}
